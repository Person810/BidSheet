/**
 * Encrypted cloud backup of the whole database (Phase 3a).
 *
 * The promise this makes true: wipe a laptop, sign in on a new one, enter
 * the passphrase, and everything is back. The whole SQLite file is
 * encrypted client-side (scrypt + AES-256-GCM, see backup-crypto.ts) before
 * upload — the server stores ciphertext it cannot read.
 *
 * Key handling: when the user sets the passphrase, the derived key is
 * wrapped with OS safeStorage and kept in the cloud_auth row, so routine
 * backups (after each successful sync pass, plus a manual button — never a
 * timer) run without prompting. The passphrase itself is never stored;
 * restoring on a fresh machine re-derives the key from the passphrase and
 * the salt carried in the blob's header. Lose every machine AND the
 * passphrase, and the backup is unreadable — by the user and by us.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { logger } from '../logger';
import { getDbPath } from '../database';
import { CloudAuth } from './supabase-auth';
import { CloudApiClient, CloudBackupMeta } from './api-client';
import { decryptBackupWithPassphrase } from './backup-crypto';
import { E2eeManager } from './e2ee';
import { encryptForSync, decryptForSync, syncAad, isEncryptedPayload } from './sync-crypto';

export interface BackupStatus {
  /** Encrypted sync is unlocked on this machine — backups run automatically. */
  configured: boolean;
  lastBackupAt: string | null;
}

export class BackupEngine {
  constructor(
    private db: Database.Database,
    private auth: CloudAuth,
    private api: CloudApiClient,
    private e2ee: E2eeManager
  ) {}

  status(): BackupStatus {
    // Backups ride the same DEK as sync — "configured" means encrypted sync is
    // unlocked on this device. No separate backup passphrase anymore.
    return {
      configured: this.e2ee.hasLocalDek(),
      // Sidecar first; the cloud_auth columns only remain as a legacy fallback
      // for the display timestamp (see backupNow for why they went stale).
      lastBackupAt: this.readState()?.at ?? this.row()?.backup_last_at ?? null,
    };
  }

  async remoteMeta(): Promise<CloudBackupMeta | null> {
    return this.api.getBackupMeta();
  }

  /** Stop backing up from this machine and remove the cloud copy. */
  async disable(): Promise<void> {
    await this.api.deleteBackup().catch((err) => {
      // Best effort — clearing the local bookkeeping alone still stops backups.
      logger.warn('cloud-backup', 'Could not delete cloud backup copy', err.message);
    });
    this.clearState();
    this.db
      .prepare(
        `UPDATE cloud_auth SET backup_last_hash = NULL, backup_last_at = NULL WHERE id = 1`
      )
      .run();
    logger.info('cloud-backup', 'Encrypted backup disabled; cloud copy removed');
  }

  /**
   * Encrypt and upload the database with the account DEK. Skips silently when
   * the bytes haven't changed since the last upload (unless forced) — sync
   * passes call this after every run.
   */
  async backupNow(force = false): Promise<{ uploaded: boolean }> {
    const dek = this.e2ee.getDek(); // throws cleanly if encrypted sync is locked
    const accountId = await this.accountId();

    this.db.pragma('wal_checkpoint(TRUNCATE)');
    const plaintext = fs.readFileSync(getDbPath());
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
    // The last-uploaded hash must live OUTSIDE the database file: it used to
    // be stored in cloud_auth, inside the very file being hashed, so writing
    // it after each upload changed the next hash — the skip was unreachable
    // and the full DB re-uploaded on every sync pass.
    const state = this.readState();
    if (!force && state && state.accountId === accountId && state.hash === hash) {
      return { uploaded: false };
    }

    const schemaVersion =
      (this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as any)
        ?.version ?? 0;
    const ciphertext = encryptForSync(plaintext, dek, syncAad(accountId, 'account', 'backup'));
    await this.api.putBackup(ciphertext, app.getVersion(), schemaVersion);
    this.writeState(accountId, hash);
    logger.info('cloud-backup', `Uploaded encrypted backup (${plaintext.length} bytes plaintext)`);
    return { uploaded: true };
  }

  /** Post-sync hook: best effort, never breaks the sync pass it rides on. */
  async afterSync(): Promise<void> {
    if (!this.status().configured) return;
    try {
      await this.backupNow();
    } catch (err: any) {
      logger.warn('cloud-backup', 'Post-sync backup failed', err.message);
    }
  }

  /**
   * Download, decrypt, validate, and swap in the cloud backup, then
   * relaunch. Everything currently on this machine is replaced — the
   * renderer confirms loudly before calling. Mirrors db:restore in
   * ipc-handlers.ts: a wrong passphrase or invalid file fails before
   * anything local is touched, and a failed swap restores the safety copy.
   */
  async restore(recoveryKey: string): Promise<void> {
    // On a fresh machine the DEK isn't cached yet — unlock it from the recovery
    // key first, then decrypt the backup with it.
    if (!this.e2ee.hasLocalDek()) await this.e2ee.unlock(recoveryKey);
    const dek = this.e2ee.getDek();
    const accountId = await this.accountId();

    const blob = await this.api.getBackup();
    const plaintext = isEncryptedPayload(blob)
      ? decryptForSync(blob, dek, syncAad(accountId, 'account', 'backup'))
      : // Legacy/dev backups predate the DEK and were passphrase-encrypted
        // (BSBK). Transitional only — cloud was never deployed with them.
        await decryptBackupWithPassphrase(blob, recoveryKey);

    // The decrypted copy stays under userData (next to the live DB), never
    // the world-readable temp dir, and is removed before the relaunch.
    const tmpPath = path.join(app.getPath('userData'), `restore-${crypto.randomUUID()}.db`);
    fs.writeFileSync(tmpPath, plaintext);

    // Validate before touching the live DB: real SQLite file, has the
    // app_settings table, and isn't from a newer schema than this build
    // understands (migrations only run forward). Failures here leave the
    // running app untouched.
    try {
      let backupSchema: number;
      try {
        const testDb = new Database(tmpPath, { readonly: true });
        const hasSettings = testDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")
          .get();
        backupSchema = hasSettings
          ? ((testDb.prepare('SELECT MAX(version) AS version FROM schema_version').get() as any)
              ?.version ?? 0)
          : -1;
        testDb.close();
      } catch {
        backupSchema = -1;
      }
      if (backupSchema < 0) {
        throw new Error('The downloaded backup is not a valid BidSheet database.');
      }
      const localSchema =
        (this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as any)
          ?.version ?? 0;
      if (backupSchema > localSchema) {
        throw new Error(
          'This backup was made by a newer version of BidSheet. Update BidSheet, then restore.'
        );
      }
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      throw err;
    }

    // Point of no return: the live connection closes here, so every path
    // below ends in a relaunch — into the backup on success, into the
    // safety copy on failure.
    const dbPath = getDbPath();
    const safetyPath = dbPath + '.pre-restore';
    // The backup carries whatever session + DEK were live when it was made —
    // stale by now (the access/refresh tokens have rotated). Capture this
    // device's current, just-authenticated session and freshly-unlocked DEK so
    // we can re-stamp them onto the restored DB; otherwise the relaunch inherits
    // the backup's dead refresh token and silently signs the user out. This is
    // device-local state, never document data.
    const liveSession = this.db
      .prepare(
        `SELECT email, user_id, account_id, refresh_token_enc, dek_enc, dek_fingerprint,
                member_priv_enc, member_pub, e2ee_format
         FROM cloud_auth WHERE id = 1`
      )
      .get() as Record<string, string | null> | undefined;
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath, safetyPath);
    this.db.close();
    try { fs.unlinkSync(dbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch (_) {}

    try {
      fs.copyFileSync(tmpPath, dbPath);
      try { fs.unlinkSync(safetyPath); } catch (_) {}
      this.carryOverSession(dbPath, liveSession);
      logger.info('cloud-backup', 'Database restored from cloud backup. Relaunching.');
    } catch (err: any) {
      logger.error('cloud-backup', 'Restore swap failed; restoring original DB', err.message);
      try { fs.copyFileSync(safetyPath, dbPath); fs.unlinkSync(safetyPath); } catch (_) {}
      // The relaunch comes up in the OLD database — without this the user has
      // no idea the restore didn't happen. showErrorBox is synchronous and
      // safe this late in shutdown.
      try {
        const { dialog } = require('electron');
        dialog.showErrorBox(
          'Cloud restore failed',
          'The downloaded backup could not be swapped in, so your previous data was kept. ' +
            'BidSheet will now restart with your existing data. Please try the restore again.\n\n' +
            `Details: ${err.message}`
        );
      } catch (_) {}
    }
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    app.relaunch();
    app.exit(0);
  }

  // ---- helpers ----

  private row(): any {
    return this.db
      .prepare('SELECT backup_last_at, backup_last_hash FROM cloud_auth WHERE id = 1')
      .get();
  }

  // Last-upload bookkeeping sidecar. Deliberately a separate file, not a
  // cloud_auth column: anything written into the DB is part of the bytes the
  // next backupNow hashes.
  private stateFile(): string {
    return path.join(app.getPath('userData'), 'cloud-backup-state.json');
  }

  private readState(): { accountId: string; hash: string; at: string } | null {
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile(), 'utf8'));
      return s && typeof s.accountId === 'string' && typeof s.hash === 'string' ? s : null;
    } catch {
      return null;
    }
  }

  private writeState(accountId: string, hash: string): void {
    try {
      fs.writeFileSync(
        this.stateFile(),
        JSON.stringify({ accountId, hash, at: new Date().toISOString() })
      );
    } catch (err: any) {
      // Worst case the next pass re-uploads once — never fail the backup.
      logger.warn('cloud-backup', 'Could not persist backup state', err.message);
    }
  }

  private clearState(): void {
    try {
      fs.unlinkSync(this.stateFile());
    } catch (_) {}
  }

  private async accountId(): Promise<string> {
    const cached = this.auth.getAccountId();
    if (cached) return cached;
    const me = await this.api.me();
    this.auth.setAccountId(me.account.id);
    return me.account.id;
  }

  /**
   * Re-stamp this device's live session + unlocked DEK onto the freshly
   * restored DB so the relaunch stays signed in (aal2 survives a refresh) and
   * encrypted-unlocked — no re-entering the recovery key. Best effort: the
   * user's data is already safely swapped in, so a failure here at worst means
   * signing in again, never lost data.
   */
  private carryOverSession(
    dbPath: string,
    session: Record<string, string | null> | undefined
  ): void {
    if (!session?.refresh_token_enc) return;
    let restored: Database.Database | undefined;
    try {
      restored = new Database(dbPath);
      const cols = new Set(
        (restored.prepare('PRAGMA table_info(cloud_auth)').all() as any[]).map((c) => c.name)
      );
      // A pre-v30 backup lacks dek_enc/dek_fingerprint; migrations add them on
      // the next open, so only carry the columns the restored schema holds now.
      // member_priv_enc/member_pub/e2ee_format ride along too: without them a
      // format-2 member who restores can no longer regenerate a recovery key
      // (localPrivateKey() null) even though state() reports unlocked.
      const fields = [
        'email',
        'user_id',
        'account_id',
        'refresh_token_enc',
        'dek_enc',
        'dek_fingerprint',
        'member_priv_enc',
        'member_pub',
        'e2ee_format',
      ].filter((c) => cols.has(c));
      restored.prepare('INSERT OR IGNORE INTO cloud_auth (id) VALUES (1)').run();
      restored
        .prepare(`UPDATE cloud_auth SET ${fields.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`)
        .run(...fields.map((c) => session[c] ?? null));
    } catch (err: any) {
      logger.warn('cloud-backup', 'Could not carry session onto restored DB', err.message);
    } finally {
      try { restored?.close(); } catch (_) {}
    }
  }
}

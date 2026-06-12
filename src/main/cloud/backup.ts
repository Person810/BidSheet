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
import { CloudAuth, encryptToken, decryptToken } from './supabase-auth';
import { CloudApiClient, CloudBackupMeta } from './api-client';
import {
  generateSalt,
  deriveBackupKey,
  encryptBackup,
  decryptBackupWithPassphrase,
} from './backup-crypto';

export interface BackupStatus {
  /** A backup key exists on this machine — backups run automatically. */
  configured: boolean;
  lastBackupAt: string | null;
}

const MIN_PASSPHRASE_LENGTH = 10;

export class BackupEngine {
  constructor(
    private db: Database.Database,
    private auth: CloudAuth,
    private api: CloudApiClient
  ) {}

  status(): BackupStatus {
    const row = this.row();
    return {
      configured: !!row?.backup_key_enc,
      lastBackupAt: row?.backup_last_at ?? null,
    };
  }

  async remoteMeta(): Promise<CloudBackupMeta | null> {
    return this.api.getBackupMeta();
  }

  /**
   * Set (or replace) the backup passphrase, then push the first backup.
   * Replacing the passphrase re-encrypts from scratch under the new key —
   * the old blob is simply overwritten.
   */
  async enable(passphrase: string): Promise<void> {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Backup passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    const salt = generateSalt();
    const key = await deriveBackupKey(passphrase, salt);
    this.db
      .prepare(
        `UPDATE cloud_auth SET backup_salt = ?, backup_key_enc = ?, backup_last_hash = NULL,
                backup_last_at = NULL WHERE id = 1`
      )
      .run(salt.toString('hex'), encryptToken(key.toString('hex')));
    logger.info('cloud-backup', 'Encrypted backup configured');
    await this.backupNow(true);
  }

  /** Stop backing up from this machine and remove the cloud copy. */
  async disable(): Promise<void> {
    await this.api.deleteBackup().catch((err) => {
      // Best effort — clearing the local key alone still stops backups.
      logger.warn('cloud-backup', 'Could not delete cloud backup copy', err.message);
    });
    this.db
      .prepare(
        `UPDATE cloud_auth SET backup_salt = NULL, backup_key_enc = NULL,
                backup_last_hash = NULL, backup_last_at = NULL WHERE id = 1`
      )
      .run();
    logger.info('cloud-backup', 'Encrypted backup disabled; cloud copy removed');
  }

  /**
   * Encrypt and upload the database. Skips silently when the bytes haven't
   * changed since the last upload (unless forced) — sync passes call this
   * after every run.
   */
  async backupNow(force = false): Promise<{ uploaded: boolean }> {
    const { key, salt } = this.requireKey();

    this.db.pragma('wal_checkpoint(TRUNCATE)');
    const plaintext = fs.readFileSync(getDbPath());
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
    if (!force && hash === this.row()?.backup_last_hash) {
      return { uploaded: false };
    }

    const schemaVersion =
      (this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as any)
        ?.version ?? 0;
    await this.api.putBackup(encryptBackup(plaintext, key, salt), app.getVersion(), schemaVersion);
    this.db
      .prepare(
        `UPDATE cloud_auth SET backup_last_hash = ?, backup_last_at = datetime('now', 'localtime')
         WHERE id = 1`
      )
      .run(hash);
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
  async restore(passphrase: string): Promise<void> {
    const blob = await this.api.getBackup();
    const plaintext = await decryptBackupWithPassphrase(blob, passphrase);

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
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath, safetyPath);
    this.db.close();
    try { fs.unlinkSync(dbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch (_) {}

    try {
      fs.copyFileSync(tmpPath, dbPath);
      try { fs.unlinkSync(safetyPath); } catch (_) {}
      logger.info('cloud-backup', 'Database restored from cloud backup. Relaunching.');
    } catch (err: any) {
      logger.error('cloud-backup', 'Restore swap failed; restoring original DB', err.message);
      try { fs.copyFileSync(safetyPath, dbPath); fs.unlinkSync(safetyPath); } catch (_) {}
    }
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    app.relaunch();
    app.exit(0);
  }

  // ---- helpers ----

  private row(): any {
    return this.db
      .prepare(
        'SELECT backup_salt, backup_key_enc, backup_last_at, backup_last_hash FROM cloud_auth WHERE id = 1'
      )
      .get();
  }

  private requireKey(): { key: Buffer; salt: Buffer } {
    const row = this.row();
    if (!row?.backup_key_enc || !row?.backup_salt) {
      throw new Error('Encrypted backup is not set up on this computer yet.');
    }
    const keyHex = decryptToken(row.backup_key_enc);
    if (!keyHex) {
      throw new Error(
        'Could not unlock the backup key from the OS keychain. Re-enter your backup passphrase in Settings → Cloud Sync.'
      );
    }
    return { key: Buffer.from(keyHex, 'hex'), salt: Buffer.from(row.backup_salt, 'hex') };
  }
}

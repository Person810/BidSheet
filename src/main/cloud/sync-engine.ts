/**
 * Per-job cloud sync engine (Phase 3).
 *
 * Change detection is hash-based: each check serializes every sync-enabled
 * job and compares against the hashes recorded at the last successful sync —
 * last_hash_local (this machine's serialization; row ids included) and
 * last_hash_remote (the hash the cloud advertises via GET /jobs). The two
 * are tracked separately because row ids shift when a snapshot is imported.
 *
 *   local changed only  → push
 *   remote changed only → pull (safe: local serialization is untouched)
 *   both changed        → mark conflict; the user picks a side
 *
 * Push order matters: files first (plan, markup, job.json), then
 * PUT /jobs/:id with the new snapshot_hash as the commit marker — another
 * seat never sees a hash whose job.json hasn't landed yet.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { logger } from '../logger';
import { CloudAuth } from './supabase-auth';
import { CloudApiClient, CloudApiError, CloudJob, CloudCatalogMeta } from './api-client';
import {
  exportJob,
  importJob,
  buildMarkupDoc,
  snapshotHash,
  JobSnapshot,
} from './serializer';
import { validateSnapshot } from './validate-snapshot';
import { exportCatalog, importCatalog, catalogHash, CatalogSnapshot } from './catalog-sync';
import { E2eeManager } from './e2ee';
import { encryptForSync, decryptForSync, syncAad, syncContentMac } from './sync-crypto';

/** Back-to-back window focuses don't re-sync; Sync Now always does. */
const FOREGROUND_SYNC_THROTTLE_MS = 2 * 60 * 1000;

export interface JobSyncInfo {
  jobId: number;
  cloudId: string;
  name: string;
  enabled: boolean;
  status: 'pending' | 'synced' | 'conflict' | 'error';
  error: string | null;
  lastSyncedAt: string | null;
}

export interface CloudOnlyJob {
  cloudId: string;
  name: string;
  status: string | null;
  updatedAt: string | null;
  bytesUsed: number;
}

export interface SyncOverview {
  jobs: JobSyncInfo[];
  cloudOnly: CloudOnlyJob[];
  syncing: boolean;
  lastCheckAt: string | null;
  /** True when this device has cloud key material to unlock before it can sync. */
  e2eeLocked: boolean;
}

export interface RestoreResult {
  cloudId: string;
  name: string;
  ok: boolean;
  error: string | null;
}

export class SyncEngine {
  private syncing = false;
  private lastCheckAt: string | null = null;
  private cloudOnly: CloudOnlyJob[] = [];
  private lastForegroundSync = 0;
  private e2eeLocked = false;
  /** Runs after every successful full pass (encrypted backup rides here). */
  onSyncSuccess: (() => Promise<void>) | null = null;

  constructor(
    private db: Database.Database,
    private auth: CloudAuth,
    private api: CloudApiClient,
    private e2ee: E2eeManager
  ) {}

  /**
   * No idle polling, ever (roadmap §8 design rule): a fleet of devices on a
   * timer costs more idle than active. Sync happens when the user returns
   * to the app (throttled), on launch, and on the manual Sync Now button.
   */
  startAutoSync(): void {
    app.on('browser-window-focus', () => {
      if (this.auth.status().aal !== 'aal2' || this.syncing) return;
      if (Date.now() - this.lastForegroundSync < FOREGROUND_SYNC_THROTTLE_MS) return;
      this.lastForegroundSync = Date.now();
      this.checkAll().catch((err) =>
        logger.warn('cloud-sync', 'Foreground sync failed', err.message)
      );
    });
  }

  // ---- per-job controls ----

  /** Turn sync on for a job (assigns its cloud id on first enable) and push. */
  async enableJob(jobId: number): Promise<void> {
    const job = this.db.prepare('SELECT id, cloud_id FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) throw new Error('Job not found.');
    if (!job.cloud_id) {
      this.db.prepare('UPDATE jobs SET cloud_id = ? WHERE id = ?').run(crypto.randomUUID(), jobId);
    }
    this.db
      .prepare(
        `INSERT INTO cloud_sync_state (job_id, enabled, status) VALUES (?, 1, 'pending')
         ON CONFLICT (job_id) DO UPDATE SET enabled = 1, status = 'pending', error = NULL`
      )
      .run(jobId);
    await this.pushJob(jobId);
  }

  /**
   * Force the next sync pass to re-upload every synced job, the catalog, and
   * the backup — overwriting (at their existing R2 keys) any plaintext a
   * pre-E2EE client left behind. Called right after E2EE is first enabled, so
   * "turn on encryption" actually encrypts what's already in the cloud rather
   * than only new edits. Clearing the *local* change-hashes (not the remote
   * ones) makes every job look locally-changed → push, never a false conflict;
   * nulling plan_hash forces the plan to re-upload as ciphertext too.
   */
  markAllForReencryption(): void {
    this.db
      .prepare('UPDATE cloud_sync_state SET last_hash_local = NULL, plan_hash = NULL WHERE enabled = 1')
      .run();
    this.db.prepare('UPDATE cloud_catalog_sync SET last_hash_local = NULL WHERE id = 1').run();
    this.db.prepare('UPDATE cloud_auth SET backup_last_hash = NULL WHERE id = 1').run();
  }

  /** Phase 3 just stops syncing; removing cloud copies is the Phase 6 ladder. */
  disableJob(jobId: number): void {
    this.db.prepare('UPDATE cloud_sync_state SET enabled = 0 WHERE job_id = ?').run(jobId);
    this.notifyRenderer();
  }

  async pushJob(jobId: number, opts: { force?: boolean } = {}): Promise<void> {
    const accountId = await this.requireAccountId();
    const dek = this.e2ee.getDek(); // throws cleanly if encrypted sync is locked
    const job = this.db.prepare('SELECT cloud_id FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job?.cloud_id) throw new Error('Job has no cloud id. Enable sync first.');
    const cloudId = job.cloud_id as string;

    try {
      const snapshot = exportJob(this.db, jobId);
      const state = this.getState(jobId);
      const expectedRemote: string | null = state?.last_hash_remote ?? null;

      // Lost-update guard: checkAll compares against the job list snapshot
      // taken at PASS START, so seat B (which read the list before seat A's
      // push landed) would compute remoteChanged=false and overwrite A's
      // snapshot with no conflict flagged. Re-check the job's CURRENT hash
      // right before uploading any bytes, and (below) push the commit marker
      // with a compare-and-swap so even a push racing into that last window
      // turns into a visible conflict instead of a silent overwrite. `force`
      // (conflict resolved as keep-local) skips both.
      if (!opts.force) {
        let remote: CloudJob | null | undefined;
        try {
          remote = await this.api.getJob(cloudId);
        } catch {
          remote = undefined; // couldn't check — the CAS on putJob still guards the commit
        }
        if (remote && (remote.snapshot_hash ?? null) !== expectedRemote) {
          this.saveState(jobId, {
            status: 'conflict',
            error: 'Changed both here and in the cloud since the last sync.',
          });
          return;
        }
      }

      // Plan PDF: content-addressed so unchanged plans never re-upload. The
      // dedup key includes the FILENAME as well as the bytes: a rename of the
      // same bytes changes the R2 key other seats fetch, so skipping the
      // upload on hash alone would point snapshot.plan.filename at an object
      // that was never uploaded (every pull/restore of the job then 404s).
      const settings = this.db
        .prepare('SELECT pdf_path FROM takeoff_job_settings WHERE job_id = ?')
        .get(jobId) as any;
      let planHash = state?.plan_hash ?? null;
      if (settings?.pdf_path && fs.existsSync(settings.pdf_path)) {
        const bytes = fs.readFileSync(settings.pdf_path);
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        const filename = path.basename(settings.pdf_path);
        snapshot.plan = { filename, sha256: sha, size_bytes: bytes.length };
        if (this.planKey(sha, filename) !== planHash) {
          // Same R2 key as the (pre-E2EE) plaintext plan, so the ciphertext
          // overwrites it in place — no plaintext copy left behind. The
          // plaintext sha is folded into the AAD so a stale plan ciphertext
          // can't be substituted for the current one without also forging the
          // snapshot's plan.sha256.
          await this.api.putFile(
            `${accountId}/${cloudId}/plans/${filename}`,
            encryptForSync(bytes, dek, syncAad(accountId, cloudId, `plan:${sha}`)),
            'application/octet-stream'
          );
          planHash = this.planKey(sha, filename);
        }
      }

      // Stable content hash (excludes pushed_at/app_version, set just below).
      const hash = snapshotHash(snapshot);
      // What the cloud advertises is an HMAC of that hash under the DEK, so the
      // server can't confirm a guessed snapshot from its hash.
      const remoteHash = syncContentMac(Buffer.from(hash, 'utf8'), dek);
      snapshot.pushed_at = new Date().toISOString();
      snapshot.app_version = app.getVersion();

      await this.api.putFile(
        `${accountId}/${cloudId}/markup/takeoff.json`,
        encryptForSync(
          Buffer.from(JSON.stringify(buildMarkupDoc(snapshot))),
          dek,
          syncAad(accountId, cloudId, 'markup')
        ),
        'application/octet-stream'
      );
      await this.api.putFile(
        `${accountId}/${cloudId}/job/job.json`,
        encryptForSync(Buffer.from(JSON.stringify(snapshot)), dek, syncAad(accountId, cloudId, 'job')),
        'application/octet-stream'
      );
      // Name (and status) are content → encrypted into one blob; the cloud
      // stores only ciphertext + the HMAC commit marker.
      const nameEnc = encryptForSync(
        Buffer.from(JSON.stringify({ name: snapshot.job.name, status: snapshot.job.status ?? null })),
        dek,
        syncAad(accountId, cloudId, 'name')
      ).toString('base64');
      // The commit marker is compare-and-swapped against the hash this seat
      // last synced; the Worker answers 412 snapshot_conflict if another seat
      // committed in between.
      await this.api.putJob(cloudId, {
        name_enc: nameEnc,
        snapshot_hash: remoteHash,
        ...(opts.force ? {} : { expected_snapshot_hash: expectedRemote }),
      });

      this.saveState(jobId, {
        last_hash_local: hash,
        last_hash_remote: remoteHash,
        plan_hash: planHash,
        status: 'synced',
        error: null,
      });
      logger.info('cloud-sync', `Pushed job ${jobId} (${snapshot.job.name})`);
    } catch (err: any) {
      if (err instanceof CloudApiError && err.code === 'snapshot_conflict') {
        this.saveState(jobId, {
          status: 'conflict',
          error: 'Changed both here and in the cloud since the last sync.',
        });
        return;
      }
      this.saveState(jobId, { status: 'error', error: err.message });
      throw err;
    } finally {
      this.notifyRenderer();
    }
  }

  /** Pull a cloud job down, creating or replacing its local copy. */
  async pullJob(cloudId: string): Promise<number> {
    const accountId = await this.requireAccountId();
    const dek = this.e2ee.getDek();
    // Decrypt, then validate — the decrypted snapshot is still untrusted input
    // (a member device could push a malicious payload), and plan.filename below
    // touches the filesystem. Decryption also authenticates the ciphertext's
    // account/job binding via the AAD before we parse anything.
    const jobBlob = await this.api.getFile(`${accountId}/${cloudId}/job/job.json`);
    const jobPlain = decryptForSync(jobBlob, dek, syncAad(accountId, cloudId, 'job'));
    const snapshot = validateSnapshot(JSON.parse(jobPlain.toString('utf8')));
    // The HMAC the cloud advertises for this job (matches what the pusher sent).
    const remoteHash = syncContentMac(Buffer.from(snapshotHash(snapshot), 'utf8'), dek);

    // Download the plan unless this machine already has the same bytes.
    let pdfPath: string | undefined;
    if (snapshot.plan) {
      const existing = this.db
        .prepare(
          `SELECT s.pdf_path FROM takeoff_job_settings s
           JOIN jobs j ON j.id = s.job_id WHERE j.cloud_id = ?`
        )
        .get(cloudId) as any;
      const localMatches =
        existing?.pdf_path &&
        fs.existsSync(existing.pdf_path) &&
        crypto.createHash('sha256').update(fs.readFileSync(existing.pdf_path)).digest('hex') ===
          snapshot.plan.sha256;
      if (!localMatches) {
        const blob = await this.api.getFile(`${accountId}/${cloudId}/plans/${snapshot.plan.filename}`);
        const bytes = decryptForSync(blob, dek, syncAad(accountId, cloudId, `plan:${snapshot.plan.sha256}`));
        const dir = path.join(app.getPath('userData'), 'cloud-plans', cloudId);
        fs.mkdirSync(dir, { recursive: true });
        // basename: validation already rejects separators in plan.filename,
        // but a server-supplied name never gets to pick the directory.
        pdfPath = path.join(dir, path.basename(snapshot.plan.filename));
        fs.writeFileSync(pdfPath, bytes);
      }
    }

    const result = importJob(this.db, cloudId, snapshot, { pdfPath });
    if (result.droppedCatalogRefs > 0) {
      logger.warn(
        'cloud-sync',
        `Job ${result.jobId}: ${result.droppedCatalogRefs} catalog link(s) not on this machine were cleared (costs kept)`
      );
    }

    this.db
      .prepare(
        `INSERT INTO cloud_sync_state (job_id, enabled, status) VALUES (?, 1, 'synced')
         ON CONFLICT (job_id) DO UPDATE SET enabled = 1, status = 'synced', error = NULL`
      )
      .run(result.jobId);
    this.saveState(result.jobId, {
      // Recompute over this machine's rows — ids changed on import.
      last_hash_local: snapshotHash(this.withPlan(exportJob(this.db, result.jobId), snapshot.plan)),
      last_hash_remote: remoteHash,
      plan_hash: snapshot.plan ? this.planKey(snapshot.plan.sha256, snapshot.plan.filename) : null,
      status: 'synced',
      error: null,
    });
    logger.info('cloud-sync', `Pulled job ${result.jobId} (${snapshot.job.name}) from cloud`);
    this.notifyRenderer();
    return result.jobId;
  }

  /**
   * One full sync pass: push local edits, pull remote edits, flag conflicts,
   * and refresh the cloud-only job list.
   */
  async checkAll(): Promise<SyncOverview> {
    if (this.syncing) return this.overview();
    this.syncing = true;
    this.notifyRenderer();
    try {
      const accountId = await this.requireAccountId();
      // E2EE gate: without an unlocked DEK we can neither read nor write cloud
      // data. Surface the locked state (and list the still-encrypted cloud jobs)
      // instead of erroring every job in turn.
      if (!this.e2ee.hasLocalDek()) {
        this.e2eeLocked = true;
        await this.refreshCloudOnlyLocked();
        this.lastCheckAt = new Date().toISOString();
        return this.overview();
      }
      this.e2eeLocked = false;
      const dek = this.e2ee.getDek();
      const cloud = await this.api.listSync();
      const remote = new Map(cloud.jobs.map((j) => [j.id, j]));

      // Catalog before jobs, so a pulled job's catalog UUID refs resolve
      // against rows that arrived in the same pass. A catalog failure is
      // logged, not fatal — job sync still runs.
      try {
        await this.syncCatalog(cloud.catalog, accountId, dek);
      } catch (err: any) {
        logger.warn('cloud-sync', 'Catalog sync failed', err.message);
      }

      const local = this.db
        .prepare(
          `SELECT j.id, j.cloud_id, s.last_hash_local, s.last_hash_remote, s.status
           FROM jobs j JOIN cloud_sync_state s ON s.job_id = j.id
           WHERE s.enabled = 1 AND j.cloud_id IS NOT NULL`
        )
        .all() as any[];

      for (const row of local) {
        try {
          const cloud = remote.get(row.cloud_id);
          const snapshot = exportJob(this.db, row.id);
          const localHash = snapshotHash(this.withPlanFromDisk(snapshot, row.id));
          const localChanged = localHash !== row.last_hash_local;
          const remoteChanged = !!cloud && cloud.snapshot_hash !== row.last_hash_remote;

          if (!cloud || (localChanged && !remoteChanged)) {
            await this.pushJob(row.id);
          } else if (!localChanged && remoteChanged) {
            await this.pullJob(row.cloud_id);
          } else if (localChanged && remoteChanged) {
            this.saveState(row.id, {
              status: 'conflict',
              error: 'Changed both here and in the cloud since the last sync.',
            });
          } else if (row.status !== 'synced') {
            this.saveState(row.id, { status: 'synced', error: null });
          }
        } catch (err: any) {
          this.saveState(row.id, { status: 'error', error: err.message });
          logger.warn('cloud-sync', `Sync failed for job ${row.id}`, err.message);
        }
        remote.delete(row.cloud_id);
      }

      // Whatever remains in the cloud has no local copy on this machine.
      this.cloudOnly = [...remote.values()]
        .filter((j) => !this.localJobForCloudId(j.id))
        .map((j) => {
          const meta = this.decryptJobMeta(accountId, j.id, j.name_enc, dek);
          return {
            cloudId: j.id,
            name: meta.name,
            status: meta.status,
            updatedAt: j.updated_at,
            bytesUsed: j.bytes_used,
          };
        });
      this.lastCheckAt = new Date().toISOString();
      if (this.onSyncSuccess) await this.onSyncSuccess();
      return this.overview();
    } finally {
      this.syncing = false;
      this.notifyRenderer();
    }
  }

  /**
   * Fresh-install restore (Phase 3b): pull every cloud job that has no
   * local copy. Failures are collected per job and surfaced honestly —
   * never a silent partial restore.
   */
  async restoreAll(): Promise<RestoreResult[]> {
    await this.checkAll(); // refresh the cloud-only list first
    const targets = [...this.cloudOnly];
    const results: RestoreResult[] = [];
    for (const job of targets) {
      try {
        await this.pullJob(job.cloudId);
        results.push({ cloudId: job.cloudId, name: job.name, ok: true, error: null });
      } catch (err: any) {
        results.push({ cloudId: job.cloudId, name: job.name, ok: false, error: err.message });
        logger.warn('cloud-sync', `Restore failed for cloud job ${job.cloudId} (${job.name})`, err.message);
      }
    }
    this.cloudOnly = this.cloudOnly.filter((j) => !results.some((r) => r.ok && r.cloudId === j.cloudId));
    this.notifyRenderer();
    return results;
  }

  /**
   * Catalog sync (Phase 3d): row-level merge keyed on the v28 UUIDs.
   * Remote changes are pulled and merged in (remote wins per row, with a
   * visible toast — never silent); if the merged result still differs from
   * the cloud (local additions/edits), it's pushed back. Two seats editing
   * different rows both survive; same-row collisions go to the last pusher.
   */
  private async syncCatalog(
    remoteMeta: CloudCatalogMeta | null,
    accountId: string,
    dek: Buffer
  ): Promise<void> {
    const state = this.db.prepare('SELECT * FROM cloud_catalog_sync WHERE id = 1').get() as any;
    const aad = syncAad(accountId, 'account', 'catalog');
    let snapshot = exportCatalog(this.db);
    // last_hash_local stays the bare content hash (local edit detection, never
    // leaves the device); the cloud advertises an HMAC of it (remoteMac), so the
    // server can't confirm catalog contents from the tag.
    let localHash = catalogHash(snapshot);
    let localMac = syncContentMac(Buffer.from(localHash, 'utf8'), dek);
    let remoteMac = remoteMeta?.hash ?? null;
    const localChanged = localHash !== state?.last_hash_local;
    const remoteChanged = !!remoteMac && remoteMac !== state?.last_hash_remote;
    if (remoteMeta && !localChanged && !remoteChanged) return;

    if (remoteChanged && remoteMac !== localMac) {
      const blob = await this.api.getCatalog();
      const remoteCatalog = JSON.parse(
        decryptForSync(blob, dek, aad).toString('utf8')
      ) as CatalogSnapshot;
      const result = importCatalog(this.db, remoteCatalog);
      if (result.applied > 0) {
        logger.info('cloud-catalog', `Catalog updated from cloud (${result.applied} change(s))`);
        // "Catalog updated from cloud" toast — never silent.
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('cloud-catalog-updated', { applied: result.applied });
          }
        }
      }
      snapshot = exportCatalog(this.db);
      localHash = catalogHash(snapshot);
      localMac = syncContentMac(Buffer.from(localHash, 'utf8'), dek);
    }

    if (!remoteMeta || localMac !== remoteMac) {
      snapshot.pushed_at = new Date().toISOString();
      snapshot.app_version = app.getVersion();
      await this.api.putCatalog(
        encryptForSync(Buffer.from(JSON.stringify(snapshot)), dek, aad),
        localMac
      );
      remoteMac = localMac;
      logger.info('cloud-catalog', 'Pushed catalog to cloud');
    }

    this.db
      .prepare(
        `UPDATE cloud_catalog_sync SET last_hash_local = ?, last_hash_remote = ?,
                last_synced_at = datetime('now', 'localtime') WHERE id = 1`
      )
      .run(localHash, remoteMac);
  }

  /** User picked a side for a conflicted job. */
  async resolveConflict(jobId: number, keep: 'local' | 'cloud'): Promise<void> {
    const job = this.db.prepare('SELECT cloud_id FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job?.cloud_id) throw new Error('Job has no cloud id.');
    if (keep === 'local') {
      // Deliberate overwrite: skip the lost-update guards or the push would
      // just re-flag the very conflict the user resolved.
      await this.pushJob(jobId, { force: true });
    } else {
      await this.pullJob(job.cloud_id);
    }
  }

  overview(): SyncOverview {
    const jobs = this.db
      .prepare(
        `SELECT j.id AS jobId, j.cloud_id AS cloudId, j.name, s.enabled, s.status,
                s.error, s.last_synced_at AS lastSyncedAt
         FROM jobs j JOIN cloud_sync_state s ON s.job_id = j.id
         ORDER BY j.name`
      )
      .all() as any[];
    return {
      jobs: jobs.map((j) => ({ ...j, enabled: !!j.enabled })),
      cloudOnly: this.cloudOnly,
      syncing: this.syncing,
      lastCheckAt: this.lastCheckAt,
      e2eeLocked: this.e2eeLocked,
    };
  }

  // ---- helpers ----

  /**
   * Decrypt a cloud job's {name, status} blob. Falls back to a placeholder if
   * it can't be read (locked, tampered, or a legacy plaintext name) so the
   * restore picker still renders.
   */
  private decryptJobMeta(
    accountId: string,
    cloudId: string,
    nameEnc: string | null,
    dek: Buffer
  ): { name: string; status: string | null } {
    if (!nameEnc) return { name: '(no name)', status: null };
    try {
      const plain = decryptForSync(
        Buffer.from(nameEnc, 'base64'),
        dek,
        syncAad(accountId, cloudId, 'name')
      );
      const parsed = JSON.parse(plain.toString('utf8'));
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '(no name)',
        status: typeof parsed.status === 'string' ? parsed.status : null,
      };
    } catch {
      return { name: '(locked)', status: null };
    }
  }

  /**
   * Locked-device path: list cloud jobs without a local copy, names shown as
   * "(locked)" since we can't decrypt them until the user enters the recovery
   * key. Best-effort — a network failure just leaves the list empty.
   */
  private async refreshCloudOnlyLocked(): Promise<void> {
    try {
      const cloud = await this.api.listSync();
      this.cloudOnly = cloud.jobs
        .filter((j) => !this.localJobForCloudId(j.id))
        .map((j) => ({
          cloudId: j.id,
          name: '(locked)',
          status: null,
          updatedAt: j.updated_at,
          bytesUsed: j.bytes_used,
        }));
    } catch (err: any) {
      // A pending (un-approved) member is expected to be denied the job list —
      // that's the server hiding the org corpus until an owner approves them, not
      // a fault. Stay quiet; any other failure is worth a warning.
      if (err?.code !== 'pending_approval') {
        logger.warn('cloud-sync', 'Could not list cloud jobs while locked', err.message);
      }
      this.cloudOnly = [];
    }
  }

  /**
   * cloud_sync_state.plan_hash dedup key: bytes AND name. Older rows hold a
   * bare sha, which simply mismatches once and re-uploads — self-healing.
   */
  private planKey(sha256: string, filename: string): string {
    return `${sha256}:${filename}`;
  }

  private withPlan(snapshot: JobSnapshot, plan: JobSnapshot['plan']): JobSnapshot {
    snapshot.plan = plan;
    return snapshot;
  }

  /** Attach the plan ref exactly as pushJob would, so hashes are comparable. */
  private withPlanFromDisk(snapshot: JobSnapshot, jobId: number): JobSnapshot {
    const settings = this.db
      .prepare('SELECT pdf_path FROM takeoff_job_settings WHERE job_id = ?')
      .get(jobId) as any;
    if (settings?.pdf_path && fs.existsSync(settings.pdf_path)) {
      const bytes = fs.readFileSync(settings.pdf_path);
      snapshot.plan = {
        filename: path.basename(settings.pdf_path),
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        size_bytes: bytes.length,
      };
    }
    return snapshot;
  }

  private localJobForCloudId(cloudId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM jobs WHERE cloud_id = ?').get(cloudId);
  }

  private getState(jobId: number): any {
    return this.db.prepare('SELECT * FROM cloud_sync_state WHERE job_id = ?').get(jobId);
  }

  private saveState(
    jobId: number,
    fields: Partial<{
      last_hash_local: string | null;
      last_hash_remote: string | null;
      plan_hash: string | null;
      status: string;
      error: string | null;
    }>
  ): void {
    const sets = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(', ');
    this.db
      .prepare(
        `UPDATE cloud_sync_state SET ${sets}, last_synced_at = datetime('now', 'localtime')
         WHERE job_id = ?`
      )
      .run(...Object.values(fields), jobId);
  }

  /** User the cached account id was verified for (one /me per sign-in). */
  private accountVerifiedForUser: string | null = null;

  private async requireAccountId(): Promise<string> {
    if (this.auth.status().aal !== 'aal2') {
      throw new Error('Sign in (with your authenticator code) to use cloud sync.');
    }
    const userId = this.auth.getUserId();
    const stored = this.auth.getAccountId();
    if (stored && this.accountVerifiedForUser === userId) return stored;

    const me = await this.api.me();
    const accountId = me.account.id;
    if (stored && stored !== accountId) {
      // Signed into a different account than the one this machine's cloud
      // ids belong to. Those ids (and the pushed-plan hashes) are meaningless
      // against the new account — keep them and pushes half-attach to the old
      // account's records. Reset; each job re-enables with a fresh id and a
      // full push.
      logger.warn(
        'cloud-sync',
        `Cloud account changed (${stored} -> ${accountId}) — resetting per-job sync state`
      );
      this.resetSyncBookkeeping();
      // The cached DEK belongs to the old account — it cannot decrypt the new
      // account's data and must not be used to encrypt under it. Forget it;
      // the new account sets up or unlocks its own encrypted sync.
      this.e2ee.lockLocal();
      this.notifyRenderer();
    }
    this.auth.setAccountId(accountId);
    this.accountVerifiedForUser = userId;
    return accountId;
  }

  /**
   * Wipe per-account local sync bookkeeping: the per-job cloud ids and the
   * backup/catalog change hashes. They're meaningless against a different
   * account; keeping them would half-attach the next push to the old account's
   * records. Does NOT touch the cached DEK — callers decide whether to lock it.
   */
  private resetSyncBookkeeping(): void {
    this.db.prepare('DELETE FROM cloud_sync_state').run();
    this.db.prepare('UPDATE jobs SET cloud_id = NULL WHERE cloud_id IS NOT NULL').run();
    this.db
      .prepare('UPDATE cloud_auth SET backup_last_hash = NULL, backup_last_at = NULL WHERE id = 1')
      .run();
    this.db
      .prepare(
        'UPDATE cloud_catalog_sync SET last_hash_local = NULL, last_hash_remote = NULL WHERE id = 1'
      )
      .run();
    // Force a fresh /me verification on the next pass.
    this.accountVerifiedForUser = null;
  }

  /**
   * Reset local sync state after joining an org via an invite. joinWithInvite
   * pre-sets the new account id, which BYPASSES requireAccountId's account-switch
   * detector — so the stale cloud ids/hashes from the joiner's old (solo) account
   * would otherwise make the next pass push their private jobs into the shared
   * org. The cached DEK/member key is handled by joinWithInvite itself (it clears
   * the old DEK before caching the new member key), so this only wipes the
   * per-job/backup/catalog bookkeeping.
   *
   * Passed INTO joinWithInvite as its applyJoinReset callback so the wipe
   * commits in the same SQLite transaction as the account-id switch (pure DB
   * writes only — no renderer notification here; the IPC layer notifies after
   * the join settles).
   */
  resetSyncStateForJoin(): void {
    this.resetSyncBookkeeping();
  }

  /** Renderer refresh for flows (like the org join) that mutate state outside a sync pass. */
  refreshRenderer(): void {
    this.notifyRenderer();
  }

  private notifyRenderer(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('cloud-sync-status', this.overview());
      }
    }
  }
}

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
import { CloudApiClient, CloudJob } from './api-client';
import {
  exportJob,
  importJob,
  buildMarkupDoc,
  snapshotHash,
  JobSnapshot,
} from './serializer';

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

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
  private timer: NodeJS.Timeout | null = null;
  /** Runs after every successful full pass (encrypted backup rides here). */
  onSyncSuccess: (() => Promise<void>) | null = null;

  constructor(
    private db: Database.Database,
    private auth: CloudAuth,
    private api: CloudApiClient
  ) {}

  startAutoSync(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.auth.status().aal === 'aal2') {
        this.checkAll().catch((err) => logger.warn('cloud-sync', 'Auto-sync failed', err.message));
      }
    }, AUTO_SYNC_INTERVAL_MS);
    this.timer.unref();
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

  /** Phase 3 just stops syncing; removing cloud copies is the Phase 6 ladder. */
  disableJob(jobId: number): void {
    this.db.prepare('UPDATE cloud_sync_state SET enabled = 0 WHERE job_id = ?').run(jobId);
    this.notifyRenderer();
  }

  async pushJob(jobId: number): Promise<void> {
    const accountId = await this.requireAccountId();
    const job = this.db.prepare('SELECT cloud_id FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job?.cloud_id) throw new Error('Job has no cloud id — enable sync first.');
    const cloudId = job.cloud_id as string;

    try {
      const snapshot = exportJob(this.db, jobId);
      const state = this.getState(jobId);

      // Plan PDF: content-addressed so unchanged plans never re-upload.
      const settings = this.db
        .prepare('SELECT pdf_path FROM takeoff_job_settings WHERE job_id = ?')
        .get(jobId) as any;
      let planHash = state?.plan_hash ?? null;
      if (settings?.pdf_path && fs.existsSync(settings.pdf_path)) {
        const bytes = fs.readFileSync(settings.pdf_path);
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        const filename = path.basename(settings.pdf_path);
        snapshot.plan = { filename, sha256: sha, size_bytes: bytes.length };
        if (sha !== planHash) {
          await this.api.putFile(`${accountId}/${cloudId}/plans/${filename}`, bytes, 'application/pdf');
          planHash = sha;
        }
      }

      const hash = snapshotHash(snapshot);
      snapshot.pushed_at = new Date().toISOString();
      snapshot.app_version = app.getVersion();

      await this.api.putFile(
        `${accountId}/${cloudId}/markup/takeoff.json`,
        JSON.stringify(buildMarkupDoc(snapshot)),
        'application/json'
      );
      await this.api.putFile(
        `${accountId}/${cloudId}/job/job.json`,
        JSON.stringify(snapshot),
        'application/json'
      );
      await this.api.putJob(cloudId, {
        name: snapshot.job.name,
        status: snapshot.job.status ?? null,
        snapshot_hash: hash,
      });

      this.saveState(jobId, {
        last_hash_local: hash,
        last_hash_remote: hash,
        plan_hash: planHash,
        status: 'synced',
        error: null,
      });
      logger.info('cloud-sync', `Pushed job ${jobId} (${snapshot.job.name})`);
    } catch (err: any) {
      this.saveState(jobId, { status: 'error', error: err.message });
      throw err;
    } finally {
      this.notifyRenderer();
    }
  }

  /** Pull a cloud job down, creating or replacing its local copy. */
  async pullJob(cloudId: string): Promise<number> {
    const accountId = await this.requireAccountId();
    const snapshot = await this.api.getFileJson<JobSnapshot>(`${accountId}/${cloudId}/job/job.json`);
    const remoteHash = snapshotHash(snapshot);

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
        const bytes = await this.api.getFile(`${accountId}/${cloudId}/plans/${snapshot.plan.filename}`);
        const dir = path.join(app.getPath('userData'), 'cloud-plans', cloudId);
        fs.mkdirSync(dir, { recursive: true });
        pdfPath = path.join(dir, snapshot.plan.filename);
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
      plan_hash: snapshot.plan?.sha256 ?? null,
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
      void accountId;
      const remote = new Map((await this.api.listJobs()).map((j) => [j.id, j]));

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
        .map((j) => ({
          cloudId: j.id,
          name: j.name,
          status: j.status,
          updatedAt: j.updated_at,
          bytesUsed: j.bytes_used,
        }));
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

  /** User picked a side for a conflicted job. */
  async resolveConflict(jobId: number, keep: 'local' | 'cloud'): Promise<void> {
    const job = this.db.prepare('SELECT cloud_id FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job?.cloud_id) throw new Error('Job has no cloud id.');
    if (keep === 'local') {
      await this.pushJob(jobId);
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
    };
  }

  // ---- helpers ----

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
      this.db.prepare('DELETE FROM cloud_sync_state').run();
      this.db.prepare('UPDATE jobs SET cloud_id = NULL WHERE cloud_id IS NOT NULL').run();
      // Backup bookkeeping is account-scoped too: clear the change hash so
      // the next sync pass uploads a full backup to the new account.
      this.db
        .prepare('UPDATE cloud_auth SET backup_last_hash = NULL, backup_last_at = NULL WHERE id = 1')
        .run();
      this.notifyRenderer();
    }
    this.auth.setAccountId(accountId);
    this.accountVerifiedForUser = userId;
    return accountId;
  }

  private notifyRenderer(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('cloud-sync-status', this.overview());
      }
    }
  }
}

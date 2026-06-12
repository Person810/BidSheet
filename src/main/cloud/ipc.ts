/**
 * IPC surface for cloud sync (Phase 3). Mirrors the safeHandle pattern in
 * ipc-handlers.ts: errors are logged and re-thrown with user-readable
 * messages (CloudAuthError/CloudApiError messages already are).
 */

import { ipcMain, shell } from 'electron';
import type Database from 'better-sqlite3';
import { logger } from '../logger';
import { CloudAuth } from './supabase-auth';
import { CloudApiClient } from './api-client';
import { SyncEngine } from './sync-engine';

function handle(channel: string, fn: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (err: any) {
      logger.error(channel, err.message, err.stack);
      throw new Error(err.message || 'Cloud sync error. Check the log for details.');
    }
  });
}

/**
 * Registered instead of the real handlers when local-only mode is on.
 * Nothing cloud-related is constructed — no Supabase client, no Worker
 * requests, no sync timers — so the app's only network activity is the
 * GitHub update check. Only cloud:status gets a handler; every cloud
 * entry point in the renderer hides itself behind this signed-out shape.
 */
export function registerLocalOnlyCloudStub(): void {
  handle('cloud:status', () => ({
    auth: { signedIn: false, email: null, aal: null, needsEnroll: false, needsTotp: false },
    sync: null,
    localOnly: true,
  }));
  logger.info('cloud', 'Local-only mode: cloud sync disabled, no cloud modules loaded');
}

export function registerCloudHandlers(db: Database.Database): SyncEngine {
  const auth = new CloudAuth(db);
  const api = new CloudApiClient(auth);
  const engine = new SyncEngine(db, auth, api);

  // Restore the previous session in the background; if it comes back at
  // aal2, kick off a sync pass so a second seat picks up changes on launch.
  auth
    .restore()
    .then((status) => {
      if (status.aal === 'aal2') {
        return engine.checkAll().then(() => undefined);
      }
    })
    .catch((err) => logger.warn('cloud-auth', 'Session restore failed', err.message));
  engine.startAutoSync();

  // ---- auth ----
  // Attempts and outcomes are info-logged (never passwords/codes) so a
  // "nothing happened" report is diagnosable from the log file.
  handle('cloud:status', () => ({ auth: auth.status(), sync: engine.overview() }));
  handle('cloud:sign-up', async (email: string, password: string) => {
    logger.info('cloud:sign-up', `Attempting sign-up for ${email}`);
    const status = await auth.signUp(email, password);
    logger.info('cloud:sign-up', `Sign-up result: signedIn=${status.signedIn} aal=${status.aal}`);
    return status;
  });
  handle('cloud:sign-in', async (email: string, password: string) => {
    logger.info('cloud:sign-in', `Attempting sign-in for ${email}`);
    const status = await auth.signIn(email, password);
    logger.info('cloud:sign-in', `Sign-in result: signedIn=${status.signedIn} aal=${status.aal} needsEnroll=${status.needsEnroll}`);
    return status;
  });
  handle('cloud:enroll-totp', () => {
    logger.info('cloud:enroll-totp', 'Starting TOTP enrollment');
    return auth.enrollTotp();
  });
  handle('cloud:verify-totp', async (code: string, factorId?: string) => {
    const status = await auth.verifyTotp(code, factorId);
    logger.info('cloud:verify-totp', `Verify result: aal=${status.aal}`);
    return status;
  });
  handle('cloud:sign-out', () => auth.signOut());
  handle('cloud:me', () => api.me());

  // ---- billing ----
  // Payment happens on Paddle's hosted page in the system browser — card
  // details never touch the app. The Worker's Paddle webhook flips the
  // account, which the renderer picks up by polling cloud:me.
  handle('cloud:billing-checkout', async () => {
    const url = await api.checkout();
    logger.info('cloud:billing-checkout', 'Opening hosted checkout in browser');
    await shell.openExternal(url);
    return url;
  });
  handle('cloud:billing-portal', async () => {
    const url = await api.billingPortal();
    await shell.openExternal(url);
    return url;
  });

  // ---- sync ----
  handle('cloud:sync-now', () => engine.checkAll());
  handle('cloud:job-enable', (jobId: number) => engine.enableJob(jobId));
  handle('cloud:job-disable', (jobId: number) => engine.disableJob(jobId));
  handle('cloud:job-push', (jobId: number) => engine.pushJob(jobId));
  handle('cloud:job-pull', (cloudId: string) => engine.pullJob(cloudId));
  handle('cloud:resolve-conflict', (jobId: number, keep: 'local' | 'cloud') =>
    engine.resolveConflict(jobId, keep)
  );

  return engine;
}

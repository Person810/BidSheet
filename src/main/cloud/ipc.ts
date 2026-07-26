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
import { BackupEngine } from './backup';
import { E2eeManager } from './e2ee';
import { pubkeySafetyCode } from './sync-crypto';

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
 * Open a Worker→Paddle-supplied URL in the system browser, but only if it's a
 * real https:// URL. Under the app's compromised-server threat model the
 * checkout/portal link is untrusted input; without this a hostile response
 * could hand shell.openExternal a file:// or custom-scheme URL.
 */
async function openExternalHttps(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Billing service returned an invalid link.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Billing service returned a non-https link; refusing to open it.');
  }
  await shell.openExternal(parsed.href);
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
  const e2ee = new E2eeManager(db, auth, api);
  const engine = new SyncEngine(db, auth, api, e2ee);
  const backup = new BackupEngine(db, auth, api, e2ee);

  // Encrypted backup rides every successful sync pass — change-detected, so
  // an untouched database costs one local hash, not an upload.
  engine.onSyncSuccess = () => backup.afterSync();

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
  handle('cloud:sign-out', async () => {
    // Revoke server-side first — best-effort, never throws, so a dead network
    // can't block a sign-out the user asked for.
    await auth.revokeRemoteSession();
    // Then drop all local state in ONE transaction: the cached DEK + member
    // private key, and the stored session. Two separate writes could land
    // half-applied (SQLITE_BUSY, full disk) leaving the keys gone but the
    // refresh token still on disk — and the next launch would silently restore
    // the session on exactly the shared computer this protects. All-or-nothing
    // means a failure leaves the user signed in with a visible error instead.
    // The next sign-in re-unlocks with the recovery key, as a fresh device would.
    db.transaction(() => {
      e2ee.lockLocal();
      auth.clearLocalSession();
    })();
  });
  handle('cloud:me', () => api.me());

  // ---- billing ----
  // Payment happens on Paddle's hosted page in the system browser — card
  // details never touch the app. The Worker's Paddle webhook flips the
  // account, which the renderer picks up by polling cloud:me.
  handle('cloud:billing-checkout', async () => {
    const url = await api.checkout();
    logger.info('cloud:billing-checkout', 'Opening hosted checkout in browser');
    await openExternalHttps(url);
    return url;
  });
  handle('cloud:billing-portal', async () => {
    const url = await api.billingPortal();
    await openExternalHttps(url);
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
  handle('cloud:restore-all', () => engine.restoreAll());

  // ---- end-to-end encryption (zero-knowledge sync) ----
  // One recovery key per account unlocks the DEK that encrypts all synced data
  // and the backup. setup/regenerate return the recovery key to show exactly
  // once; the renderer forces the user to confirm they saved it.
  handle('cloud:e2ee-state', () => e2ee.state());
  handle('cloud:e2ee-setup', async () => {
    logger.info('cloud:e2ee-setup', 'Enabling encrypted sync (generating DEK + recovery key)');
    const res = await e2ee.setup();
    // Re-encrypt anything a pre-E2EE client already pushed: the next sync pass
    // (kicked off after the user saves the recovery key) re-uploads every job,
    // the catalog, and the backup as ciphertext, overwriting the plaintext.
    engine.markAllForReencryption();
    return res;
  });
  handle('cloud:e2ee-unlock', async (recoveryKey: string) => {
    logger.info('cloud:e2ee-unlock', 'Unlocking encrypted sync on this device');
    await e2ee.unlock(recoveryKey);
  });
  handle('cloud:e2ee-regenerate-recovery', async () => {
    logger.info('cloud:e2ee-regenerate-recovery', 'Regenerating recovery key (re-wrapping DEK)');
    return e2ee.regenerateRecoveryKey();
  });

  // ---- organizations / multi-user ----
  // Owner invites teammates with single-use codes; a newcomer redeems one to
  // join (pending), then an unlocked owner approves them by sealing the DEK to
  // their key. redeem/approve route through E2eeManager because they involve
  // key material; the rest are thin pass-throughs to the Worker.
  // Members carry a device code derived from their registered pubkey. The
  // owner compares it with what the joiner's screen shows before approving —
  // the out-of-band check that stops a tampered server from swapping in its
  // own key and receiving a sealed DEK it can open.
  handle('cloud:org-members', async () => {
    const res = await api.listMembers();
    return {
      ...res,
      // key_binding / invite_enc_token stay in the main process. The renderer
      // only needs to know whether an automatic check is *possible*, so it can
      // pick the right approval prompt; handing the sealed invite token to the
      // UI would spread key-adjacent material for no reason.
      members: res.members.map(({ key_binding, invite_enc_token, invite_id, ...m }) => ({
        ...m,
        safety_code: m.pubkey ? pubkeySafetyCode(Buffer.from(m.pubkey, 'base64')) : null,
        binding_available: !!(key_binding && invite_enc_token && invite_id),
      })),
    };
  });
  handle('cloud:e2ee-safety-code', () => e2ee.mySafetyCode());
  // Invite creation routes through E2eeManager, not the API client: the token
  // is minted here and stored server-side encrypted under the account DEK, so
  // an owner can recover it at approve time to verify the joiner's key binding.
  handle('cloud:org-create-invite', (role?: 'member' | 'owner') => {
    logger.info('cloud:org-create-invite', `Creating ${role ?? 'member'} invite`);
    return e2ee.createInvite(role ?? 'member');
  });
  handle('cloud:org-list-invites', () => api.listInvites());
  handle('cloud:org-revoke-invite', (id: string) => api.revokeInvite(id));
  handle('cloud:org-redeem-invite', async (token: string) => {
    logger.info('cloud:org-redeem-invite', 'Redeeming invite and joining account');
    // The sync-state wipe rides inside joinWithInvite's transaction: switching
    // the stored account id bypasses the engine's account-switch detector, so
    // wiping the stale cloud ids afterwards (as this handler used to) left a
    // crash window where the next pass pushed private solo jobs into the org.
    const res = await e2ee.joinWithInvite(token, () => engine.resetSyncStateForJoin());
    engine.refreshRenderer();
    return res;
  });
  // Returns whether the member's key binding could be checked automatically.
  // `verified: false` means they joined from a client that predates the binding,
  // so the renderer must still ask the owner to compare device codes out of
  // band. A binding that is present and *wrong* throws instead.
  handle('cloud:org-approve-member', async (userId: string) => {
    logger.info('cloud:org-approve-member', `Approving member ${userId}`);
    return e2ee.approveMember(userId);
  });
  handle('cloud:org-remove-member', (userId: string) => api.removeMember(userId));

  // ---- encrypted backup (rides the E2EE DEK) ----
  handle('cloud:backup-status', async () => {
    const local = backup.status();
    let remote = null;
    if (auth.status().aal === 'aal2') {
      remote = await backup.remoteMeta().catch(() => null);
    }
    return { ...local, remote };
  });
  handle('cloud:backup-now', () => backup.backupNow(true));
  handle('cloud:backup-disable', () => backup.disable());
  handle('cloud:backup-restore', async (recoveryKey: string) => {
    logger.info('cloud:backup-restore', 'Restoring database from encrypted cloud backup');
    await backup.restore(recoveryKey);
  });

  return engine;
}

import React, { useState, useEffect, useRef } from 'react';
import { useToastStore } from '../stores/toast-store';
import { useCloudStore, initCloudStore, openCheckoutAndAwaitActivation } from '../stores/cloud-store';
import { CloudAccountSetupModal } from './CloudAccountSetupModal';
import { CloudSignInModal } from './CloudSignInModal';
import { RecoveryKeyModal } from './E2eeEnrollment';
import { formatBytes, formatDateTime } from '../utils/format';

/**
 * Settings → Cloud Sync card. When signed out it offers Sign In and Create
 * Account, both of which open a dedicated modal (CloudSignInModal /
 * CloudAccountSetupModal) that walks the auth ladder — password sign-in →
 * one-time authenticator (TOTP) setup with QR code → 6-digit code → connected.
 * Once connected it shows the account, storage used, and a Sync Now button.
 * BidSheet itself never requires this — the cloud is an optional backup/sync
 * layer.
 */
export function CloudSyncCard() {
  const addToast = useToastStore((s) => s.addToast);
  const { auth, sync, refresh } = useCloudStore();

  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<any | null>(null);
  // Server-reported: are paid plans actually open? Defaults false (trials-only)
  // so an old/undeployed server never shows a Subscribe button that can't work.
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);

  useEffect(() => {
    initCloudStore();
  }, []);

  const ready = auth?.aal === 'aal2';

  // Re-fetched after every sync pass so the storage bar tracks uploads.
  useEffect(() => {
    if (ready) {
      window.api.cloudMe().then((me) => {
        setAccount(me.account);
        setBillingEnabled(!!me.billing_enabled);
      }).catch(() => {});
    } else {
      setAccount(null);
    }
  }, [ready, sync?.lastCheckAt]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (err: any) {
      addToast(err?.message || 'Cloud sync error.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Signing out drops this computer's encryption keys, so getting back in takes
  // the recovery key, not just the password. For a team member that's worse
  // than an inconvenience: their key material on the server is wrapped under
  // their own recovery key, so if they've lost it no owner can let them back in
  // — they have to be removed and re-invited. Far too much to hang on one
  // misclick of a button sitting next to Sync Now.
  const handleSignOut = async () => {
    let warnAboutKeys = false;
    try {
      const state = await window.api.cloudE2eeState();
      warnAboutKeys = state === 'unlocked' || state === 'locked' || state === 'pending_approval';
    } catch {
      // Can't tell (offline, or the state call failed) — warn anyway. A
      // needless caution costs a click; a silent sign-out can cost the data.
      warnAboutKeys = true;
    }
    const prompt = warnAboutKeys
      ? 'Sign out of cloud sync?\n\nThis computer will forget your encryption keys. To use cloud sync here again you will need your recovery key — your password alone will not unlock it.'
      : 'Sign out of cloud sync?';
    if (!confirm(prompt)) return;
    return act(() => window.api.cloudSignOut());
  };

  const usedFrac =
    account?.storage_cap_bytes > 0 ? (account.storage_bytes_used || 0) / account.storage_cap_bytes : 0;

  const cloudOnlyCount = sync?.cloudOnly?.length ?? 0;

  const subStatus: string | undefined = account?.subscription_status;
  const trialEnd = account?.trial_ends_at
    ? new Date(account.trial_ends_at.replace(' ', 'T') + 'Z')
    : null;
  const trialDaysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / 86400000) : null;
  const trialExpired = subStatus === 'trial' && trialDaysLeft !== null && trialDaysLeft <= 0;

  // Not act(): the activation poll can run minutes and must not lock the card.
  const handleSubscribe = async () => {
    setAwaitingPayment(true);
    try {
      const active = await openCheckoutAndAwaitActivation(() => unmounted.current);
      if (active) {
        addToast('Subscription active. Full 100 GB available.', 'success');
        window.api.cloudMe().then((me) => setAccount(me.account)).catch(() => {});
      }
    } catch (err: any) {
      addToast(err?.message || 'Could not open checkout.', 'error');
    } finally {
      setAwaitingPayment(false);
    }
  };
  const handlePortal = () => act(async () => { await window.api.cloudBillingPortal(); });

  const [restoringAll, setRestoringAll] = useState(false);
  // Per-job results, surfaced honestly — a partial restore is never a
  // silent success toast.
  const handleRestoreAll = async () => {
    setRestoringAll(true);
    try {
      const results = await window.api.cloudRestoreAll();
      const failed = results.filter((r) => !r.ok);
      const restored = results.length - failed.length;
      if (restored > 0) {
        addToast(`Restored ${restored} job${restored === 1 ? '' : 's'} from the cloud.`, 'success');
      }
      for (const f of failed) {
        addToast(`Could not restore "${f.name}": ${f.error}`, 'error');
      }
      if (results.length === 0) {
        addToast('Nothing to restore. Every cloud job is already on this computer.', 'info');
      }
      await refresh();
    } catch (err: any) {
      addToast(err?.message || 'Restore failed.', 'error');
    } finally {
      setRestoringAll(false);
    }
  };

  return (
    <div className="card mb-24">
      <h3 style={{ marginBottom: 8 }}>
        Cloud Sync
        <span
          className="badge badge-submitted"
          style={{ fontSize: 11, padding: '2px 8px', marginLeft: 8, verticalAlign: 'middle' }}
        >
          Beta
        </span>
      </h3>
      <p className="text-muted mb-16">
        Optional online backup and multi-computer sync for your jobs. BidSheet works fully
        offline without it. An authenticator app (Google Authenticator, Authy, 1Password)
        is required, so your bids and plans only leave this computer behind two-factor login.
        Whether or not you subscribe, your data always lives locally on this computer.
      </p>

      {!auth ? (
        <p className="text-muted">Checking cloud status…</p>
      ) : !auth.signedIn ? (
        <div style={{ maxWidth: 420 }}>
          <div className="flex gap-8">
            <button className="btn btn-primary" disabled={busy} onClick={() => setShowSignIn(true)}>
              Sign In
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setShowSetup(true)}>
              Create Account
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 12 }}>
            New to BidSheet Cloud? First 30 days free, then $20/month for your whole company.
            Got an invite code from a teammate? Hit <strong>Create Account</strong> — you'll
            join their subscription instead of starting your own.
          </p>
        </div>
      ) : !ready ? (
        <div style={{ maxWidth: 480 }}>
          <p style={{ marginBottom: 12 }}>
            Signed in as <strong>{auth.email}</strong>, but your authenticator isn't set up yet.
          </p>
          <div className="flex gap-8">
            <button className="btn btn-primary" disabled={busy} onClick={() => setShowSignIn(true)}>
              Finish Signing In
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ marginBottom: 4 }}>
            Connected as <strong>{auth.email}</strong>
            {account && (
              <span className="text-muted" style={{ marginLeft: 8, fontSize: 13 }}>
                ({formatBytes(account.storage_bytes_used || 0)}
                {account.storage_cap_bytes > 0 && ` of ${formatBytes(account.storage_cap_bytes)}`} cloud
                storage used)
              </span>
            )}
          </p>
          {account && account.storage_cap_bytes > 0 && (
            <div style={{ maxWidth: 360, marginBottom: 8 }}>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)' }}>
                <div
                  style={{
                    width: `${Math.min(100, usedFrac * 100)}%`,
                    height: 6,
                    borderRadius: 3,
                    background:
                      usedFrac >= 1 ? 'var(--danger)' : usedFrac >= 0.9 ? 'var(--warning)' : 'var(--accent)',
                  }}
                />
              </div>
              {usedFrac >= 0.9 && (
                <p className={usedFrac >= 1 ? 'text-danger' : 'text-warning'} style={{ fontSize: 12, marginTop: 4 }}>
                  {usedFrac >= 1
                    ? 'Cloud storage is full. Uploads are paused. Turn off sync for old jobs to free space; they stay on this computer.'
                    : 'Cloud storage is almost full. Turn off sync for old jobs to free space; they stay on this computer.'}
                </p>
              )}
            </div>
          )}
          {subStatus && subStatus !== 'comped' && (
            <div className="flex gap-8 items-center" style={{ marginBottom: 12 }}>
              {subStatus === 'active' ? (
                <>
                  <span className="text-muted" style={{ fontSize: 12 }}>Subscription active.</span>
                  <button className="btn btn-sm btn-secondary" disabled={busy} onClick={handlePortal}>
                    Manage Billing
                  </button>
                </>
              ) : subStatus === 'past_due' ? (
                <>
                  <span className="text-warning" style={{ fontSize: 12 }}>
                    Payment problem. Syncing is paused until your card is updated.
                  </span>
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={handlePortal}>
                    Update Card
                  </button>
                </>
              ) : (
                <>
                  <span className={trialExpired || subStatus === 'canceled' ? 'text-danger' : 'text-muted'}
                    style={{ fontSize: 12 }}>
                    {subStatus === 'canceled'
                      ? 'Subscription ended. Syncing is paused. Your cloud data is still there to download.'
                      : trialExpired
                        ? 'Free trial ended. Syncing is paused. Your cloud data is still there to download.'
                        : `Free trial: ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left.`}
                  </span>
                  {billingEnabled ? (
                    <button className="btn btn-sm btn-primary" disabled={awaitingPayment} onClick={handleSubscribe}>
                      {awaitingPayment ? 'Waiting for payment…' : 'Subscribe ($20/mo)'}
                    </button>
                  ) : (
                    <span className="text-muted" style={{ fontSize: 12, fontStyle: 'italic' }}>
                      Paid plans coming soon.
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {sync?.lastCheckAt && (
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Last checked {new Date(sync.lastCheckAt).toLocaleTimeString()}
              {', '}
              {sync.jobs.filter((j) => j.enabled).length} job(s) syncing
              {sync.cloudOnly.length > 0 && `, ${sync.cloudOnly.length} in cloud only`}
            </p>
          )}
          {cloudOnlyCount > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 6 }}>
                You have {cloudOnlyCount} job{cloudOnlyCount === 1 ? '' : 's'} in
                the cloud that {cloudOnlyCount === 1 ? "isn't" : "aren't"} on this
                computer{cloudOnlyCount === 1 ? '' : ' yet'}.
              </p>
              <button className="btn btn-sm btn-secondary" disabled={busy || restoringAll}
                onClick={handleRestoreAll}>
                {restoringAll
                  ? 'Restoring…'
                  : `Restore all ${cloudOnlyCount} cloud job${cloudOnlyCount === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
          <div className="flex gap-8">
            <button className="btn btn-primary" disabled={busy || sync?.syncing}
              onClick={() => act(() => window.api.cloudSyncNow())}>
              {sync?.syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
            Turn sync on per job from the Jobs &amp; Bids list. Your catalog and jobs sync when
            you open or return to the app, or whenever you hit Sync Now.
          </p>
          <BackupSection lastCheckAt={sync?.lastCheckAt ?? null} />
        </div>
      )}

      {showSetup && (
        <CloudAccountSetupModal
          onClose={() => {
            setShowSetup(false);
            refresh().catch(() => {});
          }}
        />
      )}

      {showSignIn && (
        <CloudSignInModal
          onClose={() => {
            setShowSignIn(false);
            refresh().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

/**
 * Encrypted sync & backup (zero-knowledge). Everything synced — jobs, takeoffs,
 * catalog, plans — and the whole-database backup is encrypted on this computer
 * with a per-account key, unlocked by a single recovery key (NOT the login
 * password). Encryption is part of the account, not a setting — enrollment
 * happens during account creation, and there is deliberately no way to turn it
 * off here. Driven by the E2EE state:
 *   - not_setup → finish enrollment (interrupted signup, or an account from
 *                 before enrollment became part of account creation)
 *   - locked    → unlock this computer with the recovery key (or restore a backup)
 *   - unlocked  → last-backed-up time, Back Up Now, regenerate key
 */
function BackupSection({ lastCheckAt }: { lastCheckAt: string | null }) {
  const addToast = useToastStore((s) => s.addToast);
  const [e2eeState, setE2eeState] = useState<
    'not_setup' | 'unlocked' | 'locked' | 'pending_approval' | 'unavailable' | null
  >(null);
  const [status, setStatus] = useState<{
    configured: boolean;
    lastBackupAt: string | null;
    remote: { size_bytes: number; created_at: string } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null); // shown once
  const [unlockKey, setUnlockKey] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [justJoined, setJustJoined] = useState(false);
  // This device's member-key code, read to the owner before they approve.
  const [myCode, setMyCode] = useState<string | null>(null);

  const load = async () => {
    const [st, bk] = await Promise.all([
      window.api.cloudE2eeState().catch(() => 'unavailable' as const),
      window.api.cloudBackupStatus().catch(() => null),
    ]);
    setE2eeState(st);
    setStatus(bk);
    if (st === 'pending_approval') {
      setMyCode(await window.api.cloudE2eeSafetyCode().catch(() => null));
    }
  };
  // Re-check after every sync pass — state and lastBackupAt move with it.
  useEffect(() => {
    load();
  }, [lastCheckAt]);

  if (!e2eeState) return null;

  const handleSetup = async () => {
    setBusy(true);
    try {
      const res = await window.api.cloudE2eeSetup();
      setRecoveryKey(res.recoveryKey); // opens the un-skippable save-it modal
    } catch (err: any) {
      addToast(err?.message || 'Could not turn on encrypted sync.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      const res = await window.api.cloudE2eeRegenerateRecovery();
      setRecoveryKey(res.recoveryKey);
    } catch (err: any) {
      addToast(err?.message || 'Could not regenerate the recovery key.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    try {
      await window.api.cloudE2eeUnlock(unlockKey.trim());
      setUnlockKey('');
      addToast('Encrypted sync unlocked on this computer.', 'success');
      await load();
      window.api.cloudSyncNow().catch(() => {});
    } catch (err: any) {
      addToast(err?.message || 'That recovery key did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Join an existing team with an invite code. Generates this device's key +
  // recovery key (shown once), then leaves the user pending an owner's approval.
  const handleJoin = async () => {
    setBusy(true);
    try {
      const res = await window.api.cloudOrgRedeemInvite(joinToken.trim());
      setJoinToken('');
      setJustJoined(true);
      setRecoveryKey(res.recoveryKey); // opens the un-skippable save-it modal
    } catch (err: any) {
      addToast(err?.message || 'That invite code did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleBackupNow = async () => {
    setBusy(true);
    try {
      await window.api.cloudBackupNow();
      addToast('Backup uploaded.', 'success');
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Backup failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await window.api.cloudBackupDisable();
      addToast('Whole-database backup turned off. The cloud copy was removed.', 'info');
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Could not turn off backup.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Fresh-machine full restore: unlock with the recovery key, then replace the
  // local DB and relaunch. On success the app relaunches, so only errors return.
  const handleRestore = async () => {
    setBusy(true);
    try {
      await window.api.cloudBackupRestore(unlockKey.trim());
    } catch (err: any) {
      addToast(err?.message || 'Restore failed. Nothing on this computer was changed.', 'error');
      setBusy(false);
    }
  };

  const afterSavedRecoveryKey = async () => {
    setRecoveryKey(null);
    if (justJoined) {
      setJustJoined(false);
      addToast("You've joined the team. Waiting for an owner to approve your access.", 'success');
      await load();
      return;
    }
    addToast('Encrypted sync is on.', 'success');
    await load();
    window.api.cloudSyncNow().catch(() => {});
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <h4 style={{ marginBottom: 4 }}>Encrypted Sync &amp; Backup</h4>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Everything you sync (jobs, takeoffs, catalog, plans) is encrypted on this computer before
        it's uploaded, and so is your whole-database backup. Even we can't read it.
      </p>

      {recoveryKey && (
        <RecoveryKeyModal recoveryKey={recoveryKey} onSaved={afterSavedRecoveryKey} />
      )}

      {e2eeState === 'unavailable' && (
        <p className="text-muted" style={{ fontSize: 12 }}>
          Couldn't reach the cloud to check encryption status. Try Sync Now.
        </p>
      )}

      {e2eeState === 'not_setup' && (
        <div style={{ maxWidth: 480 }}>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>One step left to finish your account: encryption.</strong> Nothing syncs
            until it's set up. You'll get a <strong>recovery key</strong> to save — it's the only
            way to unlock your data on a new computer, and it is <strong>not</strong> your login
            password.
          </p>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={handleSetup}>
            {busy ? 'Setting up…' : 'Finish Encryption Setup'}
          </button>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              <strong>Joining a teammate's account?</strong> Paste the invite code they sent you.
              You'll get your own recovery key, then they approve your access.
            </p>
            <div className="form-group">
              <label>Invite code</label>
              <input
                type="text"
                className="form-control"
                value={joinToken}
                placeholder="Paste invite code"
                onChange={(e) => setJoinToken(e.target.value)}
              />
            </div>
            <button
              className="btn btn-sm btn-secondary"
              disabled={busy || !joinToken.trim()}
              onClick={handleJoin}>
              {busy ? 'Joining…' : 'Join Team'}
            </button>
          </div>
        </div>
      )}

      {e2eeState === 'pending_approval' && (
        <div style={{ maxWidth: 480 }}>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            You've joined the team. An owner needs to <strong>approve your access</strong> before you
            can see the shared jobs and catalog. Only they can hand your device the encryption key.
          </p>
          {myCode && (
            <p style={{ fontSize: 13, marginBottom: 8 }}>
              When they approve you, they'll ask for your <strong>device code</strong>. Read them:{' '}
              <strong style={{ fontFamily: 'monospace' }}>{myCode}</strong>
            </p>
          )}
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            This unlocks automatically once they approve you. Keep the recovery key you just saved.
            It's how you'd unlock a different computer.
          </p>
          <button className="btn btn-sm btn-secondary" disabled={busy} onClick={load}>
            {busy ? 'Checking…' : 'Check for approval'}
          </button>
        </div>
      )}

      {e2eeState === 'locked' && (
        <div style={{ maxWidth: 480 }}>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            Encrypted sync is set up for your account but <strong>locked on this computer</strong>.
            Enter your <strong>recovery key</strong> (not your login password) to unlock it.
          </p>
          {status?.remote && (
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              An encrypted backup from {formatDateTime(status.remote.created_at)} is in your account.
              Unlocking here can restore everything onto this computer.
            </p>
          )}
          <div className="form-group">
            <label>Recovery key</label>
            <input
              type="text"
              className="form-control"
              value={unlockKey}
              autoFocus
              placeholder="BSK1-XXXX-XXXX-…"
              onChange={(e) => setUnlockKey(e.target.value)}
            />
          </div>
          <div className="flex gap-8">
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || !unlockKey.trim()}
              onClick={handleUnlock}>
              {busy ? 'Unlocking…' : 'Unlock This Computer'}
            </button>
            {status?.remote && (
              <button
                className="btn btn-sm btn-danger"
                disabled={busy || !unlockKey.trim()}
                onClick={handleRestore}>
                {busy ? 'Restoring…' : 'Restore Everything From Backup'}
              </button>
            )}
          </div>
          {status?.remote && (
            <p className="text-danger" style={{ fontSize: 12, marginTop: 8 }}>
              Restore replaces everything currently in BidSheet on this computer with your cloud
              backup. This cannot be undone.
            </p>
          )}
        </div>
      )}

      {e2eeState === 'unlocked' && (
        <div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {status?.lastBackupAt
              ? `Last backed up ${new Date(status.lastBackupAt.replace(' ', 'T')).toLocaleString()}.`
              : 'No backup uploaded yet.'}{' '}
            Backups upload automatically after each sync when something changed.
          </p>
          <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={handleBackupNow}>
              {busy ? 'Working…' : 'Back Up Now'}
            </button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={handleRegenerate}>
              Regenerate Recovery Key…
            </button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={handleDisable}>
              Turn Off Whole-Database Backup
            </button>
          </div>
          <TeamSection lastCheckAt={lastCheckAt} />
        </div>
      )}
    </div>
  );
}

/**
 * Team management, shown once encrypted sync is unlocked. Owners can invite
 * teammates (single-use codes shared out-of-band), approve those who've joined
 * (which seals the shared key to their device), and remove members. Non-owners
 * see a read-only roster. Membership is one shared account — pooled storage,
 * one subscription.
 */
function TeamSection({ lastCheckAt }: { lastCheckAt: string | null }) {
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<{
    members: {
      user_id: string;
      role: string;
      email: string | null;
      key_status: 'pending' | 'active' | null;
      pubkey: string | null;
      safety_code: string | null;
      /** Their key can be checked against their invite automatically. */
      binding_available: boolean;
    }[];
    me: { user_id: string; role: string };
  } | null>(null);
  const [invites, setInvites] = useState<{ id: string; expires_at: string }[]>([]);
  const [newInvite, setNewInvite] = useState<string | null>(null); // shown once
  const [busy, setBusy] = useState(false);

  const isOwner = data?.me.role === 'owner';

  const load = async () => {
    try {
      const d = await window.api.cloudOrgMembers();
      setData(d);
      if (d.me.role === 'owner') {
        setInvites(await window.api.cloudOrgListInvites().catch(() => []));
      }
    } catch {
      setData(null);
    }
  };
  useEffect(() => {
    load();
  }, [lastCheckAt]);

  const run = async (fn: () => Promise<any>, errMsg: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err: any) {
      addToast(err?.message || errMsg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = () =>
    run(async () => {
      const { token } = await window.api.cloudOrgCreateInvite();
      setNewInvite(token);
    }, 'Could not create an invite.');

  const handleApprove = (
    userId: string,
    memberLabel: string,
    safetyCode: string | null,
    bindingAvailable: boolean
  ) => {
    // Approving seals the account's encryption key to whatever public key the
    // server presented for this member, so that key has to be proven theirs.
    // Members who joined with a key binding are checked automatically before
    // anything is sealed (e2ee.ts recomputes the HMAC against the invite
    // token, which the server never had). Members who joined from an older
    // build have no binding, and there the owner still has to do it by hand.
    const prompt = bindingAvailable
      ? `Approve ${memberLabel}?\n\nTheir encryption key will be checked against the invite they used before anything is shared with them.`
      : safetyCode
        ? `Approve ${memberLabel}?\n\nThis teammate joined from an older version, so their key can't be checked automatically. Ask them to read you the device code shown on their Cloud Sync screen. It must be exactly:\n\n        ${safetyCode}\n\nIf it doesn't match, don't approve — someone may be intercepting the connection.`
        : `Approve ${memberLabel}? They have no encryption key registered yet.`;
    if (!confirm(prompt)) return;
    return run(async () => {
      const { verified } = await window.api.cloudOrgApproveMember(userId);
      addToast(
        verified
          ? 'Teammate approved — their encryption key matched their invite. They can now decrypt the shared data.'
          : 'Teammate approved. They can now decrypt the shared data.',
        'success'
      );
    }, 'Could not approve that member.');
  };

  const handleRemove = (userId: string, label: string) => {
    if (!confirm(`Remove ${label} from this account? They'll lose access to synced data.`)) return;
    return run(async () => {
      await window.api.cloudOrgRemoveMember(userId);
      addToast('Member removed.', 'info');
    }, 'Could not remove that member.');
  };

  const handleRevoke = (id: string) =>
    run(() => window.api.cloudOrgRevokeInvite(id), 'Could not revoke that invite.');

  if (!data) return null;
  const pending = data.members.filter((m) => m.key_status === 'pending');
  const active = data.members.filter((m) => m.key_status !== 'pending');
  const label = (m: { email: string | null; user_id: string }) =>
    m.email || `${m.user_id.slice(0, 8)}…`;

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <h4 style={{ marginBottom: 4 }}>Team</h4>
      <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Everyone on the team shares this account, with one subscription and pooled storage.
        {isOwner
          ? ' Invite teammates with a code, then approve them so their device gets the encryption key.'
          : ' Your account owner manages who has access.'}
      </p>

      {newInvite && <InviteCodeModal token={newInvite} onClose={() => setNewInvite(null)} />}

      {isOwner && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={handleInvite}>
            {busy ? 'Working…' : 'Invite a Teammate'}
          </button>
        </div>
      )}

      {isOwner && pending.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Waiting for approval</p>
          {pending.map((m) => (
            <div
              key={m.user_id}
              className="flex gap-8"
              style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>
                {label(m)}
                {m.safety_code && (
                  <span className="text-muted" style={{ fontFamily: 'monospace' }}>
                    {' '}
                    · {m.safety_code}
                  </span>
                )}
              </span>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => handleApprove(m.user_id, label(m), m.safety_code, m.binding_available)}>
                Approve
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: invites.length ? 12 : 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Members</p>
        {active.map((m) => (
          <div
            key={m.user_id}
            className="flex gap-8"
            style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 13 }}>
              {label(m)}
              {m.role === 'owner' && <span className="text-muted"> · owner</span>}
              {m.user_id === data.me.user_id && <span className="text-muted"> · you</span>}
              {m.key_status === null && <span className="text-muted"> · no key yet</span>}
            </span>
            {isOwner && m.user_id !== data.me.user_id && (
              <button
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() => handleRemove(m.user_id, label(m))}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && invites.length > 0 && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Pending invites</p>
          {invites.map((inv) => (
            <div
              key={inv.id}
              className="flex gap-8"
              style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="text-muted" style={{ fontSize: 12 }}>
                Expires {formatDateTime(inv.expires_at)}
              </span>
              <button
                className="btn btn-sm btn-secondary"
                disabled={busy}
                onClick={() => handleRevoke(inv.id)}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shows a freshly created invite code once, with copy. The raw code is only
 *  returned at creation (the server stores a hash), so it can't be shown again. */
function InviteCodeModal({ token, onClose }: { token: string; onClose: () => void }) {
  const addToast = useToastStore((s) => s.addToast);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      addToast('Invite code copied.', 'success');
    } catch {
      addToast('Could not copy. Select the code and copy it manually.', 'error');
    }
  };
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 8 }}>Invite code</h3>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
          Send this to your teammate however you like, by text or in person. It works{' '}
          <strong>once</strong> and expires in 48 hours. After they join, approve them here. You
          won't see this code again.
        </p>
        <div
          style={{
            fontFamily: 'var(--mono, monospace)',
            fontSize: 14,
            lineHeight: 1.6,
            padding: 12,
            background: 'var(--navy, #122240)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            wordBreak: 'break-all',
            userSelect: 'all',
            margin: '12px 0',
          }}>
          {token}
        </div>
        <div className="flex gap-8" style={{ marginBottom: 12 }}>
          <button className="btn btn-sm btn-secondary" onClick={copy}>
            Copy
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}


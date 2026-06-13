import React, { useState, useEffect, useRef } from 'react';
import { useToastStore } from '../stores/toast-store';
import { useCloudStore, initCloudStore, openCheckoutAndAwaitActivation } from '../stores/cloud-store';
import { CloudAccountSetupModal } from './CloudAccountSetupModal';
import { formatBytes, formatDateTime } from '../utils/format';

/**
 * Settings → Cloud Sync card. Walks the whole auth ladder: signed out →
 * password sign-in → one-time authenticator (TOTP) setup with QR code →
 * 6-digit code → connected. Once connected it shows the account, storage
 * used, and a Sync Now button. BidSheet itself never requires this — the
 * cloud is an optional backup/sync layer.
 */
export function CloudSyncCard() {
  const addToast = useToastStore((s) => s.addToast);
  const { auth, sync, refresh } = useCloudStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [enroll, setEnroll] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [account, setAccount] = useState<any | null>(null);
  // Server-reported: are paid plans actually open? Defaults false (trials-only)
  // so an old/undeployed server never shows a Subscribe button that can't work.
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
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

  const handleSignIn = () => act(() => window.api.cloudSignIn(email.trim(), password));
  const handleEnroll = () =>
    act(async () => {
      const e = await window.api.cloudEnrollTotp();
      setEnroll(e);
    });
  const handleVerify = () =>
    act(async () => {
      await window.api.cloudVerifyTotp(code, enroll?.factorId);
      setEnroll(null);
      setCode('');
      addToast('Cloud sync connected.', 'success');
      window.api.cloudSyncNow().catch(() => {});
    });
  const handleSignOut = () =>
    act(async () => {
      await window.api.cloudSignOut();
      setEnroll(null);
      setCode('');
    });

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
        addToast('Subscription active — full 100 GB unlocked.', 'success');
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
        addToast('Nothing to restore — every cloud job is already on this computer.', 'info');
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
        offline without it. An authenticator app (Google Authenticator, Authy, 1Password…)
        is required — your bids and plans only leave this computer behind two-factor login.
        Whether or not you subscribe, your data always lives locally on this computer.
      </p>

      {!auth ? (
        <p className="text-muted">Checking cloud status…</p>
      ) : !auth.signedIn ? (
        <div style={{ maxWidth: 420 }}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" className="form-control" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" className="form-control" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="12+ characters, mixed case, number, symbol" />
          </div>
          <div className="flex gap-8">
            <button className="btn btn-primary" disabled={busy || !email.trim() || !password}
              onClick={handleSignIn}>Sign In</button>
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
              New to BidSheet Cloud? First 30 days free, then $20/month for your whole company.
            </p>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setShowSetup(true)}>
              Create Account
            </button>
          </div>
        </div>
      ) : !ready ? (
        <div style={{ maxWidth: 480 }}>
          <p style={{ marginBottom: 12 }}>
            Signed in as <strong>{auth.email}</strong>.
          </p>
          {auth.needsEnroll && !enroll && (
            <div>
              <p className="text-muted mb-16">
                One-time setup: link an authenticator app to finish protecting your account.
              </p>
              <button className="btn btn-primary" disabled={busy} onClick={handleEnroll}>
                Set Up Authenticator
              </button>
            </div>
          )}
          {enroll && (
            <div className="mb-16">
              <p className="text-muted mb-16">
                Scan this QR code with your authenticator app, then enter the 6-digit code below.
              </p>
              <img src={enroll.qrCode} alt="Authenticator QR code"
                style={{ width: 180, height: 180, background: '#fff', padding: 8, borderRadius: 8 }} />
              <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                Can’t scan? Enter this key manually: <code>{enroll.secret}</code>
              </p>
            </div>
          )}
          {(enroll || auth.needsTotp) && (
            <div className="flex gap-8 items-center" style={{ marginTop: 8 }}>
              <input type="text" className="form-control" value={code} inputMode="numeric"
                onChange={(e) => setCode(e.target.value)} placeholder="6-digit code"
                style={{ width: 140 }} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && code.trim().length >= 6) handleVerify(); }} />
              <button className="btn btn-primary" disabled={busy || code.trim().length < 6}
                onClick={handleVerify}>Verify</button>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={handleSignOut}>
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
                — {formatBytes(account.storage_bytes_used || 0)}
                {account.storage_cap_bytes > 0 && ` of ${formatBytes(account.storage_cap_bytes)}`} cloud
                storage used
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
                    ? 'Cloud storage is full — uploads are paused. Turn off sync for old jobs to free space; they stay on this computer.'
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
                    Payment problem — syncing is paused until your card is updated.
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
                      ? 'Subscription ended — syncing is paused. Your cloud data is still there to download.'
                      : trialExpired
                        ? 'Free trial ended — syncing is paused. Your cloud data is still there to download.'
                        : `Free trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left.`}
                  </span>
                  {billingEnabled ? (
                    <button className="btn btn-sm btn-primary" disabled={awaitingPayment} onClick={handleSubscribe}>
                      {awaitingPayment ? 'Waiting for payment…' : 'Subscribe — $20/mo'}
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
              {' — '}
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
    </div>
  );
}

/**
 * Encrypted whole-database backup (Phase 3a). Three states:
 *   - not set up, no cloud backup → passphrase setup with loud
 *     "we cannot recover this" copy
 *   - cloud backup exists → "backup from <date> found" + passphrase restore
 *     (the dead-laptop flow), with setup still reachable
 *   - set up on this machine → last-backed-up time, Back Up Now, Turn Off
 */
function BackupSection({ lastCheckAt }: { lastCheckAt: string | null }) {
  const addToast = useToastStore((s) => s.addToast);
  const [status, setStatus] = useState<{
    configured: boolean;
    lastBackupAt: string | null;
    remote: { size_bytes: number; created_at: string } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [showRestore, setShowRestore] = useState(false);

  const load = () => window.api.cloudBackupStatus().then(setStatus).catch(() => {});
  // Re-check after every sync pass — backups ride sync, so lastBackupAt
  // moves when lastCheckAt does.
  useEffect(() => { load(); }, [lastCheckAt]);

  if (!status) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      await window.api.cloudBackupEnable(pass);
      setPass('');
      setPass2('');
      setShowSetup(false);
      addToast('Encrypted backup is on. First backup uploaded.', 'success');
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Could not set up encrypted backup.', 'error');
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
      addToast('Encrypted backup turned off. The cloud copy was removed.', 'info');
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Could not turn off backup.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // On success the app relaunches into the restored database — only errors
  // ever come back from this call.
  const handleRestore = async () => {
    setBusy(true);
    try {
      await window.api.cloudBackupRestore(restorePass);
    } catch (err: any) {
      addToast(err?.message || 'Restore failed. Nothing on this computer was changed.', 'error');
      setBusy(false);
    }
  };


  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <h4 style={{ marginBottom: 4 }}>Encrypted Backup</h4>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Backs up your entire BidSheet database to the cloud, encrypted on this computer with a
        passphrase only you know. We can store it, but we can never read it.
      </p>

      {status.configured ? (
        <div>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {status.lastBackupAt
              ? `Last backed up ${new Date(status.lastBackupAt.replace(' ', 'T')).toLocaleString()}.`
              : 'No backup uploaded yet.'}{' '}
            Backups upload automatically after each sync when something changed.
          </p>
          <div className="flex gap-8">
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={handleBackupNow}>
              {busy ? 'Working…' : 'Back Up Now'}
            </button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={handleDisable}>
              Turn Off &amp; Remove Cloud Copy
            </button>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 480 }}>
          {status.remote && !showSetup && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, marginBottom: 8 }}>
                <strong>Encrypted backup from {formatDateTime(status.remote.created_at)} found</strong> in
                your cloud account. Enter your backup passphrase to bring everything onto this
                computer.
              </p>
              {!showRestore ? (
                <button className="btn btn-sm btn-primary" onClick={() => setShowRestore(true)}>
                  Restore This Backup…
                </button>
              ) : (
                <div>
                  <p className="text-danger" style={{ fontSize: 12, marginBottom: 8 }}>
                    Restoring replaces everything currently in BidSheet on this computer with the
                    backup. This cannot be undone.
                  </p>
                  <div className="form-group">
                    <label>Backup passphrase</label>
                    <input type="password" className="form-control" value={restorePass}
                      onChange={(e) => setRestorePass(e.target.value)} autoFocus />
                  </div>
                  <div className="flex gap-8">
                    <button className="btn btn-sm btn-danger" disabled={busy || !restorePass}
                      onClick={handleRestore}>
                      {busy ? 'Restoring…' : 'Replace Local Data & Restore'}
                    </button>
                    <button className="btn btn-sm btn-secondary" disabled={busy}
                      onClick={() => { setShowRestore(false); setRestorePass(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!showSetup ? (
            <button className="btn btn-sm btn-secondary" onClick={() => setShowSetup(true)}>
              {status.remote ? 'Set Up Backups From This Computer Instead…' : 'Set Up Encrypted Backup…'}
            </button>
          ) : (
            <div>
              <p className="text-warning" style={{ fontSize: 12, marginBottom: 8 }}>
                Write this passphrase down and keep it somewhere safe. It never leaves this
                computer — if you lose it, <strong>nobody can recover your backup, including
                us</strong>.
                {status.remote && ' Setting up here replaces the existing cloud backup.'}
              </p>
              <div className="form-group">
                <label>Backup passphrase (10+ characters)</label>
                <input type="password" className="form-control" value={pass}
                  onChange={(e) => setPass(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label>Repeat passphrase</label>
                <input type="password" className="form-control" value={pass2}
                  onChange={(e) => setPass2(e.target.value)} />
              </div>
              {pass2 && pass !== pass2 && (
                <p className="text-danger" style={{ fontSize: 12, marginBottom: 8 }}>
                  Passphrases don't match.
                </p>
              )}
              <div className="flex gap-8">
                <button className="btn btn-sm btn-primary"
                  disabled={busy || pass.length < 10 || pass !== pass2}
                  onClick={handleEnable}>
                  {busy ? 'Encrypting & Uploading…' : 'Turn On Encrypted Backup'}
                </button>
                <button className="btn btn-sm btn-secondary" disabled={busy}
                  onClick={() => { setShowSetup(false); setPass(''); setPass2(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

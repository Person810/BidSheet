import React, { useState, useEffect, useRef } from 'react';
import { useToastStore } from '../stores/toast-store';
import { useCloudStore, initCloudStore, openCheckoutAndAwaitActivation } from '../stores/cloud-store';
import { CloudAccountSetupModal } from './CloudAccountSetupModal';

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
      window.api.cloudMe().then((me) => setAccount(me.account)).catch(() => {});
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

  const fmtBytes = (n: number) => {
    if (n >= 1 << 30) return `${parseFloat((n / (1 << 30)).toFixed(2))} GB`;
    if (n >= 1 << 20) return `${parseFloat((n / (1 << 20)).toFixed(1))} MB`;
    return `${Math.ceil(n / 1024)} KB`;
  };

  const usedFrac =
    account?.storage_cap_bytes > 0 ? (account.storage_bytes_used || 0) / account.storage_cap_bytes : 0;

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

  return (
    <div className="card mb-24">
      <h3 style={{ marginBottom: 8 }}>Cloud Sync</h3>
      <p className="text-muted mb-16">
        Optional online backup and multi-computer sync for your jobs. BidSheet works fully
        offline without it. An authenticator app (Google Authenticator, Authy, 1Password…)
        is required — your bids and plans only leave this computer behind two-factor login.
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
                — {fmtBytes(account.storage_bytes_used || 0)}
                {account.storage_cap_bytes > 0 && ` of ${fmtBytes(account.storage_cap_bytes)}`} cloud
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
                  <button className="btn btn-sm btn-primary" disabled={awaitingPayment} onClick={handleSubscribe}>
                    {awaitingPayment ? 'Waiting for payment…' : 'Subscribe — $20/mo'}
                  </button>
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
            Turn sync on per job from the Jobs &amp; Bids list. Jobs sync automatically every
            few minutes while the app is open.
          </p>
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

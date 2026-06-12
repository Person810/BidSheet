import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toast-store';
import { useCloudStore, initCloudStore } from '../stores/cloud-store';

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

  useEffect(() => {
    initCloudStore();
  }, []);

  const ready = auth?.aal === 'aal2';

  useEffect(() => {
    if (ready) {
      window.api.cloudMe().then((me) => setAccount(me.account)).catch(() => {});
    } else {
      setAccount(null);
    }
  }, [ready]);

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
  const handleSignUp = () =>
    act(async () => {
      await window.api.cloudSignUp(email.trim(), password);
      addToast('Account created. Now set up your authenticator app.', 'success');
    });
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
    if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
    if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
    return `${Math.ceil(n / 1024)} KB`;
  };

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
            <button className="btn btn-secondary" disabled={busy || !email.trim() || !password}
              onClick={handleSignUp}>Create Account</button>
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
                — {fmtBytes(account.storage_bytes_used || 0)} stored in the cloud
              </span>
            )}
          </p>
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
    </div>
  );
}

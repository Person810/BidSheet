import React, { useEffect, useState } from 'react';
import { useToastStore } from '../stores/toast-store';
import { useCloudStore } from '../stores/cloud-store';

/**
 * "Sign In" modal — pops over the app instead of the old inline form in the
 * Cloud Sync card. Walks the same auth ladder: password sign-in → one-time
 * authenticator (TOTP) enrollment with QR code → 6-digit verify → connected.
 *
 * The current step is derived from the shared auth status, not local state, so
 * the modal resumes at the right place when reopened on a half-signed-in
 * session (e.g. signed in but the authenticator was never finished). It closes
 * itself the moment the account reaches full (aal2) access.
 */
export function CloudSignInModal({ onClose }: { onClose: () => void }) {
  const addToast = useToastStore((s) => s.addToast);
  const { auth, refresh } = useCloudStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [enroll, setEnroll] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);

  const signedIn = !!auth?.signedIn;
  const ready = auth?.aal === 'aal2';
  const step: 'credentials' | 'totp' = signedIn ? 'totp' : 'credentials';

  // Full access means there's nothing left to do here — close so the modal
  // never lingers on a stale "verify" screen after a successful verify.
  useEffect(() => {
    if (ready) onClose();
  }, [ready, onClose]);

  const act = async (fn: () => Promise<void>) => {
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

  const canSubmitCredentials = !busy && !!email.trim() && !!password;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3>Sign In to Cloud Sync</h3>

        {step === 'credentials' && (
          <div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-control" value={email} autoComplete="username"
                autoFocus onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
                onKeyDown={(e) => { if (e.key === 'Enter' && canSubmitCredentials) handleSignIn(); }} />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" className="form-control" value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)} placeholder="Your password"
                onKeyDown={(e) => { if (e.key === 'Enter' && canSubmitCredentials) handleSignIn(); }} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!canSubmitCredentials} onClick={handleSignIn}>
                {busy ? 'Signing in…' : 'Sign In'}
              </button>
            </div>
          </div>
        )}

        {step === 'totp' && (
          <div>
            <p style={{ marginBottom: 12 }}>
              Signed in as <strong>{auth?.email}</strong>.
            </p>
            {auth?.needsEnroll && !enroll && (
              <div className="mb-16">
                <p className="text-muted mb-16">
                  One-time setup: link an authenticator app (Google Authenticator, Authy,
                  1Password…) to finish protecting your account.
                </p>
                <button className="btn btn-primary" disabled={busy} onClick={handleEnroll}>
                  {busy ? 'Working…' : 'Set Up Authenticator'}
                </button>
              </div>
            )}
            {enroll && (
              <div className="mb-16" style={{ textAlign: 'center' }}>
                <p className="text-muted mb-16">
                  Scan this QR code with your authenticator app, then enter the 6-digit code below.
                </p>
                <img src={enroll.qrCode} alt="Authenticator QR code"
                  style={{ width: 180, height: 180, background: '#fff', padding: 8, borderRadius: 8 }} />
                <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Can't scan? Enter this key manually: <code>{enroll.secret}</code>
                </p>
              </div>
            )}
            {(enroll || auth?.needsTotp) && (
              <div className="flex gap-8 items-center" style={{ justifyContent: 'center' }}>
                <input type="text" className="form-control" value={code} inputMode="numeric"
                  onChange={(e) => setCode(e.target.value)} placeholder="6-digit code"
                  style={{ width: 140 }} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && code.trim().length >= 6) handleVerify(); }} />
                <button className="btn btn-primary" disabled={busy || code.trim().length < 6}
                  onClick={handleVerify}>
                  {busy ? 'Verifying…' : 'Verify'}
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
                Finish Later
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { useToastStore } from '../stores/toast-store';
import { useCloudStore, openCheckoutAndAwaitActivation } from '../stores/cloud-store';
import { E2eeEnrollStep } from './E2eeEnrollment';

/**
 * "Create Account" wizard — pops over the app instead of inline forms:
 * pricing pitch → email/password → email confirmation (only when Supabase
 * requires it — signup then returns a user but no session) → authenticator
 * (TOTP) setup → encryption key (recovery key shown once) → trial started,
 * with the road to payment at the end. Encryption enrollment is part of
 * account creation, not a setting — nothing syncs until the account has its
 * key. The payment itself happens on Paddle's hosted page in the system
 * browser; this dialog just opens it and waits for the Worker's webhook to
 * flip the account to active.
 */
export function CloudAccountSetupModal({ onClose }: { onClose: () => void }) {
  const addToast = useToastStore((s) => s.addToast);
  const refresh = useCloudStore((s) => s.refresh);

  const [step, setStep] = useState<
    'pitch' | 'credentials' | 'confirm-email' | 'totp' | 'encryption' | 'done'
  >('pitch');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [enroll, setEnroll] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  // Server-reported; defaults false so the wizard never offers a Subscribe
  // button that can't work (trials-only until paid plans are opened server-side).
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

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

  const startTotpEnroll = async () => {
    const e = await window.api.cloudEnrollTotp();
    setEnroll(e);
    setStep('totp');
  };

  const handleCreate = () =>
    act(async () => {
      const status = await window.api.cloudSignUp(email.trim(), password);
      if (!status?.signedIn) {
        // GoTrue created the user but withheld the session: the project
        // requires email confirmation (it also answers like this for an
        // already-registered email, to prevent account enumeration).
        setStep('confirm-email');
        return;
      }
      await startTotpEnroll();
    });

  // After the user clicks the emailed link, a normal password sign-in yields
  // the session that signup withheld; then the ladder continues as usual.
  const handleConfirmedContinue = () =>
    act(async () => {
      await window.api.cloudSignIn(email.trim(), password);
      await startTotpEnroll();
    });

  // GoTrue re-sends the confirmation email on a repeat signup for an
  // unconfirmed user (rate-limited; errors surface as toasts).
  const handleResend = () =>
    act(async () => {
      await window.api.cloudSignUp(email.trim(), password);
      addToast('Confirmation email sent again.', 'info');
    });

  const handleVerify = () =>
    act(async () => {
      await window.api.cloudVerifyTotp(code, enroll?.factorId);
      window.api.cloudMe().then((me) => {
        setTrialEndsAt(me.account?.trial_ends_at ?? null);
        setBillingEnabled(!!me.billing_enabled);
      }).catch(() => {});
      // No sync yet — nothing can upload until the encryption key exists.
      setStep('encryption');
    });

  // Deliberately not act(): the poll can run minutes and "Maybe Later" must
  // stay clickable the whole time.
  const handleSubscribe = async () => {
    setAwaitingPayment(true);
    try {
      const active = await openCheckoutAndAwaitActivation(() => cancelled.current);
      if (active) {
        addToast('Subscription active. Full 100 GB available.', 'success');
        await refresh();
        onClose();
      }
    } catch (err: any) {
      addToast(err?.message || 'Could not open checkout.', 'error');
    } finally {
      setAwaitingPayment(false);
    }
  };

  const fmtDate = (s: string | null) =>
    s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString() : '30 days from now';

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3>Set Up Cloud Sync</h3>

        {step === 'pitch' && (
          <div>
            <p style={{ marginBottom: 12 }}>
              Back up your jobs online and work from any computer, and soon see plans and
              take jobsite photos from your phone.
            </p>
            <ul style={{ margin: '0 0 12px 18px', lineHeight: 1.7 }}>
              <li><strong>Free for 30 days</strong>, no card needed, 10 GB of storage</li>
              <li><strong>$20/month</strong> after that, one price for your whole company</li>
              <li>Unlimited computers and users, 100 GB of storage</li>
              <li><strong>End-to-end encrypted</strong> — your bids are locked with a key only you hold</li>
              <li>Cancel anytime. Your data stays downloadable.</li>
            </ul>
            <p className="text-muted" style={{ fontSize: 12 }}>
              You'll need an authenticator app (Google Authenticator, Authy, 1Password). Your
              bids and plans are encrypted on this computer and only leave it behind two-factor
              login. BidSheet itself stays free and works fully offline without any of this.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setStep('credentials')}>
                Start Free Trial
              </button>
            </div>
          </div>
        )}

        {step === 'credentials' && (
          <div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-control" value={email} autoComplete="username"
                autoFocus onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" className="form-control" value={password} autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="12+ characters, mixed case, number, symbol" />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input type="password" className="form-control" value={password2} autoComplete="new-password"
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="Type it again" />
              {password2.length > 0 && password2 !== password && (
                <p className="text-danger" style={{ fontSize: 12, marginTop: 4 }}>
                  Passwords don't match.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="btn btn-primary"
                disabled={busy || !email.trim() || !password || password2 !== password}
                onClick={handleCreate}>
                {busy ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </div>
        )}

        {step === 'confirm-email' && (
          <div>
            <p style={{ marginBottom: 8 }}>
              <strong>Check your email.</strong> We sent a confirmation link to{' '}
              <strong>{email.trim()}</strong>. Click it, then come back here and continue.
            </p>
            <p className="text-muted mb-16" style={{ fontSize: 12 }}>
              Nothing arriving? Check your spam folder, or resend it. If you already have a
              BidSheet account with this email, no email is sent — close this and use{' '}
              <strong>Sign In</strong> instead.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="btn btn-secondary" disabled={busy} onClick={handleResend}>
                Resend Email
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={handleConfirmedContinue}>
                {busy ? 'Checking…' : "I've Confirmed — Continue"}
              </button>
            </div>
          </div>
        )}

        {step === 'totp' && (
          <div>
            <p className="text-muted mb-16">
              Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
            </p>
            {enroll && (
              <div className="mb-16" style={{ textAlign: 'center' }}>
                <img src={enroll.qrCode} alt="Authenticator QR code"
                  style={{ width: 180, height: 180, background: '#fff', padding: 8, borderRadius: 8 }} />
                <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Can't scan? Enter this key manually: <code>{enroll.secret}</code>
                </p>
              </div>
            )}
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
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
                Finish Later
              </button>
            </div>
          </div>
        )}

        {step === 'encryption' && (
          <E2eeEnrollStep
            onEnrolled={() => setStep('done')}
            onAlreadySetup={() => setStep('done')}
            onSkip={onClose}
          />
        )}

        {step === 'done' && (
          <div>
            <p style={{ marginBottom: 8 }}>
              <strong>Your free trial is active.</strong> It runs until {fmtDate(trialEndsAt)}.
            </p>
            <p className="text-muted mb-16">
              {billingEnabled
                ? 'Turn sync on per job from the Jobs & Bids list. Subscribe now (or any time before the trial ends) to keep syncing and get the full 100 GB.'
                : 'Turn sync on per job from the Jobs & Bids list. You have the full 100 GB during your trial. Paid plans are coming soon.'}
            </p>
            {billingEnabled && awaitingPayment && (
              <p className="text-muted mb-16" style={{ fontSize: 12 }}>
                Waiting for payment to complete in your browser. This updates automatically.
              </p>
            )}
            <div className="modal-actions">
              {billingEnabled ? (
                <>
                  <button className="btn btn-secondary" onClick={onClose}>
                    Maybe Later
                  </button>
                  <button className="btn btn-primary" disabled={awaitingPayment} onClick={handleSubscribe}>
                    {awaitingPayment ? 'Waiting for payment…' : 'Subscribe ($20/month)'}
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={onClose}>
                  Get Started
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

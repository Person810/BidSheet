import React, { useState } from 'react';
import { useToastStore } from '../stores/toast-store';

/**
 * Shared E2EE enrollment UI. Encryption is not optional — every account gets
 * its key as part of enrollment. These pieces are shared by the create-account
 * wizard, the sign-in modal (for accounts that predate mandatory enrollment),
 * and the Settings card so the flow is identical everywhere.
 */

/**
 * Shows a freshly generated recovery key exactly once and forces the user to
 * confirm they saved it before continuing. The key is never shown again — the
 * server never has it, so there is no second chance.
 */
export function RecoveryKeyPanel({
  recoveryKey,
  onSaved,
}: {
  recoveryKey: string;
  onSaved: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [confirmed, setConfirmed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      addToast('Recovery key copied.', 'success');
    } catch {
      addToast('Could not copy. Select the key and copy it manually.', 'error');
    }
  };

  return (
    <div>
      <p className="text-danger" style={{ fontSize: 13, marginBottom: 8 }}>
        This is the <strong>only</strong> way to unlock your encrypted data on another computer.
        We can never recover it for you, and it is <strong>not</strong> your login password. Save
        it in a password manager or print it now. You won't see it again.
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
        {recoveryKey}
      </div>
      <div className="flex gap-8" style={{ marginBottom: 12 }}>
        <button className="btn btn-sm btn-secondary" onClick={copy}>
          Copy
        </button>
        <button className="btn btn-sm btn-secondary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I've saved my recovery key somewhere safe.
      </label>
      <div className="modal-actions">
        <button className="btn btn-primary" disabled={!confirmed} onClick={onSaved}>
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * Opt-in shorter (80-bit) recovery key, easier to write down. Still safe
 * offline because the short key is stretched with scrypt before it wraps
 * anything (see sync-crypto.ts). The full 256-bit key stays the default.
 */
export function ShortCodeCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginBottom: 10 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span>
        Use a <strong>shorter recovery key</strong> (16 characters instead of ~52). Easier to
        write down, and still safe to store offline. Recommended only if you'll be typing it
        by hand rather than saving it in a password manager.
      </span>
    </label>
  );
}

/** RecoveryKeyPanel as a blocking overlay, for flows that live on a page. */
export function RecoveryKeyModal({
  recoveryKey,
  onSaved,
}: {
  recoveryKey: string;
  onSaved: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 8 }}>Save your recovery key</h3>
        <RecoveryKeyPanel recoveryKey={recoveryKey} onSaved={onSaved} />
      </div>
    </div>
  );
}

/**
 * The enrollment step itself: explain the recovery key, generate it, show it
 * once (RecoveryKeyPanel), and kick off the first sync when it's confirmed
 * saved. Rendered inside a modal, so the key can't be clicked away from once
 * it's on screen — the only way forward is confirming it's saved.
 */
export function E2eeEnrollStep({
  intro,
  onEnrolled,
  onAlreadySetup,
  onSkip,
}: {
  /** Replaces the default explanation copy above the checkbox. */
  intro?: React.ReactNode;
  /** Called after the key was generated AND the user confirmed saving it. */
  onEnrolled: () => void;
  /** The account already has key material (set up on another device). */
  onAlreadySetup: () => void;
  /** Offered as "Finish Later" before a key exists; omit to require finishing. */
  onSkip?: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [shortCode, setShortCode] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  const handleCreate = async () => {
    setBusy(true);
    try {
      const res = await window.api.cloudE2eeSetup(shortCode);
      setRecoveryKey(res.recoveryKey);
    } catch (err: any) {
      // Matches both E2eeAlreadySetupError messages ("is already set up" and
      // the cross-device race "was just set up on another device").
      if (/(already|just) set up/i.test(err?.message || '')) {
        addToast(
          'Encryption is already set up for this account. Unlock it with your recovery key in Settings → Cloud Sync.',
          'info'
        );
        onAlreadySetup();
      } else {
        addToast(err?.message || 'Could not set up encryption.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  if (recoveryKey) {
    return (
      <div>
        <h4 style={{ marginBottom: 8 }}>Save your recovery key</h4>
        <RecoveryKeyPanel
          recoveryKey={recoveryKey}
          onSaved={() => {
            window.api.cloudSyncNow().catch(() => {});
            onEnrolled();
          }}
        />
      </div>
    );
  }

  return (
    <div>
      {intro ?? (
        <>
          <p style={{ marginBottom: 8 }}>
            <strong>Last step: encryption.</strong> Everything you sync — jobs, takeoffs,
            catalog, plans — is encrypted on this computer before it's uploaded. Not even we
            can read it.
          </p>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            You'll get a <strong>recovery key</strong> to save. It's the only way to unlock
            your data on another computer, and it is <strong>not</strong> your login password.
          </p>
        </>
      )}
      <ShortCodeCheckbox checked={shortCode} onChange={setShortCode} />
      <div className="modal-actions">
        {onSkip && (
          <button className="btn btn-secondary" disabled={busy} onClick={onSkip}>
            Finish Later
          </button>
        )}
        <button className="btn btn-primary" disabled={busy} onClick={handleCreate}>
          {busy ? 'Setting up…' : 'Create My Recovery Key'}
        </button>
      </div>
    </div>
  );
}

/**
 * End-to-end encryption key management (zero-knowledge sync).
 *
 * Two key schemes coexist:
 *
 * Format 1 (legacy, single user):
 *   recovery key (256-bit) --directly wraps--> DEK
 *
 * Format 2 (multi-member orgs):
 *   recovery key (256-bit, per member) --wraps--> member X25519 PRIVATE key
 *   member private key + sealed blob ------------> DEK (sealed to the member's
 *                                                  public key by an owner)
 *   DEK (256-bit) --encrypts--> all synced data (unchanged across both schemes)
 *
 * One per-account Data Encryption Key (DEK) encrypts every synced payload. Under
 * format 2 the DEK is *sealed* to each member's public key (one wrap per
 * member), so several people can decrypt the same account while the server still
 * holds only ciphertext. Each member's private key is wrapped under their own
 * recovery key. The server never sees a recovery key, a private key, or the raw
 * DEK — it cannot read anything (zero-knowledge).
 *
 * Joining is two-step by construction: a newcomer registers their public key
 * (status 'pending'; they can authenticate but decrypt nothing), then an
 * already-unlocked owner seals the DEK to that key (status 'active'). Only an
 * unlocked member holds the DEK to seal — the server cannot do it.
 *
 * After unlock the DEK (and the member private key) are cached locally with the
 * OS keychain (safeStorage) so day-to-day sync never re-prompts. The legacy
 * e2ee_keys.wrapped_dek (recovery key -> DEK) is preserved under format 2 too,
 * as an account-level recovery path for the owner and for un-upgraded clients.
 */

import Database from 'better-sqlite3';
import { logger } from '../logger';
import { CloudAuth, encryptToken, decryptToken } from './supabase-auth';
import { CloudApiClient, CloudApiError } from './api-client';
import {
  syncAad,
  generateRecoveryKey,
  dekFingerprint,
  generateMemberKeypair,
  sealDek,
  openDek,
  sealAad,
  privKeyWrapAad,
  wrapWithRecoveryCode,
  unwrapWithRecoveryCode,
  isKdfWrapped,
  type RecoveryKdf,
} from './sync-crypto';
import crypto from 'crypto';

/**
 * - `not_setup`: no key material anywhere — first-enable flow.
 * - `unlocked`: the DEK is cached on this device; sync proceeds.
 * - `locked`: the account has key material but this device hasn't unlocked it.
 * - `pending_approval`: this member joined but no owner has sealed the DEK to
 *   them yet — they can't decrypt until approved.
 * - `unavailable`: not signed in (aal<2) or the cloud is unreachable.
 */
export type E2eeState = 'not_setup' | 'unlocked' | 'locked' | 'pending_approval' | 'unavailable';

export interface E2eeSetupResult {
  /** Shown to the user exactly once; never stored. */
  recoveryKey: string;
}

const DEK_LENGTH = 32;
const WRAP_SCOPE = 'account';
const WRAP_TYPE = 'dek-wrap';

/** Wrong/garbled recovery key, or a fresh device that can't unlock. */
export class E2eeUnlockError extends Error {}
/** Tried to set up E2EE when the account already has key material. */
export class E2eeAlreadySetupError extends Error {}
/** The DEK is needed but not unlocked on this device. */
export class E2eeLockedError extends Error {}

export class E2eeManager {
  constructor(
    private db: Database.Database,
    private auth: CloudAuth,
    private api: CloudApiClient
  ) {}

  // ---- local cache (no network) ----

  hasLocalDek(): boolean {
    return !!this.row()?.dek_enc;
  }

  /** The unlocked DEK for the sync/backup paths. Throws if locked. */
  getDek(): Buffer {
    const row = this.row();
    if (!row?.dek_enc) {
      throw new E2eeUnlockError(
        'Encrypted sync is locked on this computer. Enter your recovery key in Settings → Cloud Sync.'
      );
    }
    const hex = decryptToken(row.dek_enc);
    if (!hex) {
      throw new E2eeUnlockError(
        'Could not unlock the encryption key from the OS keychain. Enter your recovery key in Settings → Cloud Sync.'
      );
    }
    return Buffer.from(hex, 'hex');
  }

  /** This member's cached X25519 private key, or null if not present. */
  private localPrivateKey(): Buffer | null {
    const enc = this.row()?.member_priv_enc;
    if (!enc) return null;
    const hex = decryptToken(enc);
    return hex ? Buffer.from(hex, 'hex') : null;
  }

  /** Forget the cached DEK + member key on this device (sign-out / account switch). */
  lockLocal(): void {
    this.db
      .prepare(
        `UPDATE cloud_auth SET dek_enc = NULL, dek_fingerprint = NULL,
           member_priv_enc = NULL, member_pub = NULL, e2ee_format = NULL WHERE id = 1`
      )
      .run();
  }

  // ---- state ----

  async state(): Promise<E2eeState> {
    if (this.auth.status().aal !== 'aal2') return 'unavailable';
    if (this.hasLocalDek()) return 'unlocked';
    let material;
    try {
      material = await this.api.getKeyMaterial();
    } catch {
      return 'unavailable'; // network error — can't determine; don't claim not_setup
    }
    if (!material) return 'not_setup';
    if (!(material.format >= 2)) return 'locked'; // legacy: needs recovery key here

    // Format 2: not approved yet?
    if (material.my_status === 'pending' || !material.my_wrapped_dek) return 'pending_approval';

    // Approved. If this device already holds the member private key (it joined
    // or unlocked here before), open the sealed DEK with it — no recovery key
    // needed. This is how a freshly-approved member's app auto-unlocks.
    const priv = this.localPrivateKey();
    if (priv) {
      try {
        const accountId = await this.accountId();
        const dek = openDek(Buffer.from(material.my_wrapped_dek, 'base64'), priv, sealAad(accountId, this.userId()));
        if (dekFingerprint(dek) === material.dek_fingerprint) {
          this.cacheDek(dek, material.dek_fingerprint);
          return 'unlocked';
        }
      } catch (err: any) {
        logger.warn('cloud-e2ee', 'Local private key could not open the sealed DEK', err?.message);
      }
    }
    return 'locked'; // approved, but this device needs the recovery key to unlock
  }

  // ---- first enable (writes format 2) ----

  async setup(shorter = false): Promise<E2eeSetupResult> {
    const accountId = await this.accountId();
    const userId = this.userId();
    // Race guard: never generate a second DEK over an existing one (would
    // orphan everything already encrypted under the first).
    if (await this.api.getKeyMaterial()) {
      throw new E2eeAlreadySetupError(
        'Encrypted sync is already set up for this account. Unlock it with your recovery key instead.'
      );
    }
    const dek = crypto.randomBytes(DEK_LENGTH);
    const recoveryKey = generateRecoveryKey({ short: shorter });
    const kdf: RecoveryKdf = shorter ? 'scrypt' : 'direct';
    const fingerprint = dekFingerprint(dek);
    const { pubRaw, privRaw } = generateMemberKeypair();

    // Account-level recovery wrap (legacy field) + this owner's member material.
    const wrappedDek = await wrapWithRecoveryCode(dek, recoveryKey, this.wrapAad(accountId), kdf);
    const wrappedPriv = await wrapWithRecoveryCode(privRaw, recoveryKey, privKeyWrapAad(userId), kdf);
    const sealedDek = sealDek(dek, pubRaw, sealAad(accountId, userId));

    try {
      await this.api.putKeyMaterial({
        format: 2,
        wrapped_dek: wrappedDek.toString('base64'),
        dek_fingerprint: fingerprint,
        pubkey: pubRaw.toString('base64'),
        wrapped_priv: wrappedPriv.toString('base64'),
        sealed_dek: sealedDek.toString('base64'),
      });
    } catch (err) {
      if (err instanceof CloudApiError && err.code === 'e2ee_key_conflict') {
        throw new E2eeAlreadySetupError(
          'Encrypted sync was just set up on another device. Unlock it with your recovery key instead.'
        );
      }
      throw err;
    }
    this.cacheDek(dek, fingerprint);
    this.cacheMemberKey(privRaw, pubRaw, 2);
    logger.info('cloud-e2ee', 'Encrypted sync enabled (format 2); DEK sealed to a new member key');
    return { recoveryKey };
  }

  // ---- fresh-device unlock ----

  async unlock(recoveryKey: string): Promise<void> {
    const accountId = await this.accountId();
    const userId = this.userId();
    const material = await this.api.getKeyMaterial();
    if (!material) {
      throw new E2eeUnlockError('Encrypted sync is not set up for this account yet.');
    }

    if (!(material.format >= 2)) {
      // Legacy format 1: recovery key directly unwraps the DEK, then upgrade.
      const dek = await this.unwrapLegacyDek(material.wrapped_dek, recoveryKey, accountId, material.dek_fingerprint);
      this.cacheDek(dek, material.dek_fingerprint);
      logger.info('cloud-e2ee', 'Encrypted sync unlocked (format 1)');
      await this.upgradeToFormat2(dek, recoveryKey, accountId, userId, material.wrapped_dek);
      return;
    }

    // Format 2: recover the private key, then open the DEK sealed to it.
    if (!material.my_wrapped_priv) {
      throw new E2eeUnlockError(
        "You haven't joined this account's encrypted sync yet, or your key was removed."
      );
    }
    let priv: Buffer;
    try {
      priv = await unwrapWithRecoveryCode(
        Buffer.from(material.my_wrapped_priv, 'base64'),
        recoveryKey,
        privKeyWrapAad(userId)
      );
      if (priv.length !== DEK_LENGTH) {
        throw new E2eeUnlockError('Unwrapped private key has the wrong length.');
      }
    } catch {
      throw new E2eeUnlockError('That recovery key did not match. Check it and try again.');
    }
    if (!material.my_wrapped_dek) {
      // Joined but not yet approved — store the private key so we auto-unlock
      // the moment an owner approves, without re-entering the recovery key.
      this.cacheMemberKey(priv, this.derivePub(priv), 2);
      throw new E2eeUnlockError(
        'Waiting for an owner to approve your access. You can close this — your app will unlock automatically once approved.'
      );
    }
    let dek: Buffer;
    try {
      dek = openDek(Buffer.from(material.my_wrapped_dek, 'base64'), priv, sealAad(accountId, userId));
    } catch {
      throw new E2eeUnlockError('Could not unlock encrypted sync with that recovery key.');
    }
    if (dekFingerprint(dek) !== material.dek_fingerprint) {
      throw new E2eeUnlockError(
        'The recovery key unlocked a key that does not match this account. Contact support.'
      );
    }
    this.cacheDek(dek, material.dek_fingerprint);
    this.cacheMemberKey(priv, this.derivePub(priv), 2);
    logger.info('cloud-e2ee', 'Encrypted sync unlocked on this computer (format 2)');
  }

  // ---- join an existing account via an invite ----

  /**
   * Redeem an invite: generate this member's keypair + recovery key, wrap the
   * private key, and register with the account (status pending). Caches the
   * private key locally so the app auto-unlocks once an owner approves. Returns
   * the recovery key to show once.
   */
  async joinWithInvite(token: string, shorter = false): Promise<E2eeSetupResult> {
    const userId = this.userId();
    const recoveryKey = generateRecoveryKey({ short: shorter });
    const kdf: RecoveryKdf = shorter ? 'scrypt' : 'direct';
    const { pubRaw, privRaw } = generateMemberKeypair();
    const wrappedPriv = await wrapWithRecoveryCode(privRaw, recoveryKey, privKeyWrapAad(userId), kdf);

    const result = await this.api.redeemInvite({
      token,
      pubkey: pubRaw.toString('base64'),
      wrapped_priv: wrappedPriv.toString('base64'),
    });
    // Redeem succeeded — we've left our old (solo) account for the org. Forget
    // the old account's cached DEK + member key BEFORE caching the new one, or a
    // stale DEK would make state() report 'unlocked' (line: hasLocalDek short-
    // circuits the pending check) and the sync engine could encrypt org data
    // under the wrong key. The per-job/backup/catalog bookkeeping wipe is the
    // caller's job (SyncEngine.resetSyncStateForJoin owns that state).
    this.lockLocal();
    // We now belong to the org account; record it and cache the private key.
    this.auth.setAccountId(result.account_id);
    this.cacheMemberKey(privRaw, pubRaw, 2);
    logger.info('cloud-e2ee', `Joined account ${result.account_id} (pending owner approval)`);
    return { recoveryKey };
  }

  // ---- owner approves a pending member ----

  /** Seal the DEK to a pending member's public key so they can decrypt. */
  async approveMember(targetUserId: string): Promise<void> {
    const accountId = await this.accountId();
    const dek = this.getDek(); // owner must be unlocked
    const fingerprint = dekFingerprint(dek);
    const { members } = await this.api.listMembers();
    const member = members.find((m) => m.user_id === targetUserId);
    if (!member || !member.pubkey) {
      throw new E2eeLockedError('That member has not registered an encryption key yet.');
    }
    const sealed = sealDek(dek, Buffer.from(member.pubkey, 'base64'), sealAad(accountId, targetUserId));
    await this.api.approveMember(targetUserId, {
      wrapped_dek: sealed.toString('base64'),
      dek_fingerprint: fingerprint,
    });
    logger.info('cloud-e2ee', `Approved member ${targetUserId}; DEK sealed to their key`);
  }

  // ---- regenerate recovery key ----

  async regenerateRecoveryKey(shorter = false): Promise<E2eeSetupResult> {
    const accountId = await this.accountId();
    const userId = this.userId();
    const material = await this.api.getKeyMaterial();
    if (!material) throw new E2eeUnlockError('Encrypted sync is not set up for this account yet.');

    const recoveryKey = generateRecoveryKey({ short: shorter });
    const kdf: RecoveryKdf = shorter ? 'scrypt' : 'direct';

    if (!(material.format >= 2)) {
      // Legacy: re-wrap the DEK (same DEK, new recovery key).
      const dek = this.getDek();
      const wrapped = await wrapWithRecoveryCode(dek, recoveryKey, this.wrapAad(accountId), kdf);
      await this.api.putKeyMaterial({
        format: 1,
        wrapped_dek: wrapped.toString('base64'),
        dek_fingerprint: dekFingerprint(dek),
      });
      logger.info('cloud-e2ee', 'Recovery key regenerated (format 1)');
      return { recoveryKey };
    }

    // Format 2: re-wrap only this member's private key under the new recovery
    // key. The DEK and its seals are untouched — no data is re-encrypted.
    const priv = this.localPrivateKey();
    if (!priv) {
      throw new E2eeLockedError(
        'Unlock encrypted sync on this computer before regenerating your recovery key.'
      );
    }
    const wrappedPriv = await wrapWithRecoveryCode(priv, recoveryKey, privKeyWrapAad(userId), kdf);
    await this.api.rewrapPrivateKey(wrappedPriv.toString('base64'));
    logger.info('cloud-e2ee', 'Recovery key regenerated (format 2; private key re-wrapped)');
    return { recoveryKey };
  }

  // ---- helpers ----

  private async unwrapLegacyDek(
    wrappedDek: string,
    recoveryKey: string,
    accountId: string,
    fingerprint: string
  ): Promise<Buffer> {
    let dek: Buffer;
    try {
      dek = await unwrapWithRecoveryCode(Buffer.from(wrappedDek, 'base64'), recoveryKey, this.wrapAad(accountId));
    } catch {
      throw new E2eeUnlockError('That recovery key did not match. Check it and try again.');
    }
    if (dekFingerprint(dek) !== fingerprint) {
      throw new E2eeUnlockError(
        'The recovery key unlocked a key that does not match this account. Contact support.'
      );
    }
    return dek;
  }

  /** Transparently move a format-1 account to format 2 on first unlock. Best effort. */
  private async upgradeToFormat2(
    dek: Buffer,
    recoveryKey: string,
    accountId: string,
    userId: string,
    legacyWrappedDek: string
  ): Promise<void> {
    try {
      // Keep the new member wrap on the same KDF the account's legacy wrap uses,
      // so a short-code account stays short-code after the upgrade.
      const kdf: RecoveryKdf = isKdfWrapped(Buffer.from(legacyWrappedDek, 'base64')) ? 'scrypt' : 'direct';
      const { pubRaw, privRaw } = generateMemberKeypair();
      const wrappedPriv = await wrapWithRecoveryCode(privRaw, recoveryKey, privKeyWrapAad(userId), kdf);
      const sealedDek = sealDek(dek, pubRaw, sealAad(accountId, userId));
      await this.api.putKeyMaterial({
        format: 2,
        // Keep the legacy recovery->DEK wrap intact (same recovery key).
        wrapped_dek: legacyWrappedDek,
        dek_fingerprint: dekFingerprint(dek),
        pubkey: pubRaw.toString('base64'),
        wrapped_priv: wrappedPriv.toString('base64'),
        sealed_dek: sealedDek.toString('base64'),
      });
      this.cacheMemberKey(privRaw, pubRaw, 2);
      logger.info('cloud-e2ee', 'Upgraded encrypted sync to format 2 (per-member keys)');
    } catch (err: any) {
      // Non-fatal: the DEK is already cached, so sync works; we retry the
      // upgrade on the next unlock.
      logger.warn('cloud-e2ee', 'Format 1->2 upgrade deferred', err?.message);
    }
  }

  private derivePub(privRaw: Buffer): Buffer {
    const priv = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), privRaw]),
      format: 'der',
      type: 'pkcs8',
    });
    const der = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
    return Buffer.from(der.subarray(der.length - 32));
  }

  private wrapAad(accountId: string): Buffer {
    return syncAad(accountId, WRAP_SCOPE, WRAP_TYPE);
  }

  private cacheDek(dek: Buffer, fingerprint: string): void {
    this.db
      .prepare('UPDATE cloud_auth SET dek_enc = ?, dek_fingerprint = ? WHERE id = 1')
      .run(encryptToken(dek.toString('hex')), fingerprint);
  }

  private cacheMemberKey(privRaw: Buffer, pubRaw: Buffer, format: number): void {
    this.db
      .prepare('UPDATE cloud_auth SET member_priv_enc = ?, member_pub = ?, e2ee_format = ? WHERE id = 1')
      .run(encryptToken(privRaw.toString('hex')), pubRaw.toString('base64'), format);
  }

  private row():
    | {
        dek_enc: string | null;
        dek_fingerprint: string | null;
        member_priv_enc: string | null;
        member_pub: string | null;
        e2ee_format: number | null;
      }
    | undefined {
    return this.db
      .prepare(
        'SELECT dek_enc, dek_fingerprint, member_priv_enc, member_pub, e2ee_format FROM cloud_auth WHERE id = 1'
      )
      .get() as any;
  }

  private userId(): string {
    const id = this.auth.getUserId();
    if (!id) throw new E2eeUnlockError('Sign in to use encrypted sync.');
    return id;
  }

  private async accountId(): Promise<string> {
    const cached = this.auth.getAccountId();
    if (cached) return cached;
    const me = await this.api.me();
    this.auth.setAccountId(me.account.id);
    return me.account.id;
  }
}

/**
 * End-to-end encryption key management (zero-knowledge sync).
 *
 * One key scheme (format 2), used by solo accounts and multi-member orgs alike:
 *
 *   recovery key (256-bit, per member) --wraps--> member X25519 PRIVATE key
 *   member private key + sealed blob ------------> DEK (sealed to the member's
 *                                                  public key by an owner)
 *   DEK (256-bit) --encrypts--> all synced data
 *
 * One per-account Data Encryption Key (DEK) encrypts every synced payload. The
 * DEK is *sealed* to each member's public key (one wrap per member), so several
 * people can decrypt the same account while the server still holds only
 * ciphertext. Each member's private key is wrapped under their own recovery
 * key. The server never sees a recovery key, a private key, or the raw DEK — it
 * cannot read anything (zero-knowledge).
 *
 * A "format 1" scheme (the recovery key wrapping the DEK directly, single-user)
 * existed in the schema but was never written by any released build — setup()
 * has always emitted format 2 — and production held zero e2ee_keys rows, so no
 * format-1 account ever existed anywhere. Its branches, the legacy-unlock path,
 * and the 1->2 upgrade were removed on 2026-07-26. What survives is
 * e2ee_keys.wrapped_dek itself: still written at setup and rotated on
 * regenerate, as the account-level owner-recovery path beside the member seals.
 *
 * Joining is two-step by construction: a newcomer registers their public key
 * (status 'pending'; they can authenticate but decrypt nothing), then an
 * already-unlocked owner seals the DEK to that key (status 'active'). Only an
 * unlocked member holds the DEK to seal — the server cannot do it.
 *
 * After unlock the DEK (and the member private key) are cached locally with the
 * OS keychain (safeStorage) so day-to-day sync never re-prompts.
 */

import Database from 'better-sqlite3';
import { logger } from '../logger';
import { CloudAuth, encryptToken, decryptToken } from './supabase-auth';
import { CloudApiClient, CloudApiError } from './api-client';
import {
  syncAad,
  encryptForSync,
  decryptForSync,
  inviteKeyBinding,
  verifyInviteKeyBinding,
  generateRecoveryKey,
  dekFingerprint,
  generateMemberKeypair,
  sealDek,
  openDek,
  sealAad,
  privKeyWrapAad,
  wrapWithRecoveryCode,
  unwrapWithRecoveryCode,
  pubkeySafetyCode,
  ShortRecoveryKeyRetiredError,
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
/** Matches the entropy the Worker used when it minted tokens itself. */
const INVITE_TOKEN_BYTES = 24;

/** Wrong/garbled recovery key, or a fresh device that can't unlock. */
export class E2eeUnlockError extends Error {}
/** Tried to set up E2EE when the account already has key material. */
export class E2eeAlreadySetupError extends Error {}
/** The DEK is needed but not unlocked on this device. */
export class E2eeLockedError extends Error {}
/**
 * The pending member's public key does not match what the invite holder
 * generated. Its own class because this is the one failure here that means
 * "someone is interfering", not "something went wrong".
 */
export class E2eeKeyBindingError extends Error {}

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

  /**
   * This device's member-key device code, for out-of-band approval
   * verification (the joiner reads it to the owner). Null before joining.
   */
  mySafetyCode(): string | null {
    const pub = this.row()?.member_pub;
    return pub ? pubkeySafetyCode(Buffer.from(pub, 'base64')) : null;
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

    // Joined but not approved yet?
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

  async setup(): Promise<E2eeSetupResult> {
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
    const recoveryKey = generateRecoveryKey();
    const fingerprint = dekFingerprint(dek);
    const { pubRaw, privRaw } = generateMemberKeypair();

    // Account-level recovery wrap (owner recovery) + this owner's member material.
    const wrappedDek = wrapWithRecoveryCode(dek, recoveryKey, this.wrapAad(accountId));
    const wrappedPriv = wrapWithRecoveryCode(privRaw, recoveryKey, privKeyWrapAad(userId));
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

    // Recover this member's private key, then open the DEK sealed to it.
    if (!material.my_wrapped_priv) {
      throw new E2eeUnlockError(
        "You haven't joined this account's encrypted sync yet, or your key was removed."
      );
    }
    let priv: Buffer;
    try {
      priv = unwrapWithRecoveryCode(
        Buffer.from(material.my_wrapped_priv, 'base64'),
        recoveryKey,
        privKeyWrapAad(userId)
      );
      if (priv.length !== DEK_LENGTH) {
        throw new E2eeUnlockError('Unwrapped private key has the wrong length.');
      }
    } catch (err) {
      // A wrap in the retired short-key format is not a typo. Pass its own
      // message through instead of sending the user off to re-check a recovery
      // key that is very likely correct.
      if (err instanceof ShortRecoveryKeyRetiredError) throw new E2eeUnlockError(err.message);
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
   *
   * `applyJoinReset` (the sync engine's bookkeeping wipe) runs INSIDE the same
   * SQLite transaction as the account-id switch. Storing the new account id
   * bypasses requireAccountId's switch detector, so if a crash landed between
   * the switch and the wipe, the next pass would push the joiner's private solo
   * jobs into the shared org under their stale cloud ids. Atomically it's
   * either both (clean join) or neither — and "neither" is recovered by the
   * switch detector, which sees the old stored id disagree with /me.
   */
  async joinWithInvite(token: string, applyJoinReset?: () => void): Promise<E2eeSetupResult> {
    const userId = this.userId();
    const recoveryKey = generateRecoveryKey();
    const { pubRaw, privRaw } = generateMemberKeypair();
    const wrappedPriv = wrapWithRecoveryCode(privRaw, recoveryKey, privKeyWrapAad(userId));

    const result = await this.api.redeemInvite({
      token,
      pubkey: pubRaw.toString('base64'),
      wrapped_priv: wrappedPriv.toString('base64'),
      // Proves to the approving owner that this pubkey came from someone
      // holding the invite token — which the server does not have.
      key_binding: inviteKeyBinding(token, pubRaw),
    });
    // Redeem succeeded — we've left our old (solo) account for the org. Forget
    // the old account's cached DEK + member key BEFORE caching the new one, or a
    // stale DEK would make state() report 'unlocked' (line: hasLocalDek short-
    // circuits the pending check) and the sync engine could encrypt org data
    // under the wrong key.
    this.db.transaction(() => {
      this.lockLocal();
      applyJoinReset?.();
      // We now belong to the org account; record it and cache the private key.
      this.auth.setAccountId(result.account_id);
      this.cacheMemberKey(privRaw, pubRaw, 2);
    })();
    logger.info('cloud-e2ee', `Joined account ${result.account_id} (pending owner approval)`);
    return { recoveryKey };
  }

  // ---- owner mints an invite ----

  /**
   * Mint a single-use invite on this machine. The token is generated here, so
   * the server only ever receives its SHA-256 and `enc_token` — the same token
   * encrypted under the account DEK. That encrypted copy is what lets this
   * owner recover the token at approval time (without having kept it) to check
   * the joiner's key binding. Returns the raw token to show exactly once.
   */
  async createInvite(role: 'member' | 'owner' = 'member'): Promise<{ id: string; token: string; role: string }> {
    const accountId = await this.accountId();
    const dek = this.getDek(); // must be unlocked to seal the token
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
    const encToken = encryptForSync(
      Buffer.from(token, 'utf8'),
      dek,
      this.inviteTokenAad(accountId, id)
    );
    const res = await this.api.createInvite({
      id,
      token_hash: crypto.createHash('sha256').update(token, 'utf8').digest('hex'),
      enc_token: encToken.toString('base64'),
      role,
    });
    logger.info('cloud-e2ee', `Created ${role} invite ${id}`);
    return { id: res.id, token, role: res.role };
  }

  // ---- owner approves a pending member ----

  /**
   * Seal the DEK to a pending member's public key so they can decrypt.
   *
   * Verifies first that the key really is theirs. `verified: false` means the
   * binding was unavailable (the member joined from a client that predates it),
   * so the caller must fall back to having the owner compare device codes out
   * of band — it does NOT mean anything was wrong.
   */
  async approveMember(targetUserId: string): Promise<{ verified: boolean }> {
    const accountId = await this.accountId();
    const dek = this.getDek(); // owner must be unlocked
    const fingerprint = dekFingerprint(dek);
    const { members } = await this.api.listMembers();
    const member = members.find((m) => m.user_id === targetUserId);
    if (!member || !member.pubkey) {
      throw new E2eeLockedError('That member has not registered an encryption key yet.');
    }
    const pubRaw = Buffer.from(member.pubkey, 'base64');
    const verified = this.verifyMemberBinding(member, pubRaw, accountId, dek);

    const sealed = sealDek(dek, pubRaw, sealAad(accountId, targetUserId));
    await this.api.approveMember(targetUserId, {
      wrapped_dek: sealed.toString('base64'),
      dek_fingerprint: fingerprint,
    });
    logger.info(
      'cloud-e2ee',
      `Approved member ${targetUserId}; DEK sealed to their key (binding ${verified ? 'verified' : 'unavailable'})`
    );
    return { verified };
  }

  /**
   * Refuse to seal the account DEK to a public key the invite holder did not
   * generate. Without this the owner seals to whatever `pubkey` the *server*
   * returned, so a compromised server could substitute its own key and receive
   * a DEK it can open — voiding zero-knowledge for the whole team.
   *
   * Recovers the invite token from its DEK-encrypted copy and recomputes the
   * HMAC the member sent at redeem. Returns false (does not throw) when either
   * value is missing: an invite created or redeemed by desktop v0.3.3 has
   * neither, and that is *unverified*, not tampered — hard-failing it would
   * break team joins for anyone mid-upgrade. A binding that is present and
   * wrong is a different matter and throws.
   */
  private verifyMemberBinding(
    member: { user_id: string; key_binding?: string | null; invite_enc_token?: string | null; invite_id?: string | null },
    pubRaw: Buffer,
    accountId: string,
    dek: Buffer
  ): boolean {
    if (!member.key_binding || !member.invite_enc_token || !member.invite_id) {
      logger.warn(
        'cloud-e2ee',
        `No key binding stored for ${member.user_id}; approval falls back to the device-code check`
      );
      return false;
    }
    let token: string;
    try {
      token = decryptForSync(
        Buffer.from(member.invite_enc_token, 'base64'),
        dek,
        this.inviteTokenAad(accountId, member.invite_id)
      ).toString('utf8');
    } catch {
      throw new E2eeKeyBindingError(
        'The stored invite could not be opened with this account key, so their identity cannot be checked. ' +
          'Do not approve. Revoke the invite and send a new one.'
      );
    }
    if (!verifyInviteKeyBinding(token, pubRaw, member.key_binding)) {
      throw new E2eeKeyBindingError(
        'The encryption key the server returned for this person is NOT the one they generated. ' +
          'Do not approve them. Revoke the invite, send a new one, and get in touch — this should never happen.'
      );
    }
    return true;
  }

  /** AAD binding an encrypted invite token to its account and invite id. */
  private inviteTokenAad(accountId: string, inviteId: string): Buffer {
    return syncAad(accountId, 'account', `invite-token:${inviteId}`);
  }

  // ---- regenerate recovery key ----

  async regenerateRecoveryKey(): Promise<E2eeSetupResult> {
    const accountId = await this.accountId();
    const userId = this.userId();
    const material = await this.api.getKeyMaterial();
    if (!material) throw new E2eeUnlockError('Encrypted sync is not set up for this account yet.');

    const recoveryKey = generateRecoveryKey();

    // Re-wrap this member's private key under the new recovery key.
    // The DEK and its member seals are untouched — no data is re-encrypted.
    const priv = this.localPrivateKey();
    if (!priv) {
      throw new E2eeLockedError(
        'Unlock encrypted sync on this computer before regenerating your recovery key.'
      );
    }
    const wrappedPriv = wrapWithRecoveryCode(priv, recoveryKey, privKeyWrapAad(userId));

    // For an OWNER the private-key rewrap alone is not enough: the
    // account-level wrap (e2ee_keys.wrapped_dek, written at setup) is wrapped
    // under their ORIGINAL recovery key and still served by GET /keys, so
    // leaving it alone means a leaked
    // recovery key the owner believes revoked can unwrap the DEK offline
    // forever. Re-wrap it under the new key in the same PUT /keys that also
    // carries the new wrapped_priv (PUT /keys is owner-only, so members fall
    // through to the rewrap-only endpoint — the account wrap was never under
    // their recovery key to begin with).
    let isOwner = false;
    try {
      isOwner = (await this.api.me()).role === 'owner';
    } catch {
      // Can't determine the role — fall through to the member path; the next
      // owner regenerate will rotate the account wrap.
    }
    if (isOwner) {
      const dek = this.dekForRewrap(material, priv, accountId, userId);
      if (dek) {
        const pubRaw = this.derivePub(priv);
        const wrappedDek = wrapWithRecoveryCode(dek, recoveryKey, this.wrapAad(accountId));
        const sealedDek = sealDek(dek, pubRaw, sealAad(accountId, userId));
        await this.api.putKeyMaterial({
          format: 2,
          wrapped_dek: wrappedDek.toString('base64'),
          dek_fingerprint: material.dek_fingerprint,
          pubkey: pubRaw.toString('base64'),
          wrapped_priv: wrappedPriv.toString('base64'),
          sealed_dek: sealedDek.toString('base64'),
        });
        logger.info(
          'cloud-e2ee',
          'Recovery key regenerated (private key AND account recovery wrap re-wrapped)'
        );
        return { recoveryKey };
      }
      logger.warn(
        'cloud-e2ee',
        'Owner regenerate could not obtain the DEK; the account-level wrap still uses the old recovery key'
      );
    }

    await this.api.rewrapPrivateKey(wrappedPriv.toString('base64'));
    logger.info('cloud-e2ee', 'Recovery key regenerated (private key re-wrapped)');
    return { recoveryKey };
  }

  /**
   * The DEK for an owner's recovery-key rotation: the local cache when
   * unlocked, else opened from this member's sealed wrap. Returns null (never
   * throws) if neither yields a DEK matching the account fingerprint.
   */
  private dekForRewrap(
    material: { dek_fingerprint: string; my_wrapped_dek?: string | null },
    priv: Buffer,
    accountId: string,
    userId: string
  ): Buffer | null {
    try {
      if (this.hasLocalDek()) {
        const dek = this.getDek();
        if (dekFingerprint(dek) === material.dek_fingerprint) return dek;
      }
    } catch {
      // fall through to the sealed wrap
    }
    if (material.my_wrapped_dek) {
      try {
        const dek = openDek(Buffer.from(material.my_wrapped_dek, 'base64'), priv, sealAad(accountId, userId));
        if (dekFingerprint(dek) === material.dek_fingerprint) return dek;
      } catch {
        // no usable DEK
      }
    }
    return null;
  }

  // ---- helpers ----

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

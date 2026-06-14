/**
 * End-to-end encryption key management (zero-knowledge sync).
 *
 * Key hierarchy:
 *   recovery key (256-bit random) --used directly--> wraps the DEK
 *   DEK (256-bit random) ----------------------------> encrypts all synced data
 *
 * One per-account Data Encryption Key (DEK) encrypts every synced payload
 * (job snapshots, takeoff markup, catalog, plan PDFs, job names) and the whole
 * backup. The DEK is wrapped by the recovery key and the wrapped copy is stored
 * in the cloud — the server holds it but cannot open it (it never sees the
 * recovery key or the raw DEK). After unlock the DEK is cached locally with the
 * OS keychain (safeStorage) so day-to-day sync never re-prompts.
 *
 * The recovery key is the *only* unlock secret (no passphrase — that avoids
 * confusion with the login password and a login-password-derived key would not
 * be zero-knowledge, since Supabase password auth sees the plaintext password).
 * Lose the recovery key AND every device that has the DEK cached, and the cloud
 * copy is unreadable — by the user and by us. That is the zero-knowledge
 * contract; the setup UI makes saving the key un-skippable.
 */

import Database from 'better-sqlite3';
import { logger } from '../logger';
import { CloudAuth, encryptToken, decryptToken } from './supabase-auth';
import { CloudApiClient, CloudApiError } from './api-client';
import {
  encryptForSync,
  decryptForSync,
  syncAad,
  generateRecoveryKey,
  recoveryKeyToBytes,
  dekFingerprint,
  RecoveryKeyError,
} from './sync-crypto';
import crypto from 'crypto';

/**
 * - `not_setup`: no key material anywhere — first-enable flow.
 * - `unlocked`: the DEK is cached on this device; sync proceeds.
 * - `locked`: the account has key material but this device hasn't unlocked it.
 * - `unavailable`: not signed in (aal<2) or the cloud is unreachable.
 */
export type E2eeState = 'not_setup' | 'unlocked' | 'locked' | 'unavailable';

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

  /** Forget the cached DEK on this device (sign-out / account switch). */
  lockLocal(): void {
    this.db.prepare('UPDATE cloud_auth SET dek_enc = NULL, dek_fingerprint = NULL WHERE id = 1').run();
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
    return material ? 'locked' : 'not_setup';
  }

  // ---- first enable ----

  async setup(): Promise<E2eeSetupResult> {
    const accountId = await this.accountId();
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
    const wrapped = encryptForSync(dek, recoveryKeyToBytes(recoveryKey), this.wrapAad(accountId));
    try {
      await this.api.putKeyMaterial({
        format: 1,
        wrapped_dek: wrapped.toString('base64'),
        dek_fingerprint: fingerprint,
      });
    } catch (err) {
      // Lost a setup race against another device — adopt the existing key.
      if (err instanceof CloudApiError && err.code === 'e2ee_key_conflict') {
        throw new E2eeAlreadySetupError(
          'Encrypted sync was just set up on another device. Unlock it with your recovery key instead.'
        );
      }
      throw err;
    }
    this.cacheDek(dek, fingerprint);
    logger.info('cloud-e2ee', 'Encrypted sync enabled; DEK wrapped under a new recovery key');
    return { recoveryKey };
  }

  // ---- fresh-device unlock ----

  async unlock(recoveryKey: string): Promise<void> {
    const accountId = await this.accountId();
    const material = await this.api.getKeyMaterial();
    if (!material) {
      throw new E2eeUnlockError('Encrypted sync is not set up for this account yet.');
    }
    let kek: Buffer;
    try {
      kek = recoveryKeyToBytes(recoveryKey);
    } catch (err) {
      if (err instanceof RecoveryKeyError) {
        throw new E2eeUnlockError(`That recovery key isn't valid — ${err.message}`);
      }
      throw err;
    }
    let dek: Buffer;
    try {
      dek = decryptForSync(Buffer.from(material.wrapped_dek, 'base64'), kek, this.wrapAad(accountId));
    } catch {
      throw new E2eeUnlockError('That recovery key did not match. Check it and try again.');
    }
    if (dekFingerprint(dek) !== material.dek_fingerprint) {
      throw new E2eeUnlockError(
        'The recovery key unlocked a key that does not match this account. Contact support.'
      );
    }
    this.cacheDek(dek, material.dek_fingerprint);
    logger.info('cloud-e2ee', 'Encrypted sync unlocked on this computer');
  }

  // ---- regenerate recovery key (re-wrap, never re-encrypt) ----

  async regenerateRecoveryKey(): Promise<E2eeSetupResult> {
    const accountId = await this.accountId();
    const dek = this.getDek(); // requires this device to be unlocked
    const fingerprint = dekFingerprint(dek);
    const recoveryKey = generateRecoveryKey();
    const wrapped = encryptForSync(dek, recoveryKeyToBytes(recoveryKey), this.wrapAad(accountId));
    // Same DEK fingerprint → the Worker accepts it as a re-wrap, not a clobber.
    await this.api.putKeyMaterial({
      format: 1,
      wrapped_dek: wrapped.toString('base64'),
      dek_fingerprint: fingerprint,
    });
    logger.info('cloud-e2ee', 'Recovery key regenerated; DEK re-wrapped (no data re-encrypted)');
    return { recoveryKey };
  }

  // ---- helpers ----

  private wrapAad(accountId: string): Buffer {
    return syncAad(accountId, WRAP_SCOPE, WRAP_TYPE);
  }

  private cacheDek(dek: Buffer, fingerprint: string): void {
    this.db
      .prepare('UPDATE cloud_auth SET dek_enc = ?, dek_fingerprint = ? WHERE id = 1')
      .run(encryptToken(dek.toString('hex')), fingerprint);
  }

  private row(): { dek_enc: string | null; dek_fingerprint: string | null } | undefined {
    return this.db
      .prepare('SELECT dek_enc, dek_fingerprint FROM cloud_auth WHERE id = 1')
      .get() as any;
  }

  private async accountId(): Promise<string> {
    const cached = this.auth.getAccountId();
    if (cached) return cached;
    const me = await this.api.me();
    this.auth.setAccountId(me.account.id);
    return me.account.id;
  }
}

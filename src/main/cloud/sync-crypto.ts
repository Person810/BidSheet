/**
 * End-to-end encryption for cloud sync payloads (zero-knowledge sync).
 *
 * Unlike backup-crypto (which derives a key from a passphrase with scrypt),
 * this format is keyed *directly* by a 32-byte Data Encryption Key (DEK) — a
 * uniformly random key, so no slow KDF is needed. The DEK encrypts every synced
 * payload (job snapshots, takeoff markup, catalog, plan PDFs, job names) and is
 * itself wrapped by the recovery key using this same envelope. The server
 * stores only ciphertext and the wrapped DEK; it can read nothing.
 *
 * Blob layout (all lengths fixed except the ciphertext):
 *
 *   magic "BSE1" (4) | format version (1) | iv (12) | ciphertext (n)
 *   | GCM auth tag (16)
 *
 * No salt: the key is the DEK, not derived per-payload. A fresh random IV per
 * payload keeps GCM safe under one long-lived key (random 96-bit IVs collide
 * only after ~2^48 encryptions — astronomically beyond an account's lifetime
 * payload count). The AAD (see syncAad) is NOT stored in the blob; it is
 * reconstructed from the request context on decrypt, so a ciphertext moved to a
 * different account/job/payload-type fails the auth tag — a malicious server
 * cannot swap one ciphertext for another.
 */

import crypto from 'crypto';

const MAGIC = Buffer.from('BSE1');
const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH;

// Bumped only if the AAD construction itself changes; lets old ciphertexts
// stay decryptable across a future format revision.
const AAD_VERSION = '1';

export class SyncDecryptError extends Error {}

/**
 * The additional-authenticated-data string that binds a ciphertext to its
 * place. scope is the cloudId for per-job payloads or the literal "account"
 * for account-wide blobs (catalog, backup, DEK wrap). payloadType distinguishes
 * job/markup/catalog/backup/name/plan:<sha>/dek-wrap so one payload can never
 * be passed off as another.
 */
export function syncAad(accountId: string, scope: string, payloadType: string): Buffer {
  return Buffer.from(`BSE1\0${accountId}\0${scope}\0${payloadType}\0${AAD_VERSION}`, 'utf8');
}

/** True if a blob is a BSE1 payload (vs. legacy plaintext JSON, which starts with '{'). */
export function isEncryptedPayload(blob: Buffer): boolean {
  return blob.length >= MAGIC.length && blob.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Encrypt a payload with the DEK, binding it to its context via AAD. */
export function encryptForSync(plaintext: Buffer, dek: Buffer, aad: Buffer): Buffer {
  if (dek.length !== KEY_LENGTH) throw new Error('Bad DEK length');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), iv]);
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()]);
}

/**
 * Decrypt a payload with the DEK and its expected AAD. Throws SyncDecryptError
 * on a wrong DEK, a tampered blob, OR an AAD mismatch (a ciphertext moved to
 * the wrong account/job/type) — GCM cannot tell those apart, and neither can we.
 */
export function decryptForSync(blob: Buffer, dek: Buffer, aad: Buffer): Buffer {
  if (dek.length !== KEY_LENGTH) throw new Error('Bad DEK length');
  parseHeader(blob);
  const iv = blob.subarray(HEADER_LENGTH - IV_LENGTH, HEADER_LENGTH);
  const ciphertext = blob.subarray(HEADER_LENGTH, blob.length - TAG_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SyncDecryptError(
      'Could not decrypt cloud data — wrong key, wrong context, or the data is damaged.'
    );
  }
}

/**
 * The content hash sent to the cloud for change detection. An HMAC keyed by the
 * DEK, not a bare hash: the server (or anyone seeing /jobs) cannot precompute or
 * confirm a guessed snapshot's contents from it. Deterministic per content, so
 * change detection still works. The bare local hash stays separate (it never
 * leaves the device).
 */
export function syncContentMac(plaintext: Buffer, dek: Buffer): string {
  return crypto.createHmac('sha256', dek).update(plaintext).digest('hex');
}

// ---- recovery key (the single E2EE unlock secret) ----
// A 256-bit uniformly random key, shown once and saved by the user. Because it
// is full-entropy it is used *directly* as the DEK-wrapping key — no scrypt
// (a slow KDF only hardens low-entropy human passwords; 2^256 cannot be
// brute-forced). Encoded as Crockford base32 (no I/L/O/U), grouped and prefixed
// for legible transcription. Normalization maps the ambiguous I/L/O back so a
// hand-typed key still decodes.

const RECOVERY_KEY_BYTES = 32;
const RECOVERY_KEY_PREFIX = 'BSK1';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export class RecoveryKeyError extends Error {}

/** A fresh 256-bit recovery key, formatted "BSK1-XXXX-XXXX-…" for display. */
export function generateRecoveryKey(): string {
  const raw = base32Encode(crypto.randomBytes(RECOVERY_KEY_BYTES));
  const groups = raw.match(/.{1,4}/g) ?? [raw];
  return `${RECOVERY_KEY_PREFIX}-${groups.join('-')}`;
}

/** Decode a (possibly hand-typed) recovery key back to its 32 raw key bytes. */
export function recoveryKeyToBytes(raw: string): Buffer {
  const normalized = raw
    .toUpperCase()
    .replace(new RegExp(`^${RECOVERY_KEY_PREFIX}-?`), '')
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  const decoded = base32Decode(normalized);
  if (decoded.length < RECOVERY_KEY_BYTES) {
    throw new RecoveryKeyError('Recovery key is incomplete.');
  }
  return decoded.subarray(0, RECOVERY_KEY_BYTES);
}

/**
 * A short, non-invertible fingerprint of the (random) DEK — for detecting a
 * mismatched/garbled wrapped key. Truncated SHA-256 of a 256-bit random value
 * leaks nothing usable.
 */
export function dekFingerprint(dek: Buffer): string {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([Buffer.from('BSE1-fp\0'), dek]))
    .digest('hex')
    .slice(0, 16);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of s) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx === -1) throw new RecoveryKeyError('Recovery key contains invalid characters.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function parseHeader(blob: Buffer): void {
  if (blob.length < HEADER_LENGTH + TAG_LENGTH || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new SyncDecryptError('This is not BidSheet encrypted cloud data.');
  }
  const version = blob[MAGIC.length];
  if (version !== FORMAT_VERSION) {
    throw new SyncDecryptError(
      `This cloud data uses format v${version}, which this version of BidSheet doesn't understand. Update BidSheet and try again.`
    );
  }
}

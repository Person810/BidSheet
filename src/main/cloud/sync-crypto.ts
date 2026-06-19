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

// ---- asymmetric key wrapping (multi-member E2EE) ----
// To share the one account DEK with more than one person while staying
// zero-knowledge, the DEK is *sealed* to each member's X25519 public key
// (libsodium crypto_box_seal semantics). Only the holder of the matching
// private key can open it; the server stores the sealed blobs and learns
// nothing. The private key itself is wrapped under that member's recovery key
// (wrapPrivateKey), so the recovery key now protects the private key, and the
// DEK is reached transitively: recovery key -> private key -> sealed DEK -> DEK.
//
// Keys travel as raw 32-byte values (base64 at the wire/DB layer) so a future
// iOS client using CryptoKit's Curve25519 rawRepresentation interops byte-for-
// byte. Node's KeyObjects need DER, so we wrap/unwrap the fixed RFC 8410
// prefixes for X25519 SPKI (public) and PKCS#8 (private).

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex'); // 12 bytes + 32-byte key
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex'); // 16 bytes + 32-byte key
const SEAL_INFO = Buffer.from('BSE1-seal\0');

export interface MemberKeypair {
  /** Raw 32-byte X25519 public key (shared with the account; base64 on the wire). */
  pubRaw: Buffer;
  /** Raw 32-byte X25519 private scalar (kept on the member's devices). */
  privRaw: Buffer;
}

/** A fresh X25519 identity keypair for one member. */
export function generateMemberKeypair(): MemberKeypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { pubRaw: x25519PubToRaw(publicKey), privRaw: x25519PrivToRaw(privateKey) };
}

/**
 * Seal the DEK to a member's public key. Returns `ephPub(32) ‖ BSE1(dek)`. A
 * fresh ephemeral keypair per seal makes each blob independent; the wrapping key
 * is HKDF over the ECDH shared secret, with both public keys bound into `info`
 * (so a sealed blob cannot be relabelled for a different recipient/ephemeral).
 */
export function sealDek(dek: Buffer, recipientPubRaw: Buffer, aad: Buffer): Buffer {
  const eph = crypto.generateKeyPairSync('x25519');
  const ephPubRaw = x25519PubToRaw(eph.publicKey);
  const shared = crypto.diffieHellman({
    privateKey: eph.privateKey,
    publicKey: rawToX25519Pub(recipientPubRaw),
  });
  const wrapKey = deriveSealKey(shared, ephPubRaw, recipientPubRaw);
  return Buffer.concat([ephPubRaw, encryptForSync(dek, wrapKey, aad)]);
}

/**
 * Open a DEK sealed to my public key, using my private key. Throws
 * SyncDecryptError on a wrong key, tampered blob, or AAD mismatch.
 */
export function openDek(blob: Buffer, myPrivRaw: Buffer, aad: Buffer): Buffer {
  if (blob.length < 32 + HEADER_LENGTH + TAG_LENGTH) {
    throw new SyncDecryptError('Sealed key blob is too short.');
  }
  const ephPubRaw = blob.subarray(0, 32);
  const wrapped = blob.subarray(32);
  const myPriv = rawToX25519Priv(myPrivRaw);
  const myPubRaw = x25519PubToRaw(crypto.createPublicKey(myPriv));
  const shared = crypto.diffieHellman({ privateKey: myPriv, publicKey: rawToX25519Pub(ephPubRaw) });
  const wrapKey = deriveSealKey(shared, ephPubRaw, myPubRaw);
  return decryptForSync(wrapped, wrapKey, aad);
}

/** Wrap a member's raw private key under their recovery key (BSE1 envelope). */
export function wrapPrivateKey(privRaw: Buffer, recoveryKeyBytes: Buffer, aad: Buffer): Buffer {
  if (privRaw.length !== KEY_LENGTH) throw new Error('Bad private key length');
  return encryptForSync(privRaw, recoveryKeyBytes, aad);
}

/** Recover a member's raw private key from its wrapped blob using the recovery key. */
export function unwrapPrivateKey(blob: Buffer, recoveryKeyBytes: Buffer, aad: Buffer): Buffer {
  const priv = decryptForSync(blob, recoveryKeyBytes, aad);
  if (priv.length !== KEY_LENGTH) {
    throw new SyncDecryptError('Unwrapped private key has the wrong length.');
  }
  return priv;
}

/** AAD binding a sealed DEK to the account and the recipient it was sealed for. */
export function sealAad(accountId: string, recipientUserId: string): Buffer {
  return syncAad(accountId, 'account', `dek-seal:${recipientUserId}`);
}

/**
 * AAD binding a wrapped private key to its owning member. Keyed by userId only
 * (not the account): a newcomer wraps their private key under their recovery
 * key *before* redeeming an invite, so the account isn't known yet — but the
 * userId (Supabase sub) is stable and globally unique.
 */
export function privKeyWrapAad(userId: string): Buffer {
  return syncAad(userId, 'member', 'privkey-wrap');
}

function deriveSealKey(shared: Buffer, ephPubRaw: Buffer, recipientPubRaw: Buffer): Buffer {
  const info = Buffer.concat([SEAL_INFO, ephPubRaw, recipientPubRaw]);
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), info, KEY_LENGTH));
}

function x25519PubToRaw(key: crypto.KeyObject): Buffer {
  const der = key.export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32));
}

function x25519PrivToRaw(key: crypto.KeyObject): Buffer {
  const der = key.export({ format: 'der', type: 'pkcs8' });
  return Buffer.from(der.subarray(der.length - 32));
}

function rawToX25519Pub(pubRaw: Buffer): crypto.KeyObject {
  if (pubRaw.length !== 32) throw new SyncDecryptError('X25519 public key must be 32 bytes.');
  return crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, pubRaw]),
    format: 'der',
    type: 'spki',
  });
}

function rawToX25519Priv(privRaw: Buffer): crypto.KeyObject {
  if (privRaw.length !== 32) throw new SyncDecryptError('X25519 private key must be 32 bytes.');
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, privRaw]),
    format: 'der',
    type: 'pkcs8',
  });
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

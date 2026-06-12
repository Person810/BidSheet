/**
 * Passphrase encryption for cloud database backups (Phase 3a).
 *
 * Standard primitives only, all from Node's crypto module: scrypt for the
 * passphrase-derived key, AES-256-GCM for authenticated encryption. The
 * server stores opaque ciphertext — neither the passphrase nor the derived
 * key ever leaves this machine.
 *
 * Blob layout (all lengths fixed except the ciphertext):
 *
 *   magic "BSBK" (4) | format version (1) | salt (16) | iv (12)
 *   | ciphertext (n) | GCM auth tag (16)
 *
 * The salt travels in the header so a fresh install can re-derive the key
 * from the passphrase alone — that's the whole dead-laptop story. GCM
 * authenticates the payload, so a wrong passphrase and a tampered blob both
 * fail the same way: loudly, with nothing written.
 */

import crypto from 'crypto';

const MAGIC = Buffer.from('BSBK');
const FORMAT_VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HEADER_LENGTH = MAGIC.length + 1 + SALT_LENGTH + IV_LENGTH;

// OWASP-recommended interactive scrypt parameters (N=2^17, r=8, p=1).
// ~1s on a modern machine — runs once per backup setup or restore, never
// in a hot path. maxmem must clear 128*N*r bytes (Node defaults to 32 MB).
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export class BackupDecryptError extends Error {}

export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/** Derive the 32-byte AES key from a passphrase. CPU-bound by design. */
export function deriveBackupKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

/** Encrypt a backup with an already-derived key (salt rides in the header). */
export function encryptBackup(plaintext: Buffer, key: Buffer, salt: Buffer): Buffer {
  if (salt.length !== SALT_LENGTH) throw new Error('Bad salt length');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), salt, iv]);
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()]);
}

/** The salt from a blob's header, for re-deriving the key on a new machine. */
export function readBackupSalt(blob: Buffer): Buffer {
  parseHeader(blob);
  return blob.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_LENGTH);
}

/**
 * Decrypt with an already-derived key. Throws BackupDecryptError on a wrong
 * key or any tampering — GCM cannot tell those apart, and neither can we.
 */
export function decryptBackup(blob: Buffer, key: Buffer): Buffer {
  parseHeader(blob);
  const iv = blob.subarray(HEADER_LENGTH - IV_LENGTH, HEADER_LENGTH);
  const ciphertext = blob.subarray(HEADER_LENGTH, blob.length - TAG_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new BackupDecryptError(
      'Could not decrypt the backup — wrong passphrase, or the file is damaged.'
    );
  }
}

/** Decrypt a downloaded blob from scratch: derive the key, then decrypt. */
export async function decryptBackupWithPassphrase(blob: Buffer, passphrase: string): Promise<Buffer> {
  const key = await deriveBackupKey(passphrase, readBackupSalt(blob));
  return decryptBackup(blob, key);
}

function parseHeader(blob: Buffer): void {
  if (blob.length < HEADER_LENGTH + TAG_LENGTH || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupDecryptError('This file is not a BidSheet encrypted backup.');
  }
  const version = blob[MAGIC.length];
  if (version !== FORMAT_VERSION) {
    throw new BackupDecryptError(
      `This backup uses format v${version}, which this version of BidSheet doesn't understand. Update BidSheet and try again.`
    );
  }
}

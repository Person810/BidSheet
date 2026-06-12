import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  deriveBackupKey,
  encryptBackup,
  decryptBackup,
  decryptBackupWithPassphrase,
  readBackupSalt,
  BackupDecryptError,
} from './backup-crypto';

// Key derivation is deliberately slow (~1s); derive once and share.
const PASSPHRASE = 'correct horse battery staple';
const salt = generateSalt();
const keyPromise = deriveBackupKey(PASSPHRASE, salt);

describe('backup-crypto', () => {
  it('round-trips a payload through encrypt/decrypt', async () => {
    const key = await keyPromise;
    const plaintext = Buffer.from('SQLite format 3\0 pretend database bytes');
    const blob = encryptBackup(plaintext, key, salt);
    expect(decryptBackup(blob, key).equals(plaintext)).toBe(true);
  });

  it('round-trips from the passphrase alone (fresh-machine restore path)', async () => {
    const key = await keyPromise;
    const plaintext = Buffer.from('dead laptop survivor');
    const blob = encryptBackup(plaintext, key, salt);
    const restored = await decryptBackupWithPassphrase(blob, PASSPHRASE);
    expect(restored.equals(plaintext)).toBe(true);
  });

  it('exposes the salt in the header for re-derivation', async () => {
    const key = await keyPromise;
    const blob = encryptBackup(Buffer.from('x'), key, salt);
    expect(readBackupSalt(blob).equals(salt)).toBe(true);
  });

  it('rejects a wrong passphrase', async () => {
    const key = await keyPromise;
    const blob = encryptBackup(Buffer.from('secret bids'), key, salt);
    await expect(decryptBackupWithPassphrase(blob, 'not the passphrase')).rejects.toThrow(
      BackupDecryptError
    );
  });

  it('rejects a tampered ciphertext', async () => {
    const key = await keyPromise;
    const blob = encryptBackup(Buffer.from('integrity matters'), key, salt);
    blob[blob.length - 20] ^= 0xff; // flip a ciphertext bit
    expect(() => decryptBackup(blob, key)).toThrow(BackupDecryptError);
  });

  it('rejects files that are not backups at all', async () => {
    const key = await keyPromise;
    expect(() => decryptBackup(Buffer.from('SQLite format 3\0'), key)).toThrow(
      BackupDecryptError
    );
    expect(() => decryptBackup(Buffer.alloc(0), key)).toThrow(BackupDecryptError);
  });

  it('rejects unknown format versions', async () => {
    const key = await keyPromise;
    const blob = encryptBackup(Buffer.from('future proof'), key, salt);
    blob[4] = 99; // format version byte
    expect(() => decryptBackup(blob, key)).toThrow(/format v99/);
  });

  it('produces a different blob every time (fresh IV)', async () => {
    const key = await keyPromise;
    const plaintext = Buffer.from('same input');
    const a = encryptBackup(plaintext, key, salt);
    const b = encryptBackup(plaintext, key, salt);
    expect(a.equals(b)).toBe(false);
  });
});

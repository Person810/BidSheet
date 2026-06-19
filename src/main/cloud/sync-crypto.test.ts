import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  encryptForSync,
  decryptForSync,
  isEncryptedPayload,
  syncAad,
  syncContentMac,
  SyncDecryptError,
  generateRecoveryKey,
  recoveryKeyToBytes,
  dekFingerprint,
  RecoveryKeyError,
  generateMemberKeypair,
  sealDek,
  openDek,
  wrapPrivateKey,
  unwrapPrivateKey,
  sealAad,
  privKeyWrapAad,
} from './sync-crypto';

const dek = crypto.randomBytes(32);
const aad = syncAad('acct-1', 'job-1', 'job');

describe('sync-crypto', () => {
  it('round-trips a payload with matching DEK + AAD', () => {
    const plaintext = Buffer.from(JSON.stringify({ job: 'Secret bid', total: 12345 }));
    const blob = encryptForSync(plaintext, dek, aad);
    expect(decryptForSync(blob, dek, aad).equals(plaintext)).toBe(true);
  });

  it('produces ciphertext, not plaintext (zero-knowledge)', () => {
    const plaintext = Buffer.from('{"secret":"bid"}');
    const blob = encryptForSync(plaintext, dek, aad);
    expect(blob.includes(Buffer.from('secret'))).toBe(false);
    expect(isEncryptedPayload(blob)).toBe(true);
  });

  it('distinguishes encrypted blobs from legacy plaintext JSON', () => {
    expect(isEncryptedPayload(Buffer.from('{"format":2}'))).toBe(false);
    expect(isEncryptedPayload(encryptForSync(Buffer.from('x'), dek, aad))).toBe(true);
  });

  it('rejects the wrong DEK', () => {
    const blob = encryptForSync(Buffer.from('bids'), dek, aad);
    expect(() => decryptForSync(blob, crypto.randomBytes(32), aad)).toThrow(SyncDecryptError);
  });

  it('rejects an AAD mismatch (ciphertext moved to another job)', () => {
    const blob = encryptForSync(Buffer.from('bids'), dek, aad);
    const otherJob = syncAad('acct-1', 'job-2', 'job');
    expect(() => decryptForSync(blob, dek, otherJob)).toThrow(SyncDecryptError);
  });

  it('rejects an AAD mismatch (ciphertext moved to another account)', () => {
    const blob = encryptForSync(Buffer.from('bids'), dek, aad);
    const otherAccount = syncAad('acct-2', 'job-1', 'job');
    expect(() => decryptForSync(blob, dek, otherAccount)).toThrow(SyncDecryptError);
  });

  it('rejects an AAD mismatch (payload type swap: job.json as markup)', () => {
    const blob = encryptForSync(Buffer.from('bids'), dek, aad);
    const asMarkup = syncAad('acct-1', 'job-1', 'markup');
    expect(() => decryptForSync(blob, dek, asMarkup)).toThrow(SyncDecryptError);
  });

  it('rejects a tampered ciphertext', () => {
    const blob = encryptForSync(Buffer.from('integrity matters'), dek, aad);
    blob[blob.length - 20] ^= 0xff;
    expect(() => decryptForSync(blob, dek, aad)).toThrow(SyncDecryptError);
  });

  it('rejects non-BSE1 data', () => {
    expect(() => decryptForSync(Buffer.from('not encrypted'), dek, aad)).toThrow(SyncDecryptError);
    expect(() => decryptForSync(Buffer.alloc(0), dek, aad)).toThrow(SyncDecryptError);
  });

  it('rejects unknown format versions', () => {
    const blob = encryptForSync(Buffer.from('future'), dek, aad);
    blob[4] = 99; // format version byte
    expect(() => decryptForSync(blob, dek, aad)).toThrow(/format v99/);
  });

  it('uses a fresh IV every time (same input -> different blob)', () => {
    const plaintext = Buffer.from('same input');
    const a = encryptForSync(plaintext, dek, aad);
    const b = encryptForSync(plaintext, dek, aad);
    expect(a.equals(b)).toBe(false);
  });

  it('content MAC is deterministic per content+key but key-dependent', () => {
    const plaintext = Buffer.from('snapshot bytes');
    expect(syncContentMac(plaintext, dek)).toBe(syncContentMac(plaintext, dek));
    expect(syncContentMac(plaintext, dek)).not.toBe(syncContentMac(plaintext, crypto.randomBytes(32)));
    expect(syncContentMac(plaintext, dek)).not.toBe(syncContentMac(Buffer.from('other'), dek));
  });
});

describe('recovery key', () => {
  it('round-trips a generated key to exactly 32 bytes', () => {
    const rk = generateRecoveryKey();
    expect(rk.startsWith('BSK1-')).toBe(true);
    const bytes = recoveryKeyToBytes(rk);
    expect(bytes.length).toBe(32);
  });

  it('is high entropy (distinct keys decode to distinct bytes)', () => {
    const a = recoveryKeyToBytes(generateRecoveryKey());
    const b = recoveryKeyToBytes(generateRecoveryKey());
    expect(a.equals(b)).toBe(false);
  });

  it('tolerates hand-typing: lowercase, spaces, missing prefix, ambiguous chars', () => {
    const rk = generateRecoveryKey();
    const canonical = recoveryKeyToBytes(rk);
    // strip prefix + dashes, lowercase, add stray spaces — must decode identically
    const messy = rk.replace(/^BSK1-/, '').replace(/-/g, ' ').toLowerCase();
    expect(recoveryKeyToBytes(messy).equals(canonical)).toBe(true);
  });

  it('maps ambiguous I/L/O to 1/1/0 on decode', () => {
    // '1' and 'I'/'L' must decode the same; '0' and 'O' must decode the same.
    expect(recoveryKeyToBytes('1111111111111111111111111111111111111111111111111111')
      .equals(recoveryKeyToBytes('ILIL111111111111111111111111111111111111111111111111'))).toBe(true);
  });

  it('rejects an invalid character', () => {
    expect(() => recoveryKeyToBytes('BSK1-!!!!')).toThrow(RecoveryKeyError);
  });

  it('rejects a too-short key', () => {
    expect(() => recoveryKeyToBytes('BSK1-ABCD')).toThrow(RecoveryKeyError);
  });

  it('wraps and unwraps a DEK with the recovery key (the key-hierarchy core)', () => {
    const realDek = crypto.randomBytes(32);
    const rk = generateRecoveryKey();
    const kek = recoveryKeyToBytes(rk);
    const wrapAad = syncAad('acct-1', 'account', 'dek-wrap');
    const wrapped = encryptForSync(realDek, kek, wrapAad);
    // right key unwraps to the same DEK
    expect(decryptForSync(wrapped, kek, wrapAad).equals(realDek)).toBe(true);
    // a different recovery key cannot unwrap it
    expect(() => decryptForSync(wrapped, recoveryKeyToBytes(generateRecoveryKey()), wrapAad))
      .toThrow(SyncDecryptError);
  });
});

describe('dek fingerprint', () => {
  it('is deterministic and DEK-specific', () => {
    const d = crypto.randomBytes(32);
    expect(dekFingerprint(d)).toBe(dekFingerprint(d));
    expect(dekFingerprint(d)).not.toBe(dekFingerprint(crypto.randomBytes(32)));
    expect(dekFingerprint(d)).toHaveLength(16);
  });
});

describe('member keypair + sealed DEK (multi-member E2EE)', () => {
  const accountId = 'acct-1';

  it('generates 32-byte X25519 keypairs that differ each time', () => {
    const a = generateMemberKeypair();
    const b = generateMemberKeypair();
    expect(a.pubRaw.length).toBe(32);
    expect(a.privRaw.length).toBe(32);
    expect(a.pubRaw.equals(b.pubRaw)).toBe(false);
    expect(a.privRaw.equals(b.privRaw)).toBe(false);
  });

  it('seals the DEK to a member pubkey and opens it with their privkey', () => {
    const member = generateMemberKeypair();
    const realDek = crypto.randomBytes(32);
    const aad = sealAad(accountId, 'user-member');
    const sealed = sealDek(realDek, member.pubRaw, aad);
    // sealed = ephPub(32) ‖ BSE1 envelope; not plaintext
    expect(sealed.length).toBeGreaterThan(32 + 17);
    expect(openDek(sealed, member.privRaw, aad).equals(realDek)).toBe(true);
  });

  it('produces a fresh ephemeral key per seal (same input -> different blob)', () => {
    const member = generateMemberKeypair();
    const realDek = crypto.randomBytes(32);
    const aad = sealAad(accountId, 'user-member');
    expect(sealDek(realDek, member.pubRaw, aad).equals(sealDek(realDek, member.pubRaw, aad))).toBe(
      false
    );
  });

  it('cannot be opened with the wrong private key', () => {
    const member = generateMemberKeypair();
    const intruder = generateMemberKeypair();
    const aad = sealAad(accountId, 'user-member');
    const sealed = sealDek(crypto.randomBytes(32), member.pubRaw, aad);
    expect(() => openDek(sealed, intruder.privRaw, aad)).toThrow(SyncDecryptError);
  });

  it('rejects a seal relabelled for a different recipient (AAD binds the userId)', () => {
    const member = generateMemberKeypair();
    const realDek = crypto.randomBytes(32);
    const sealed = sealDek(realDek, member.pubRaw, sealAad(accountId, 'user-A'));
    // right key, right account, but the recipient userId in the AAD differs
    expect(() => openDek(sealed, member.privRaw, sealAad(accountId, 'user-B'))).toThrow(
      SyncDecryptError
    );
  });

  it('rejects a tampered ephemeral-pubkey prefix', () => {
    const member = generateMemberKeypair();
    const aad = sealAad(accountId, 'user-member');
    const sealed = sealDek(crypto.randomBytes(32), member.pubRaw, aad);
    sealed[3] ^= 0xff; // flip a byte inside the ephemeral pubkey
    expect(() => openDek(sealed, member.privRaw, aad)).toThrow(SyncDecryptError);
  });

  it('wraps and unwraps a private key under a recovery key', () => {
    const member = generateMemberKeypair();
    const kek = recoveryKeyToBytes(generateRecoveryKey());
    const aad = privKeyWrapAad('user-member');
    const wrapped = wrapPrivateKey(member.privRaw, kek, aad);
    expect(unwrapPrivateKey(wrapped, kek, aad).equals(member.privRaw)).toBe(true);
    // wrong recovery key cannot unwrap
    expect(() =>
      unwrapPrivateKey(wrapped, recoveryKeyToBytes(generateRecoveryKey()), aad)
    ).toThrow(SyncDecryptError);
  });

  it('end-to-end: recovery key -> private key -> sealed DEK -> DEK', () => {
    // The full key hierarchy for one member, as e2ee.ts will drive it.
    const realDek = crypto.randomBytes(32);
    const member = generateMemberKeypair();
    const rk = generateRecoveryKey();
    const kek = recoveryKeyToBytes(rk);
    // owner seals the DEK to the member; member wraps their own private key
    const sealed = sealDek(realDek, member.pubRaw, sealAad(accountId, 'm'));
    const wrappedPriv = wrapPrivateKey(member.privRaw, kek, privKeyWrapAad('m'));
    // fresh device: recover privkey from recovery key, then open the DEK
    const recoveredPriv = unwrapPrivateKey(wrappedPriv, kek, privKeyWrapAad('m'));
    expect(openDek(sealed, recoveredPriv, sealAad(accountId, 'm')).equals(realDek)).toBe(true);
  });
});

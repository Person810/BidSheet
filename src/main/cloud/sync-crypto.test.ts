import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  encryptForSync,
  decryptForSync,
  isEncryptedPayload,
  syncAad,
  syncContentMac,
  fileObjectKey,
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
  normalizeRecoveryCode,
  wrapWithRecoveryCode,
  unwrapWithRecoveryCode,
  isKdfWrapped,
  ShortRecoveryKeyRetiredError,
  inviteKeyBinding,
  verifyInviteKeyBinding,
  pubkeySafetyCode,
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

describe('recovery-code wrapping', () => {
  const wrapAad = syncAad('acct-1', 'account', 'dek-wrap');

  it('generates exactly one shape: 256 bits, 52 base32 chars', () => {
    expect(normalizeRecoveryCode(generateRecoveryKey())).toHaveLength(52); // 256/5, rounded up
  });

  it('round-trips a secret through the wrap', () => {
    const realDek = crypto.randomBytes(32);
    const code = generateRecoveryKey();
    const blob = wrapWithRecoveryCode(realDek, code, wrapAad);
    expect(isKdfWrapped(blob)).toBe(false);
    expect(blob.includes(realDek)).toBe(false); // ciphertext, not the raw key
    expect(unwrapWithRecoveryCode(blob, code, wrapAad).equals(realDek)).toBe(true);
  });

  it('rejects the wrong recovery code', () => {
    const blob = wrapWithRecoveryCode(crypto.randomBytes(32), generateRecoveryKey(), wrapAad);
    expect(() => unwrapWithRecoveryCode(blob, generateRecoveryKey(), wrapAad)).toThrow(
      SyncDecryptError
    );
  });

  it('rejects an AAD mismatch (wrap moved to another account)', () => {
    const code = generateRecoveryKey();
    const blob = wrapWithRecoveryCode(crypto.randomBytes(32), code, wrapAad);
    expect(() =>
      unwrapWithRecoveryCode(blob, code, syncAad('acct-2', 'account', 'dek-wrap'))
    ).toThrow(SyncDecryptError);
  });

  it('tolerates a hand-typed code (lowercase, spaces, no prefix)', () => {
    const realDek = crypto.randomBytes(32);
    const code = generateRecoveryKey();
    const blob = wrapWithRecoveryCode(realDek, code, wrapAad);
    const messy = code.replace(/^BSK1-/, '').replace(/-/g, ' ').toLowerCase();
    expect(unwrapWithRecoveryCode(blob, messy, wrapAad).equals(realDek)).toBe(true);
  });

  // Short 80-bit keys and their scrypt (BSKD) envelope are gone. Nothing writes
  // one now, but v0.3.3 and earlier could, so a blob that does turn up has to
  // say what it is instead of reading as corrupt data — and it has to stay its
  // own error type, or e2ee.ts collapses it into "that recovery key did not
  // match" and sends the user off to re-check a key that is probably correct.
  it('reports a retired short-key (BSKD) blob distinctly, not as a bad key', () => {
    const bskd = Buffer.concat([Buffer.from('BSKD'), Buffer.alloc(64, 7)]);
    expect(isKdfWrapped(bskd)).toBe(true);
    const attempt = () => unwrapWithRecoveryCode(bskd, generateRecoveryKey(), wrapAad);
    expect(attempt).toThrow(ShortRecoveryKeyRetiredError);
    expect(attempt).toThrow(/short recovery key/i);
  });
});

describe('invite key binding (stops a server swapping in its own member key)', () => {
  const token = 'Oqbo7isD7dAiyBbpOUIQyZcGqMQuW_xw';

  it('round-trips for the key the invite holder generated', () => {
    const { pubRaw } = generateMemberKeypair();
    expect(verifyInviteKeyBinding(token, pubRaw, inviteKeyBinding(token, pubRaw))).toBe(true);
  });

  // The attack this exists for: the server hands the approving owner its OWN
  // public key instead of the joiner's, so the DEK gets sealed to a key the
  // server can open. The binding was made by the joiner over THEIR key, so it
  // cannot validate the substitute.
  it('fails when the server substitutes a different public key', () => {
    const joiner = generateMemberKeypair();
    const attacker = generateMemberKeypair();
    const binding = inviteKeyBinding(token, joiner.pubRaw);
    expect(verifyInviteKeyBinding(token, joiner.pubRaw, binding)).toBe(true);
    expect(verifyInviteKeyBinding(token, attacker.pubRaw, binding)).toBe(false);
  });

  it('fails for a different invite token (the key the server does not hold)', () => {
    const { pubRaw } = generateMemberKeypair();
    const binding = inviteKeyBinding(token, pubRaw);
    expect(verifyInviteKeyBinding('a-different-token', pubRaw, binding)).toBe(false);
  });

  it('is a 64-char hex digest and hides the token', () => {
    const { pubRaw } = generateMemberKeypair();
    const binding = inviteKeyBinding(token, pubRaw);
    expect(binding).toMatch(/^[0-9a-f]{64}$/);
    expect(binding).not.toContain(token);
  });

  it('tolerates surrounding whitespace on a pasted token', () => {
    const { pubRaw } = generateMemberKeypair();
    expect(inviteKeyBinding(`  ${token}\n`, pubRaw)).toBe(inviteKeyBinding(token, pubRaw));
  });

  it('is domain-separated from the other MACs over the same key bytes', () => {
    const { pubRaw } = generateMemberKeypair();
    expect(inviteKeyBinding(token, pubRaw)).not.toBe(syncContentMac(pubRaw, Buffer.from(token.padEnd(32, '0').slice(0, 32))));
    expect(inviteKeyBinding(token, pubRaw)).not.toContain(pubkeySafetyCode(pubRaw).replace(/-/g, '').toLowerCase());
  });

  // timingSafeEqual throws on a length mismatch, so a truncated binding from a
  // hostile server must fail the check rather than crash the approval.
  it('returns false (never throws) on a malformed stored binding', () => {
    const { pubRaw } = generateMemberKeypair();
    for (const bad of ['', 'abc', 'z'.repeat(64), 'a'.repeat(128)]) {
      expect(() => verifyInviteKeyBinding(token, pubRaw, bad)).not.toThrow();
      expect(verifyInviteKeyBinding(token, pubRaw, bad)).toBe(false);
    }
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

describe('file object keys', () => {
  const dek = crypto.randomBytes(32);
  const other = crypto.randomBytes(32);

  it('is deterministic, so both sides derive the same key without storing one', () => {
    expect(fileObjectKey(dek, 'job-1', 'plan:Site Plan.pdf'))
      .toBe(fileObjectKey(dek, 'job-1', 'plan:Site Plan.pdf'));
  });

  it('fits the opaque id the server accepts', () => {
    expect(fileObjectKey(dek, 'job-1', 'job')).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('leaks nothing about the file: a rename is unrecognisable', () => {
    const before = fileObjectKey(dek, 'job-1', 'plan:Smith-WaterMain.pdf');
    const after = fileObjectKey(dek, 'job-1', 'plan:Smith-WaterMain-Rev2.pdf');
    expect(after).not.toBe(before);
    expect(after).not.toContain('Smith');
  });

  it('gives every kind of file the same shape', () => {
    const ids = ['job', 'markup', 'plan:a.pdf'].map((n) => fileObjectKey(dek, 'job-1', n));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toHaveLength(22);
  });

  it('separates jobs and accounts: same name, different key', () => {
    expect(fileObjectKey(dek, 'job-1', 'markup')).not.toBe(fileObjectKey(dek, 'job-2', 'markup'));
    expect(fileObjectKey(dek, 'job-1', 'markup')).not.toBe(fileObjectKey(other, 'job-1', 'markup'));
  });
});

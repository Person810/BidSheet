import { describe, it, expect } from 'vitest';
import {
  decryptForSync,
  unwrapWithRecoveryCode,
  openDek,
  syncAad,
  sealAad,
  privKeyWrapAad,
  dekFingerprint,
  syncContentMac,
  fileObjectKey,
  isKdfWrapped,
  recoveryKeyToBytes,
  SyncDecryptError,
} from './sync-crypto';

/**
 * GOLDEN VECTORS — DO NOT EDIT THE CONSTANTS BELOW.
 *
 * These are real ciphertexts produced by a known-good build, paired with the
 * exact recovery codes/keys that must keep decrypting them forever. Every value
 * a user has stored in the cloud is wrapped by one of these code paths, and a
 * zero-knowledge system has no recovery if a future refactor silently changes
 * the encoding, the scrypt parameters/layout, the AAD, or the envelope format.
 *
 * The ordinary round-trip tests (sync-crypto.test.ts) would NOT catch such a
 * regression — they encrypt and decrypt with the same changed code. These do:
 * if any of these fail, a change has broken backward-compatible decryption and
 * MUST NOT ship. If you are intentionally introducing a new format, ADD new
 * vectors; never modify or delete the old ones.
 *
 * To add vectors for a new format, regenerate with _golden-gen.test.ts (kept in
 * git history) and append — leaving these intact.
 */

const V = {
  accountId: 'acct-golden-0001',
  userId: 'user-golden-0001',
  dekHex: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  plaintextUtf8: '{"job":"Golden Bid","total":4242}',
  fullCode: 'BSK1-5YWJ-BWTP-8224-D518-HX4G-GVWQ-WPM1-CV2T-R8SB-TW4T-VAFT-FJYS-22J0',
  shortCode: 'BSK1-ER21-YXDY-6HYW-YPT5',
  memberPrivHex: 'd844878b74db9880e95670d1e1ed643e1e69ab2aed1d35af15c531393c527e5f',
  wrappedDekDirectB64:
    'QlNFMQHQFRlJ5rEpaRoXoTrNBvB6FcC/8XKJr8CehYT2VJ8Dy88ycPkmo6zSVc2HUANK7JVrxQ2F5d1VXsdNqb4=',
  wrappedDekScryptB64:
    'QlNLRAERCAHgJy96izC5hc9cwH7Fxqk+QlNFMQEd+QjmwC4SDbWhRrsu4O8I1pGWQPJ3a/NPlrnflgbz2onIdIDUDf8T4vfS1gTXeLBwTvywPTX9+4reibE=',
  wrappedPrivScryptB64:
    'QlNLRAERCAFxFj0A2Zk4V+7NlIDzacVdQlNFMQHkGdZx/3bDN3CxVDQGRRYZBrjUYKima4KykoVSb+HOUF7IH9058Qh3QlfqeUKzU968jmAbS75GuFX52SE=',
  jobBlobB64: 'QlNFMQH2/6GAExArxeWDobJrC/DH4HMauvqgMvBUCk0s0tx8dRTzbKK+Tmp7eeQzb92tu2kenoDKk+05IR20aBiy',
  sealedDekB64:
    'f3C7EiCQk+fRCskquV3B+ZcWxCwB1FFG5ET2+8I8ekxCU0UxAW4j53B92S2N9USMNombtxxmn/lih23+NrJD36Ijl8NZTsedzgu1N1tbRyQH+sSB7qaSnTtze1syjvqvuQ==',
  fingerprint: 'c6c93e1a603b47b5',
  contentMac: '4106d779fdd8b7e4c77d88291cc7df281644a85bcbe43c91025eb6c98a71e0a4',
} as const;

const dek = Buffer.from(V.dekHex, 'hex');
const memberPriv = Buffer.from(V.memberPrivHex, 'hex');
const plaintext = Buffer.from(V.plaintextUtf8, 'utf8');
const wrapAad = syncAad(V.accountId, 'account', 'dek-wrap');
const jobAad = syncAad(V.accountId, 'job-1', 'job');
const pkAad = privKeyWrapAad(V.userId);
const sealAd = sealAad(V.accountId, V.userId);

describe('golden: AAD strings are byte-for-byte frozen', () => {
  // The AAD is reconstructed on every decrypt; changing it silently breaks
  // every stored ciphertext. Pin the exact bytes (NUL-separated) so a change is
  // caught here with a clear message, not as a confusing decrypt failure.
  it('syncAad (account dek-wrap)', () => {
    expect(wrapAad.toString('utf8')).toBe('BSE1\x00acct-golden-0001\x00account\x00dek-wrap\x001');
  });
  it('syncAad (per-job)', () => {
    expect(jobAad.toString('utf8')).toBe('BSE1\x00acct-golden-0001\x00job-1\x00job\x001');
  });
  it('sealAad (DEK sealed to a member)', () => {
    expect(sealAd.toString('utf8')).toBe(
      'BSE1\x00acct-golden-0001\x00account\x00dek-seal:user-golden-0001\x001'
    );
  });
  it('privKeyWrapAad (member private-key wrap)', () => {
    expect(pkAad.toString('utf8')).toBe('BSE1\x00user-golden-0001\x00member\x00privkey-wrap\x001');
  });
});

describe('golden: stored ciphertext must always decrypt', () => {
  it('BSE1 direct DEK wrap unlocks with the full (256-bit) recovery key', async () => {
    const blob = Buffer.from(V.wrappedDekDirectB64, 'base64');
    expect(isKdfWrapped(blob)).toBe(false); // legacy direct path
    const out = await unwrapWithRecoveryCode(blob, V.fullCode, wrapAad);
    expect(out.equals(dek)).toBe(true);
  });

  it('BSKD scrypt DEK wrap unlocks with the short (80-bit) recovery key', async () => {
    const blob = Buffer.from(V.wrappedDekScryptB64, 'base64');
    expect(isKdfWrapped(blob)).toBe(true); // scrypt path
    const out = await unwrapWithRecoveryCode(blob, V.shortCode, wrapAad);
    expect(out.equals(dek)).toBe(true);
  });

  it('BSKD scrypt private-key wrap unlocks with the short recovery key', async () => {
    const blob = Buffer.from(V.wrappedPrivScryptB64, 'base64');
    const out = await unwrapWithRecoveryCode(blob, V.shortCode, pkAad);
    expect(out.equals(memberPriv)).toBe(true);
  });

  it('BSE1 job payload decrypts with the DEK', () => {
    const out = decryptForSync(Buffer.from(V.jobBlobB64, 'base64'), dek, jobAad);
    expect(out.equals(plaintext)).toBe(true);
  });

  it('sealed DEK opens with the member private key', () => {
    const out = openDek(Buffer.from(V.sealedDekB64, 'base64'), memberPriv, sealAd);
    expect(out.equals(dek)).toBe(true);
  });

  it('dekFingerprint and syncContentMac are stable', () => {
    expect(dekFingerprint(dek)).toBe(V.fingerprint);
    expect(syncContentMac(plaintext, dek)).toBe(V.contentMac);
  });
});

describe('golden: recovery-code robustness against the stored blobs', () => {
  it('the full code still decodes to its exact 32 key bytes', () => {
    // Pins the base32 alphabet + decode against a real stored direct wrap below.
    expect(recoveryKeyToBytes(V.fullCode).length).toBe(32);
  });

  it('tolerates a hand-typed short code (lowercase, spaces, no prefix)', async () => {
    const messy = V.shortCode.replace(/^BSK1-/, '').replace(/-/g, ' ').toLowerCase();
    const out = await unwrapWithRecoveryCode(Buffer.from(V.wrappedDekScryptB64, 'base64'), messy, wrapAad);
    expect(out.equals(dek)).toBe(true);
  });

  it('rejects the wrong recovery code on the scrypt blob', async () => {
    await expect(
      unwrapWithRecoveryCode(Buffer.from(V.wrappedDekScryptB64, 'base64'), 'BSK1-AAAA-AAAA-AAAA-AAAA', wrapAad)
    ).rejects.toThrow(SyncDecryptError);
  });

  it('rejects a scrypt blob under the wrong AAD (moved to another account)', async () => {
    const otherAcct = syncAad('acct-other', 'account', 'dek-wrap');
    await expect(
      unwrapWithRecoveryCode(Buffer.from(V.wrappedDekScryptB64, 'base64'), V.shortCode, otherAcct)
    ).rejects.toThrow(SyncDecryptError);
  });
});

/**
 * Object ids are how a client finds its own files: the key is derived, never
 * stored. Desktop and iOS must derive identically forever — a drift here
 * doesn't fail loudly, it makes a phone quietly unable to find a plan set the
 * desktop uploaded (and vice versa). Vectors below are frozen; the iOS suite
 * (BidSheetFieldTests/SyncCryptoGoldenTests.swift) asserts the same strings.
 */
describe('golden: file object keys are frozen across platforms', () => {
  const dek = Buffer.from(V.dekHex, 'hex');
  const jobId = 'job-golden-1';

  it('derives the frozen ids for each kind of file', () => {
    expect(fileObjectKey(dek, jobId, 'job')).toBe('Sca7cpe4ro3kKaCTJmWD5e');
    expect(fileObjectKey(dek, jobId, 'markup')).toBe('w4aj708OzoB8AzHY5ti4mG');
    expect(fileObjectKey(dek, jobId, 'plan:Site Plan.pdf')).toBe('5GsOGOfL9P99VRkW9ynR5I');
    expect(fileObjectKey(dek, jobId, 'photo:11111111-2222-3333-4444-555555555555'))
      .toBe('82-zHPodMA1UiwvE-h96OX');
  });
});

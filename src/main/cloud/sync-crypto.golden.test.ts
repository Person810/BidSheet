import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
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
  ShortRecoveryKeyRetiredError,
  inviteKeyBinding,
  verifyInviteKeyBinding,
} from './sync-crypto';

/**
 * GOLDEN VECTORS — DO NOT EDIT THE CONSTANTS BELOW.
 *
 * These are real ciphertexts produced by a known-good build, paired with the
 * exact recovery codes/keys that must keep decrypting them forever. Every value
 * a user has stored in the cloud is wrapped by one of these code paths, and a
 * zero-knowledge system has no recovery if a future refactor silently changes
 * the encoding, the AAD, or the envelope format.
 *
 * The ordinary round-trip tests (sync-crypto.test.ts) would NOT catch such a
 * regression — they encrypt and decrypt with the same changed code. These do:
 * if any of these fail, a change has broken backward-compatible decryption and
 * MUST NOT ship. If you are intentionally introducing a new format, ADD new
 * vectors; never modify or delete the old ones.
 *
 * To add vectors for a new format, regenerate with _golden-gen.test.ts (kept in
 * git history) and append — leaving these intact.
 *
 * ONE DELIBERATE REDUCTION, 2026-07-26. Short 80-bit recovery keys and their
 * scrypt (BSKD) envelope were removed from the product; the vectors that
 * asserted a BSKD blob *decrypts* are gone with them, because no code can
 * decrypt one any more. This was safe to do exactly once: production held zero
 * e2ee_keys rows, so no stored BSKD blob existed anywhere. wrappedDekScryptB64
 * is kept, now as a *detection* vector — it pins the promise that such a blob
 * is still recognised and reported accurately rather than read as corruption.
 * Every other vector below is untouched, byte for byte. This note exists so the
 * reduction reads as a decision and not as someone quietly "fixing" a failure.
 */

const V = {
  accountId: 'acct-golden-0001',
  userId: 'user-golden-0001',
  dekHex: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  plaintextUtf8: '{"job":"Golden Bid","total":4242}',
  fullCode: 'BSK1-5YWJ-BWTP-8224-D518-HX4G-GVWQ-WPM1-CV2T-R8SB-TW4T-VAFT-FJYS-22J0',
  memberPrivHex: 'd844878b74db9880e95670d1e1ed643e1e69ab2aed1d35af15c531393c527e5f',
  wrappedDekDirectB64:
    'QlNFMQHQFRlJ5rEpaRoXoTrNBvB6FcC/8XKJr8CehYT2VJ8Dy88ycPkmo6zSVc2HUANK7JVrxQ2F5d1VXsdNqb4=',
  // Retired format. A real BSKD blob from a build that still had scrypt; kept
  // only to pin that we still recognise one. It is no longer decryptable here.
  wrappedDekScryptB64:
    'QlNLRAERCAHgJy96izC5hc9cwH7Fxqk+QlNFMQEd+QjmwC4SDbWhRrsu4O8I1pGWQPJ3a/NPlrnflgbz2onIdIDUDf8T4vfS1gTXeLBwTvywPTX9+4reibE=',
  jobBlobB64: 'QlNFMQH2/6GAExArxeWDobJrC/DH4HMauvqgMvBUCk0s0tx8dRTzbKK+Tmp7eeQzb92tu2kenoDKk+05IR20aBiy',
  sealedDekB64:
    'f3C7EiCQk+fRCskquV3B+ZcWxCwB1FFG5ET2+8I8ekxCU0UxAW4j53B92S2N9USMNombtxxmn/lih23+NrJD36Ijl8NZTsedzgu1N1tbRyQH+sSB7qaSnTtze1syjvqvuQ==',
  fingerprint: 'c6c93e1a603b47b5',
  contentMac: '4106d779fdd8b7e4c77d88291cc7df281644a85bcbe43c91025eb6c98a71e0a4',
  // Invite key binding (orgs #5). Frozen from the moment it shipped: an owner
  // recomputes this at approval over a pubkey the *server* handed back, so a
  // change to the prefix, the encoding, or the key would make every stored
  // binding mismatch — which presents to owners as "the server swapped this
  // person's key", the single most alarming message the app can produce.
  inviteToken: 'BSKI-golden-invite-token-0001',
  memberPubB64: 'tW6mUsPp0//QltPVXA460eCtFbbCi/TuvsUmUXj7oFs=',
  inviteKeyBindingHex: 'bd6e093a45f739436a3f2888df74085247892bfddec116d93b8952375d5324ad',
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
  it('BSE1 DEK wrap unlocks with the (256-bit) recovery key', () => {
    const blob = Buffer.from(V.wrappedDekDirectB64, 'base64');
    expect(isKdfWrapped(blob)).toBe(false);
    expect(unwrapWithRecoveryCode(blob, V.fullCode, wrapAad).equals(dek)).toBe(true);
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

  it('inviteKeyBinding is stable for a known token + member key', () => {
    const pubRaw = Buffer.from(V.memberPubB64, 'base64');
    expect(inviteKeyBinding(V.inviteToken, pubRaw)).toBe(V.inviteKeyBindingHex);
    expect(verifyInviteKeyBinding(V.inviteToken, pubRaw, V.inviteKeyBindingHex)).toBe(true);
  });

  it('the pinned member public key really is the pinned private key', () => {
    // Guards the vector above against being regenerated from a mismatched pair.
    const derived = crypto.createPublicKey(
      crypto.createPrivateKey({
        key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), memberPriv]),
        format: 'der',
        type: 'pkcs8',
      })
    ).export({ format: 'der', type: 'spki' });
    expect(Buffer.from(derived.subarray(derived.length - 32)).toString('base64')).toBe(V.memberPubB64);
  });
});

describe('golden: recovery-code robustness against the stored blobs', () => {
  const stored = () => Buffer.from(V.wrappedDekDirectB64, 'base64');

  it('the full code still decodes to its exact 32 key bytes', () => {
    // Pins the base32 alphabet + decode against a real stored wrap below.
    expect(recoveryKeyToBytes(V.fullCode).length).toBe(32);
  });

  it('tolerates a hand-typed code (lowercase, spaces, no prefix)', () => {
    const messy = V.fullCode.replace(/^BSK1-/, '').replace(/-/g, ' ').toLowerCase();
    expect(unwrapWithRecoveryCode(stored(), messy, wrapAad).equals(dek)).toBe(true);
  });

  it('rejects the wrong recovery code on a stored wrap', () => {
    const wrong = 'BSK1-' + 'AAAA-'.repeat(12) + 'AAAA';
    expect(() => unwrapWithRecoveryCode(stored(), wrong, wrapAad)).toThrow(SyncDecryptError);
  });

  it('rejects a stored wrap under the wrong AAD (moved to another account)', () => {
    const otherAcct = syncAad('acct-other', 'account', 'dek-wrap');
    expect(() => unwrapWithRecoveryCode(stored(), V.fullCode, otherAcct)).toThrow(SyncDecryptError);
  });

  // The retired short-key format. v0.3.3 and earlier could write one of these;
  // this build cannot open it, so what it owes the user is an accurate reason.
  it('still recognises a retired BSKD blob and says so plainly', () => {
    const blob = Buffer.from(V.wrappedDekScryptB64, 'base64');
    expect(isKdfWrapped(blob)).toBe(true);
    const attempt = () => unwrapWithRecoveryCode(blob, V.fullCode, wrapAad);
    expect(attempt).toThrow(ShortRecoveryKeyRetiredError);
    expect(attempt).toThrow(/short recovery key/i);
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

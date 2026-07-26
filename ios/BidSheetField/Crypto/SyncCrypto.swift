/**
 * End-to-end encryption for cloud sync payloads — the Swift port of the
 * desktop's src/main/cloud/sync-crypto.ts. THE WIRE FORMATS ARE FROZEN and
 * must interop byte-for-byte with the desktop; SyncCryptoGoldenTests pins
 * this implementation against the same golden vectors the desktop uses
 * (sync-crypto.golden.test.ts). If a golden test fails, this file is wrong —
 * never "fix" a vector.
 *
 * BSE1 blob layout (all lengths fixed except the ciphertext):
 *
 *   magic "BSE1" (4) | format version (1) | iv (12) | ciphertext (n)
 *   | GCM auth tag (16)
 *
 * The AAD is NOT stored in the blob; it is reconstructed from the request
 * context on decrypt, so a ciphertext moved to a different account/job/
 * payload-type fails the auth tag.
 *
 * Retired format: the BSKD (scrypt) envelope that carried *short* 80-bit
 * recovery keys. It was never ported here — CryptoKit has no scrypt, and a
 * 128 MiB KDF working set is not something a phone should carry — and as of
 * 2026-07-26 the desktop dropped it too, so one recovery-key shape now exists
 * everywhere. Blobs written by desktop v0.3.3 or earlier are still detected
 * and reported accurately (SyncCryptoError.shortRecoveryKeyRetired) rather
 * than surfacing as corrupt data.
 */

import CryptoKit
import Foundation

enum SyncCryptoError: LocalizedError {
    case notEncryptedPayload
    case unsupportedFormatVersion(Int)
    case decryptFailed
    case invalidRecoveryKey
    case shortRecoveryKeyRetired
    case badKeyLength

    var errorDescription: String? {
        switch self {
        case .notEncryptedPayload:
            return "This is not BidSheet encrypted cloud data."
        case .unsupportedFormatVersion(let v):
            return "This cloud data uses format v\(v), which this version of the app doesn't understand. Update the app and try again."
        case .decryptFailed:
            return "Could not decrypt cloud data — wrong key, wrong context, or the data is damaged."
        case .invalidRecoveryKey:
            return "That doesn't look like a valid recovery key. Check it and try again."
        case .shortRecoveryKeyRetired:
            return "This account was set up with a short recovery key, which BidSheet no longer supports. On a computer where encrypted sync is still unlocked, open Settings → Cloud Sync and generate a new recovery key — that replaces the old one for every device, including this one."
        case .badKeyLength:
            return "Encryption key has the wrong length."
        }
    }
}

enum SyncCrypto {
    static let magic = Data("BSE1".utf8)
    static let kdfMagic = Data("BSKD".utf8)
    private static let formatVersion: UInt8 = 1
    private static let ivLength = 12
    private static let tagLength = 16
    private static let keyLength = 32
    private static let headerLength = 4 + 1 + 12

    // Bumped only if the AAD construction itself changes (mirrors desktop).
    private static let aadVersion = "1"

    // MARK: - AAD construction

    /// The additional-authenticated-data bytes that bind a ciphertext to its
    /// place. `scope` is the cloud job id for per-job payloads or the literal
    /// "account" for account-wide blobs.
    static func syncAad(accountId: String, scope: String, payloadType: String) -> Data {
        Data("BSE1\0\(accountId)\0\(scope)\0\(payloadType)\0\(aadVersion)".utf8)
    }

    /// AAD binding a sealed DEK to the account and the recipient member.
    static func sealAad(accountId: String, recipientUserId: String) -> Data {
        syncAad(accountId: accountId, scope: "account", payloadType: "dek-seal:\(recipientUserId)")
    }

    /// AAD binding a wrapped member private key to its owner (userId only —
    /// the wrap can be created before the member has an account).
    static func privKeyWrapAad(userId: String) -> Data {
        syncAad(accountId: userId, scope: "member", payloadType: "privkey-wrap")
    }

    // MARK: - BSE1 envelope

    /// True if a blob is a BSE1 payload (vs. legacy plaintext JSON).
    static func isEncryptedPayload(_ blob: Data) -> Bool {
        blob.count >= magic.count && blob.prefix(magic.count) == magic
    }

    /// True if a wrapped blob is the retired scrypt (BSKD) short-recovery-key
    /// form. Detection only — no build can open one any more.
    static func isKdfWrapped(_ blob: Data) -> Bool {
        blob.count >= kdfMagic.count && blob.prefix(kdfMagic.count) == kdfMagic
    }

    static func encryptForSync(_ plaintext: Data, dek: Data, aad: Data) throws -> Data {
        guard dek.count == keyLength else { throw SyncCryptoError.badKeyLength }
        var iv = Data(count: ivLength)
        let status = iv.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, ivLength, $0.baseAddress!) }
        guard status == errSecSuccess else { throw SyncCryptoError.decryptFailed }
        let nonce = try AES.GCM.Nonce(data: iv)
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: dek), nonce: nonce, authenticating: aad)
        return magic + Data([formatVersion]) + iv + box.ciphertext + box.tag
    }

    static func decryptForSync(_ blob: Data, dek: Data, aad: Data) throws -> Data {
        guard dek.count == keyLength else { throw SyncCryptoError.badKeyLength }
        try parseHeader(blob)
        // Data subscripting keeps the parent's indices; re-wrap slices so all
        // offsets below are zero-based.
        let b = Data(blob)
        let iv = b.subdata(in: (headerLength - ivLength)..<headerLength)
        let ciphertext = b.subdata(in: headerLength..<(b.count - tagLength))
        let tag = b.subdata(in: (b.count - tagLength)..<b.count)
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ciphertext, tag: tag)
            return try AES.GCM.open(box, using: SymmetricKey(data: dek), authenticating: aad)
        } catch {
            throw SyncCryptoError.decryptFailed
        }
    }

    private static func parseHeader(_ blob: Data) throws {
        guard blob.count >= headerLength + tagLength, isEncryptedPayload(blob) else {
            throw SyncCryptoError.notEncryptedPayload
        }
        let version = blob[blob.startIndex + magic.count]
        guard version == formatVersion else {
            throw SyncCryptoError.unsupportedFormatVersion(Int(version))
        }
    }

    // MARK: - integrity helpers

    /// Short, non-invertible fingerprint of the DEK (mismatch detection).
    static func dekFingerprint(_ dek: Data) -> String {
        let digest = SHA256.hash(data: Data("BSE1-fp\0".utf8) + dek)
        return digest.map { String(format: "%02x", $0) }.joined().prefix(16).lowercased()
    }

    /// The DEK-keyed content HMAC sent to the cloud for change detection.
    static func syncContentMac(_ plaintext: Data, dek: Data) -> String {
        let mac = HMAC<SHA256>.authenticationCode(for: plaintext, using: SymmetricKey(data: dek))
        return mac.map { String(format: "%02x", $0) }.joined()
    }

    /// The object id a file gets in the cloud: `accountId/jobId/<this>`.
    ///
    /// Keys used to end in the real filename, which put client and project
    /// names in plaintext object keys. This is an HMAC of the file's logical
    /// name under the DEK: the desktop derives the same id from the same name
    /// (`fileObjectKey` in src/main/cloud/sync-crypto.ts), and every kind of
    /// file — plan, photo, markup, snapshot — comes out the same shape, so the
    /// server can't tell them apart either.
    static func fileObjectKey(dek: Data, jobId: String, logicalName: String) -> String {
        let mac = HMAC<SHA256>.authenticationCode(
            for: Data("file:\(jobId):\(logicalName)".utf8),
            using: SymmetricKey(data: dek)
        )
        // base64url, unpadded — the same alphabet Node's digest('base64url')
        // produces, so the two implementations agree character for character.
        let encoded = Data(mac).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return String(encoded.prefix(22))
    }

    // MARK: - recovery key (Crockford base32, "BSK1-XXXX-…")

    private static let crockford = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    private static let recoveryKeyBytes = 32

    /// Canonicalize a (possibly hand-typed) recovery code exactly as the
    /// desktop does: upper-case, drop prefix/spaces/dashes, map I/L→1, O→0.
    static func normalizeRecoveryCode(_ raw: String) -> String {
        var s = raw.uppercased()
        if s.hasPrefix("BSK1-") { s.removeFirst(5) } else if s.hasPrefix("BSK1") { s.removeFirst(4) }
        s = s.filter { !$0.isWhitespace && $0 != "-" }
        s = s.replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "L", with: "1")
            .replacingOccurrences(of: "O", with: "0")
        return s
    }

    /// Decode a full (256-bit) recovery key to its 32 raw key bytes.
    static func recoveryKeyToBytes(_ raw: String) throws -> Data {
        let decoded = try base32Decode(normalizeRecoveryCode(raw))
        guard decoded.count >= recoveryKeyBytes else { throw SyncCryptoError.invalidRecoveryKey }
        return decoded.prefix(recoveryKeyBytes)
    }

    /// Reverse the desktop's wrapWithRecoveryCode. There is only one key shape
    /// now; a retired BSKD (short-key scrypt) blob is detected and rejected
    /// with an explanation that points at the way out.
    static func unwrapWithRecoveryCode(_ blob: Data, code: String, aad: Data) throws -> Data {
        if isKdfWrapped(blob) { throw SyncCryptoError.shortRecoveryKeyRetired }
        return try decryptForSync(blob, dek: recoveryKeyToBytes(code), aad: aad)
    }

    private static func base32Decode(_ s: String) throws -> Data {
        var bits = 0
        var value = 0
        var out = Data()
        for ch in s {
            guard let idx = crockford.firstIndex(of: ch) else { throw SyncCryptoError.invalidRecoveryKey }
            value = (value << 5) | idx
            bits += 5
            if bits >= 8 {
                out.append(UInt8((value >> (bits - 8)) & 0xff))
                bits -= 8
            }
        }
        return out
    }

    // MARK: - asymmetric key unwrap (multi-member E2EE)

    private static let sealInfo = Data("BSE1-seal\0".utf8)

    /// Open a DEK sealed to my X25519 public key. Blob = ephPub(32) ‖ BSE1(dek);
    /// the wrapping key is HKDF-SHA256 over the ECDH shared secret with both
    /// public keys bound into `info` (mirrors desktop sealDek/openDek).
    static func openDek(_ blob: Data, myPrivRaw: Data, aad: Data) throws -> Data {
        guard blob.count >= 32 + headerLength + tagLength else { throw SyncCryptoError.decryptFailed }
        let b = Data(blob)
        let ephPubRaw = b.subdata(in: 0..<32)
        let wrapped = b.subdata(in: 32..<b.count)
        do {
            let myPriv = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: myPrivRaw)
            let ephPub = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephPubRaw)
            let shared = try myPriv.sharedSecretFromKeyAgreement(with: ephPub)
            let info = sealInfo + ephPubRaw + myPriv.publicKey.rawRepresentation
            let wrapKey = shared.hkdfDerivedSymmetricKey(
                using: SHA256.self, salt: Data(), sharedInfo: info, outputByteCount: 32)
            let wrapKeyData = wrapKey.withUnsafeBytes { Data($0) }
            return try decryptForSync(wrapped, dek: wrapKeyData, aad: aad)
        } catch let e as SyncCryptoError {
            throw e
        } catch {
            throw SyncCryptoError.decryptFailed
        }
    }

    /// Recover a member's raw private key from its recovery-key wrap.
    static func unwrapPrivateKey(_ blob: Data, code: String, userId: String) throws -> Data {
        let priv = try unwrapWithRecoveryCode(blob, code: code, aad: privKeyWrapAad(userId: userId))
        guard priv.count == keyLength else { throw SyncCryptoError.decryptFailed }
        return priv
    }
}

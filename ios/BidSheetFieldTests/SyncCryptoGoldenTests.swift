/**
 * GOLDEN VECTORS — the exact constants from the desktop's
 * src/main/cloud/sync-crypto.golden.test.ts. DO NOT EDIT THE CONSTANTS.
 *
 * These are real ciphertexts produced by a known-good desktop build. If the
 * Swift port can decrypt every one of them, it interops byte-for-byte with
 * what users already have stored in the cloud. If any of these fail, the
 * Swift code is wrong — never "fix" a vector. (The BSKD/scrypt vectors are
 * intentionally covered only as detect-and-reject until scrypt lands.)
 *
 * Run on your Mac: open the generated Xcode project → Cmd-U.
 */

import XCTest
@testable import BidSheetField

final class SyncCryptoGoldenTests: XCTestCase {
    // From sync-crypto.golden.test.ts (frozen)
    let accountId = "acct-golden-0001"
    let userId = "user-golden-0001"
    let dek = Data(hex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff")
    let plaintext = Data(#"{"job":"Golden Bid","total":4242}"#.utf8)
    let fullCode = "BSK1-5YWJ-BWTP-8224-D518-HX4G-GVWQ-WPM1-CV2T-R8SB-TW4T-VAFT-FJYS-22J0"
    let memberPriv = Data(hex: "d844878b74db9880e95670d1e1ed643e1e69ab2aed1d35af15c531393c527e5f")
    let wrappedDekDirectB64 =
        "QlNFMQHQFRlJ5rEpaRoXoTrNBvB6FcC/8XKJr8CehYT2VJ8Dy88ycPkmo6zSVc2HUANK7JVrxQ2F5d1VXsdNqb4="
    let wrappedDekScryptB64 =
        "QlNLRAERCAHgJy96izC5hc9cwH7Fxqk+QlNFMQEd+QjmwC4SDbWhRrsu4O8I1pGWQPJ3a/NPlrnflgbz2onIdIDUDf8T4vfS1gTXeLBwTvywPTX9+4reibE="
    let jobBlobB64 = "QlNFMQH2/6GAExArxeWDobJrC/DH4HMauvqgMvBUCk0s0tx8dRTzbKK+Tmp7eeQzb92tu2kenoDKk+05IR20aBiy"
    let sealedDekB64 =
        "f3C7EiCQk+fRCskquV3B+ZcWxCwB1FFG5ET2+8I8ekxCU0UxAW4j53B92S2N9USMNombtxxmn/lih23+NrJD36Ijl8NZTsedzgu1N1tbRyQH+sSB7qaSnTtze1syjvqvuQ=="
    let fingerprint = "c6c93e1a603b47b5"
    let contentMac = "4106d779fdd8b7e4c77d88291cc7df281644a85bcbe43c91025eb6c98a71e0a4"

    var wrapAad: Data { SyncCrypto.syncAad(accountId: accountId, scope: "account", payloadType: "dek-wrap") }
    var jobAad: Data { SyncCrypto.syncAad(accountId: accountId, scope: "job-1", payloadType: "job") }

    // MARK: - AAD strings are byte-for-byte frozen

    func testSyncAadAccountDekWrap() {
        XCTAssertEqual(String(data: wrapAad, encoding: .utf8),
                       "BSE1\0acct-golden-0001\0account\0dek-wrap\01")
    }

    func testSyncAadPerJob() {
        XCTAssertEqual(String(data: jobAad, encoding: .utf8),
                       "BSE1\0acct-golden-0001\0job-1\0job\01")
    }

    func testSealAad() {
        XCTAssertEqual(
            String(data: SyncCrypto.sealAad(accountId: accountId, recipientUserId: userId), encoding: .utf8),
            "BSE1\0acct-golden-0001\0account\0dek-seal:user-golden-0001\01")
    }

    func testPrivKeyWrapAad() {
        XCTAssertEqual(
            String(data: SyncCrypto.privKeyWrapAad(userId: userId), encoding: .utf8),
            "BSE1\0user-golden-0001\0member\0privkey-wrap\01")
    }

    // MARK: - stored ciphertext must always decrypt

    func testDirectDekWrapUnlocksWithFullRecoveryKey() throws {
        let blob = Data(base64Encoded: wrappedDekDirectB64)!
        XCTAssertFalse(SyncCrypto.isKdfWrapped(blob))
        let out = try SyncCrypto.unwrapWithRecoveryCode(blob, code: fullCode, aad: wrapAad)
        XCTAssertEqual(out, dek)
    }

    func testJobPayloadDecryptsWithDek() throws {
        let out = try SyncCrypto.decryptForSync(Data(base64Encoded: jobBlobB64)!, dek: dek, aad: jobAad)
        XCTAssertEqual(out, plaintext)
    }

    func testSealedDekOpensWithMemberPrivateKey() throws {
        let out = try SyncCrypto.openDek(
            Data(base64Encoded: sealedDekB64)!,
            myPrivRaw: memberPriv,
            aad: SyncCrypto.sealAad(accountId: accountId, recipientUserId: userId))
        XCTAssertEqual(out, dek)
    }

    func testFingerprintAndContentMacAreStable() {
        XCTAssertEqual(SyncCrypto.dekFingerprint(dek), fingerprint)
        XCTAssertEqual(SyncCrypto.syncContentMac(plaintext, dek: dek), contentMac)
    }

    // MARK: - recovery-code robustness

    func testFullCodeDecodesToExactly32Bytes() throws {
        XCTAssertEqual(try SyncCrypto.recoveryKeyToBytes(fullCode).count, 32)
    }

    func testToleratesHandTypedFullCode() throws {
        // lowercase, no prefix, spaces for dashes — must still unlock.
        let messy = fullCode.replacingOccurrences(of: "BSK1-", with: "")
            .replacingOccurrences(of: "-", with: " ").lowercased()
        let out = try SyncCrypto.unwrapWithRecoveryCode(
            Data(base64Encoded: wrappedDekDirectB64)!, code: messy, aad: wrapAad)
        XCTAssertEqual(out, dek)
    }

    func testRejectsWrongAad() {
        let otherAcct = SyncCrypto.syncAad(accountId: "acct-other", scope: "account", payloadType: "dek-wrap")
        XCTAssertThrowsError(
            try SyncCrypto.unwrapWithRecoveryCode(
                Data(base64Encoded: wrappedDekDirectB64)!, code: fullCode, aad: otherAcct))
    }

    func testShortKeyBlobDetectedAndRejectedClearly() {
        let blob = Data(base64Encoded: wrappedDekScryptB64)!
        XCTAssertTrue(SyncCrypto.isKdfWrapped(blob))
        XCTAssertThrowsError(try SyncCrypto.unwrapWithRecoveryCode(blob, code: "BSK1-ER21-YXDY-6HYW-YPT5", aad: wrapAad)) {
            guard case SyncCryptoError.shortRecoveryKeyUnsupported = $0 else {
                return XCTFail("expected shortRecoveryKeyUnsupported, got \($0)")
            }
        }
    }

    // MARK: - round trip (encrypt path)

    func testEncryptDecryptRoundTripWithAadBinding() throws {
        let blob = try SyncCrypto.encryptForSync(plaintext, dek: dek, aad: jobAad)
        XCTAssertTrue(SyncCrypto.isEncryptedPayload(blob))
        XCTAssertEqual(try SyncCrypto.decryptForSync(blob, dek: dek, aad: jobAad), plaintext)
        XCTAssertThrowsError(try SyncCrypto.decryptForSync(blob, dek: dek, aad: wrapAad))
    }
}

extension Data {
    init(hex: String) {
        self.init()
        var chars = hex[...]
        while chars.count >= 2 {
            let byte = chars.prefix(2)
            chars = chars.dropFirst(2)
            append(UInt8(byte, radix: 16)!)
        }
    }
}

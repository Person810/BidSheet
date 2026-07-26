/**
 * Wire models for the BidSheet Worker API — field names match the JSON the
 * Worker returns (see bidsheet-cloud README "Endpoints" and the desktop's
 * api-client.ts interfaces).
 */

import Foundation

/// Timestamps on the wire come in two shapes, both UTC: ISO-8601 with a "T"
/// (client-supplied `taken_at`) and D1's "YYYY-MM-DD HH:MM:SS" form
/// (`created_at`). Parse both to a real Date so sorting is format-agnostic
/// and display uses the device's local timezone instead of string-slicing
/// the UTC text.
enum WireTimestamp {
    private static let isoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let iso = ISO8601DateFormatter()
    private static let display: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    static func parse(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        var stamp = raw.replacingOccurrences(of: " ", with: "T")
        // No explicit zone (D1's form) means UTC — mark it so ISO8601
        // parsing doesn't reject it.
        let timePart = stamp.count > 10 ? String(stamp.dropFirst(10)) : ""
        if !timePart.contains("Z") && !timePart.contains("+") && !timePart.contains("-") {
            stamp += "Z"
        }
        return isoFractional.date(from: stamp) ?? iso.date(from: stamp)
    }

    /// Local-timezone label for a wire timestamp, or nil if unparseable.
    static func localLabel(_ raw: String?) -> String? {
        guard let date = parse(raw) else { return nil }
        return display.string(from: date)
    }
}

struct CloudJob: Codable, Identifiable {
    let id: String
    let account_id: String
    /// Non-content placeholder under E2EE; the real name is in name_enc.
    let name: String
    /// Encrypted {name, status} blob (base64) — decrypted client-side.
    let name_enc: String?
    let status: String?
    let lifecycle_state: String?
    let updated_at: String?
    let snapshot_hash: String?
    let created_at: String?
    let file_count: Int?
    let bytes_used: Int?
}

/// Decrypted job metadata out of name_enc.
struct JobMeta: Decodable {
    let name: String
    let status: String?
}

struct CloudAccount: Decodable {
    let id: String
    let name: String?
    let plan: String?
    let storage_bytes_used: Int
    let storage_cap_bytes: Int
    let subscription_status: String
    let trial_ends_at: String?
}

struct MeResponse: Decodable {
    let user_id: String
    let email: String?
    let account: CloudAccount
    let role: String?
}

/// What a file actually is. Encrypted client-side and stored opaquely by the
/// server, because the alternative — a filename in the R2 key and the kind in
/// a D1 column — told anyone with bucket access the client and project names.
struct FileMeta: Codable {
    /// photo | plan | markup | job
    let kind: String
    let name: String?
    let takenAt: String?
}

struct ManifestFile: Decodable, Identifiable {
    let id: String
    let job_id: String
    /// accountId/jobId/<opaque id>. The last segment is an HMAC, not a name.
    let r2_key: String
    let size_bytes: Int
    let meta_enc: String?
    let uploaded_by: String?
    let created_at: String?
}

extension ManifestFile {
    /// Decrypt this file's metadata. Returns nil when the blob is missing or
    /// doesn't open — an unreadable blob is displayed as an unnamed file
    /// rather than treated as an error.
    func meta(dek: Data, accountId: String) -> FileMeta? {
        guard let meta_enc, let blob = Data(base64Encoded: meta_enc) else { return nil }
        // The AAD names this exact object, so a server that moves one file's
        // metadata onto another produces a blob that won't open instead of a
        // quietly relabelled file.
        let aad = SyncCrypto.syncAad(
            accountId: accountId, scope: job_id, payloadType: "filemeta:\(objectId)")
        guard let plain = try? SyncCrypto.decryptForSync(blob, dek: dek, aad: aad) else { return nil }
        return try? JSONDecoder().decode(FileMeta.self, from: plain)
    }

    /// The opaque last segment of the key — what the metadata AAD is bound to.
    var objectId: String {
        r2_key.split(separator: "/").last.map(String.init) ?? r2_key
    }
}

struct JobManifest: Decodable {
    let job: CloudJob
    let files: [ManifestFile]
}

struct JobsResponse: Decodable {
    let jobs: [CloudJob]
}

/// The account's E2EE key material (opaque to the server). Format 1 is the
/// single-key shape; format 2 (per-member) adds the caller's own material.
struct KeyMaterial: Decodable {
    let format: Int
    let wrapped_dek: String
    let dek_fingerprint: String
    let my_status: String?
    let my_wrapped_priv: String?
    let my_wrapped_dek: String?
}

/// The minimal slice of the desktop's job.json snapshot the field app needs.
/// Decoded tolerantly — unknown fields are ignored, so desktop schema growth
/// never breaks the phone.
struct JobSnapshot: Decodable {
    struct SnapshotJob: Decodable {
        let name: String?
        let status: String?
        let client: String?
        let location: String?
    }
    struct SnapshotPlan: Decodable {
        let filename: String
        let sha256: String
    }
    let job: SnapshotJob?
    let plan: SnapshotPlan?
}

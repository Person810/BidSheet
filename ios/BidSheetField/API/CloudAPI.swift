/**
 * Thin client for the BidSheet Worker API — the field-app subset of the
 * desktop's api-client.ts. Every call carries a fresh aal2 JWT from
 * SupabaseAuth. R2 keys are accountId/jobId/<objectId>, the object id being
 * an HMAC of the file's logical name under the DEK (SyncCrypto.fileObjectKey)
 * — no filename ever reaches the server. The Worker enforces that accountId
 * matches the token's account.
 */

import Foundation

struct CloudAPIError: LocalizedError {
    let message: String
    let httpStatus: Int
    let code: String?
    var errorDescription: String? { message }
}

@MainActor
final class CloudAPI {
    private let auth: SupabaseAuth

    init(auth: SupabaseAuth) {
        self.auth = auth
    }

    // MARK: - endpoints

    func me() async throws -> MeResponse {
        try await requestJSON("/me")
    }

    func listJobs() async throws -> [CloudJob] {
        let response: JobsResponse = try await requestJSON("/jobs")
        return response.jobs
    }

    /// Job record + file list in one round trip — the offline-caching call
    /// the Worker grew specifically for this app (Phase 4).
    func manifest(jobId: String) async throws -> JobManifest {
        try await requestJSON("/jobs/\(encode(jobId))/manifest")
    }

    func keyMaterial() async throws -> KeyMaterial? {
        do {
            return try await requestJSON("/keys")
        } catch let error as CloudAPIError where error.httpStatus == 404 {
            return nil  // E2EE never set up for this account
        }
    }

    func getFile(key: String) async throws -> Data {
        try await requestData(path: "/files/\(encodeKey(key))")
    }

    /// Upload an already-encrypted file. `metaEnc` is the encrypted metadata
    /// blob (name, kind, capture time) the Worker stores and returns verbatim;
    /// it is the only place a filename or timestamp exists cloud-side. Capture
    /// GPS is deliberately not sent at all — it used to ride as plaintext query
    /// params the Worker stored in D1, which told the server exactly where the
    /// user was working.
    func putFile(key: String, body: Data, metaEnc: String?) async throws {
        var query = ""
        if let metaEnc {
            let escaped = metaEnc.addingPercentEncoding(
                withAllowedCharacters: .alphanumerics) ?? metaEnc
            query = "?meta_enc=\(escaped)"
        }
        _ = try await requestData(
            path: "/files/\(encodeKey(key))\(query)",
            method: "PUT", body: body, contentType: "application/octet-stream")
    }

    // MARK: - transport

    private func requestJSON<T: Decodable>(_ path: String) async throws -> T {
        let data = try await requestData(path: path)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw CloudAPIError(message: "Cloud API returned an unexpected response.", httpStatus: 200, code: nil)
        }
    }

    private func requestData(
        path: String, method: String = "GET", body: Data? = nil, contentType: String? = nil
    ) async throws -> Data {
        let token = try await auth.getAccessToken()
        var request = URLRequest(url: URL(string: CloudConfig.apiURL.absoluteString + path)!)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        request.httpBody = body

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw CloudAPIError(
                message: "Could not reach the cloud. Check your internet connection.", httpStatus: 0, code: nil)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let code = parsed?["code"] as? String
            throw CloudAPIError(message: Self.friendlyMessage(status: status, code: code, body: parsed),
                                httpStatus: status, code: code)
        }
        return data
    }

    /// Same user-facing wording as the desktop client, adjusted for phone context.
    private static func friendlyMessage(status: Int, code: String?, body: [String: Any]?) -> String {
        switch code {
        case "mfa_required":
            return "Cloud session needs a new authenticator code. Sign in again."
        case "storage_cap_exceeded":
            return "Cloud storage is full. Free space from BidSheet on your computer."
        case "subscription_required":
            return "Cloud subscription needed — the free trial has ended. Subscribe in BidSheet on your computer; synced data is still there to download."
        default:
            return (body?["error"] as? String) ?? "Cloud API error (HTTP \(status))."
        }
    }

    private func encode(_ segment: String) -> String {
        segment.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? segment
    }

    /// Encode each segment but keep the / separators the Worker routes on.
    private func encodeKey(_ key: String) -> String {
        key.split(separator: "/").map { encode(String($0)) }.joined(separator: "/")
    }
}

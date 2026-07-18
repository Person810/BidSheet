/**
 * Thin client for the BidSheet Worker API — the field-app subset of the
 * desktop's api-client.ts. Every call carries a fresh aal2 JWT from
 * SupabaseAuth. R2 keys follow accountId/jobId/<photos|plans|markup|job>/
 * <filename>; the Worker enforces that accountId matches the token's account.
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

    /// Upload a photo (already encrypted) with its capture metadata. The GPS
    /// coordinates and timestamp ride as query params the Worker stores in D1.
    func putPhoto(key: String, body: Data, lat: Double?, lng: Double?, takenAt: Date?) async throws {
        var params: [String] = []
        if let lat { params.append("gps_lat=\(lat)") }
        if let lng { params.append("gps_lng=\(lng)") }
        if let takenAt {
            let stamp = ISO8601DateFormatter().string(from: takenAt)
            params.append("taken_at=\(stamp.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? stamp)")
        }
        let query = params.isEmpty ? "" : "?" + params.joined(separator: "&")
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

/**
 * Supabase (GoTrue) auth client — the Swift port of the desktop's
 * supabase-auth.ts. Talks straight to the REST endpoints with URLSession, no
 * SDK. Cloud access requires a completed TOTP challenge (the Worker rejects
 * aal1 tokens): password sign-in (aal1) → challenge + verify (aal2) → API.
 *
 * TOTP *enrollment* is desktop-only for now — a phone enrolling its own
 * authenticator on the same screen defeats the second factor anyway. If an
 * account has no verified TOTP factor the UI says to finish setup on desktop.
 *
 * Only the refresh token is persisted (Keychain); access tokens live in
 * memory and refresh when they near expiry. Supabase preserves aal2 across
 * refreshes, so the user enters a TOTP code once per sign-in.
 */

import Foundation

struct AuthError: LocalizedError {
    let message: String
    let code: String?
    /// HTTP status behind the failure (0 = never reached the server). Used to
    /// tell a transient failure from a definitive auth rejection.
    var status: Int?
    var errorDescription: String? { message }

    static func friendly(status: Int, body: [String: Any]?) -> AuthError {
        let code = (body?["error_code"] as? String) ?? (body?["code"] as? String) ?? ""
        let msg = (body?["msg"] as? String) ?? (body?["message"] as? String)
            ?? (body?["error_description"] as? String) ?? (body?["error"] as? String) ?? ""
        let text: String
        switch true {
        case code == "invalid_credentials":
            text = "Email or password is incorrect."
        case code == "mfa_verification_failed", msg.lowercased().contains("invalid totp"):
            text = "That code didn't match. Check your authenticator app and try again."
        case code == "over_request_rate_limit":
            text = "Too many attempts. Wait a minute and try again."
        case status == 0:
            text = "Could not reach the sign-in service. Check your internet connection."
        default:
            text = msg.isEmpty ? "Sign-in service error (HTTP \(status))." : msg
        }
        return AuthError(message: text, code: code.isEmpty ? nil : code, status: status)
    }

    /// A refresh failure is "transient" when it does not prove the stored token
    /// is invalid — no network (offline launch), a timeout, a rate-limit, or a
    /// 5xx. Only a definitive 4xx auth rejection means the refresh token is
    /// actually dead. Anything we cannot classify is treated as transient, so we
    /// never sign the user out — and wipe their cached offline E2EE key — on a
    /// guess.
    static func isTransient(_ error: Error) -> Bool {
        guard let e = error as? AuthError, let status = e.status else { return true }
        if e.code == "over_request_rate_limit" { return true }
        return status == 0 || status == 408 || status == 429 || status >= 500
    }
}

struct AuthStatus {
    var signedIn: Bool
    var email: String?
    var aal: String?
    /// Signed in but the account has no verified TOTP factor (finish on desktop).
    var needsEnroll: Bool
    /// Signed in; a TOTP code is needed to reach aal2.
    var needsTotp: Bool
}

@MainActor
final class SupabaseAuth {
    private struct Factor: Decodable {
        let id: String
        let factor_type: String
        let status: String
    }
    private struct SessionUser: Decodable {
        let id: String
        let email: String?
        let factors: [Factor]?
    }
    private struct Session: Decodable {
        let access_token: String
        let refresh_token: String
        let user: SessionUser
    }

    private var accessToken: String?
    private var refreshToken: String?
    private(set) var email: String?
    private(set) var userId: String?
    private var hasVerifiedTotp = false
    private var refreshTask: Task<Void, Error>?
    /// Bumped by clear() so a refresh that was in flight when the user signed
    /// out can never adopt/persist the rotated credentials afterwards.
    private var sessionGeneration = 0

    // MARK: - session state

    private var payload: [String: Any] {
        guard let token = accessToken else { return [:] }
        return Self.decodeJwtPayload(token)
    }

    func status() -> AuthStatus {
        let aal = payload["aal"] as? String
        let signedIn = accessToken != nil
        return AuthStatus(
            signedIn: signedIn,
            email: email,
            aal: aal,
            needsEnroll: signedIn && aal == "aal1" && !hasVerifiedTotp,
            needsTotp: signedIn && aal == "aal1" && hasVerifiedTotp)
    }

    private func adopt(_ session: Session) {
        accessToken = session.access_token
        refreshToken = session.refresh_token
        email = session.user.email ?? email
        userId = session.user.id
        if let factors = session.user.factors {
            hasVerifiedTotp = factors.contains { $0.factor_type == "totp" && $0.status == "verified" }
        }
        persist()
    }

    private func persist() {
        guard let refreshToken else { return }
        Keychain.setString(refreshToken, for: Keychain.refreshToken)
        if let email { Keychain.setString(email, for: Keychain.email) }
        if let userId { Keychain.setString(userId, for: Keychain.userId) }
    }

    /// Restore the previous session from the stored refresh token, if any.
    func restore() async -> AuthStatus {
        guard let stored = Keychain.string(for: Keychain.refreshToken) else { return status() }
        email = Keychain.string(for: Keychain.email)
        userId = Keychain.string(for: Keychain.userId)
        refreshToken = stored
        do {
            try await refresh()
            // A restored aal2 session means a TOTP factor was verified.
            if payload["aal"] as? String == "aal2" { hasVerifiedTotp = true }
        } catch {
            // Only drop the stored session on a definitive auth rejection. On an
            // offline launch or a transient server error the token may still be
            // valid, so keep it — and the cached E2EE key that clear() would
            // wipe — rather than forcing a full re-login + recovery-key re-entry
            // at a no-signal jobsite. The session reads as signed-out until the
            // next successful refresh.
            if !AuthError.isTransient(error) { clear() }
        }
        return status()
    }

    // MARK: - flows

    func signIn(email: String, password: String) async throws -> AuthStatus {
        let session: Session = try await gotrue("/token?grant_type=password", body: ["email": email, "password": password])
        adopt(session)
        return status()
    }

    /// Complete an MFA challenge with a 6-digit code against the account's
    /// verified TOTP factor. On success the session is upgraded to aal2.
    func verifyTotp(code: String) async throws -> AuthStatus {
        guard let token = accessToken else { throw AuthError(message: "Not signed in.", code: nil) }
        let user: SessionUser = try await gotrue("/user", token: token, method: "GET")
        guard let factor = user.factors?.first(where: { $0.factor_type == "totp" && $0.status == "verified" }) else {
            throw AuthError(message: "No authenticator is set up for this account yet. Finish cloud setup in BidSheet on your computer first.", code: nil)
        }
        struct Challenge: Decodable { let id: String }
        let challenge: Challenge = try await gotrue("/factors/\(factor.id)/challenge", body: [String: String](), token: token)
        let session: Session = try await gotrue(
            "/factors/\(factor.id)/verify",
            body: ["challenge_id": challenge.id, "code": code.filter { !$0.isWhitespace }],
            token: token)
        hasVerifiedTotp = true
        adopt(session)
        return status()
    }

    private func refresh() async throws {
        guard let refreshToken else { throw AuthError(message: "Not signed in.", code: nil) }
        // Single-flight: refresh tokens rotate on use, so concurrent
        // refreshes would invalidate each other.
        if refreshTask == nil {
            let generation = sessionGeneration
            refreshTask = Task { [weak self] in
                defer { self?.refreshTask = nil }
                let session: Session = try await Self.rawGotrue(
                    "/token?grant_type=refresh_token", body: ["refresh_token": refreshToken])
                // If sign-out ran while the request was in flight, adopting
                // now would re-persist credentials clearAll() just wiped.
                guard let self, self.sessionGeneration == generation else {
                    throw AuthError(message: "Signed out.", code: nil)
                }
                self.adopt(session)
            }
        }
        try await refreshTask!.value
    }

    /// A currently-valid access token, refreshed if within 60s of expiry.
    func getAccessToken() async throws -> String {
        guard accessToken != nil else { throw AuthError(message: "Not signed in.", code: nil) }
        let exp = (payload["exp"] as? NSNumber)?.doubleValue ?? 0
        if Date().timeIntervalSince1970 > exp - 60 {
            try await refresh()
        }
        // Sign-out during the refresh clears the token — throw rather than
        // force-unwrap nil.
        guard let token = accessToken else {
            throw AuthError(message: "Not signed in.", code: nil)
        }
        return token
    }

    func signOut() async {
        if let token = accessToken {
            let _: [String: String]? = try? await gotrue("/logout", body: [String: String](), token: token)
        }
        clear()
    }

    private func clear() {
        sessionGeneration += 1
        accessToken = nil
        refreshToken = nil
        hasVerifiedTotp = false
        Keychain.clearAll()
    }

    // MARK: - transport

    private func gotrue<T: Decodable>(
        _ path: String, body: [String: String]? = nil, token: String? = nil, method: String? = nil
    ) async throws -> T {
        try await Self.rawGotrue(path, body: body, token: token, method: method)
    }

    private static func rawGotrue<T: Decodable>(
        _ path: String, body: [String: String]? = nil, token: String? = nil, method: String? = nil
    ) async throws -> T {
        var request = URLRequest(url: CloudConfig.supabaseURL.appendingPathComponent("auth/v1").appendingPathAndQuery(path))
        request.httpMethod = method ?? "POST"
        request.setValue(CloudConfig.supabasePublishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body) }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw AuthError.friendly(status: 0, body: nil)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw AuthError.friendly(status: status, body: parsed)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func decodeJwtPayload(_ jwt: String) -> [String: Any] {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return [:] }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return obj
    }
}

private extension URL {
    /// appendingPathComponent percent-encodes "?" — split path from query so
    /// gotrue paths like "/token?grant_type=password" build a real query.
    func appendingPathAndQuery(_ pathAndQuery: String) -> URL {
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)!
        let parts = pathAndQuery.split(separator: "?", maxSplits: 1)
        components.path += parts[0]
        if parts.count > 1 { components.query = String(parts[1]) }
        return components.url!
    }
}

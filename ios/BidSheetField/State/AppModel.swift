/**
 * Top-level app state machine:
 *
 *   signedOut → (password) → needsTotp → (6-digit code, aal2)
 *     → locked → (recovery key unwraps the DEK) → ready
 *
 * The DEK is cached in the Keychain after the first unlock so day-to-day
 * opens go straight to `ready`; sign-out wipes everything. All decryption
 * happens on-device — the server only ever hands us ciphertext.
 */

import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    enum Phase: Equatable {
        case launching
        case signedOut
        case needsTotp
        /// aal2 but the account has no verified TOTP factor — desktop setup needed.
        case needsDesktopSetup
        case locked
        case ready
    }

    @Published var phase: Phase = .launching
    @Published var jobs: [CloudJob] = []
    @Published var jobNames: [String: JobMeta] = [:]
    @Published var lastError: String?

    let auth = SupabaseAuth()
    private(set) lazy var api = CloudAPI(auth: auth)
    let cache = FileCache()

    private(set) var dek: Data?
    private(set) var accountId: String?

    // MARK: - lifecycle

    func start() async {
        let status = await auth.restore()
        if status.aal == "aal2" {
            await adoptSignedInSession()
        } else {
            phase = .signedOut
        }
    }

    func signIn(email: String, password: String) async throws {
        let status = try await auth.signIn(email: email, password: password)
        if status.needsTotp {
            phase = .needsTotp
        } else if status.needsEnroll {
            phase = .needsDesktopSetup
        } else if status.aal == "aal2" {
            await adoptSignedInSession()
        }
    }

    func verifyTotp(code: String) async throws {
        let status = try await auth.verifyTotp(code: code)
        if status.aal == "aal2" {
            await adoptSignedInSession()
        }
    }

    private func adoptSignedInSession() async {
        // Resolve the account id (auto-creates the account server-side on
        // first request, same as desktop).
        do {
            let me = try await api.me()
            accountId = me.account.id
            Keychain.setString(me.account.id, for: Keychain.accountId)
        } catch {
            // Offline launch: fall back to the cached account id so the
            // cached jobs/plans still open.
            accountId = Keychain.string(for: Keychain.accountId)
            if accountId == nil {
                lastError = error.localizedDescription
                phase = .signedOut
                return
            }
        }
        if let stored = Keychain.data(for: Keychain.dek), stored.count == 32 {
            dek = stored
            phase = .ready
            await refreshJobs()
        } else {
            phase = .locked
        }
    }

    // MARK: - E2EE unlock

    /// Unwrap the account DEK with the user's recovery key. Handles both key
    /// formats: format 1 (recovery key directly wraps the DEK) and format 2
    /// (recovery key → member private key → sealed DEK).
    func unlock(recoveryCode: String) async throws {
        guard let accountId else { throw CloudAPIError(message: "Not signed in.", httpStatus: 0, code: nil) }
        guard let material = try await api.keyMaterial() else {
            throw SyncCryptoError.decryptFailed
        }
        let unwrapped: Data
        if material.format >= 2, let wrappedPriv = material.my_wrapped_priv {
            guard let sealedDek = material.my_wrapped_dek else {
                throw CloudAPIError(
                    message: "Your seat hasn't been approved yet. Ask the account owner to approve you in BidSheet on their computer.",
                    httpStatus: 0, code: "pending_approval")
            }
            guard let userId = auth.userId else {
                throw CloudAPIError(message: "Not signed in.", httpStatus: 0, code: nil)
            }
            let priv = try SyncCrypto.unwrapPrivateKey(
                Data(base64Encoded: wrappedPriv) ?? Data(), code: recoveryCode, userId: userId)
            unwrapped = try SyncCrypto.openDek(
                Data(base64Encoded: sealedDek) ?? Data(),
                myPrivRaw: priv,
                aad: SyncCrypto.sealAad(accountId: accountId, recipientUserId: userId))
        } else {
            unwrapped = try SyncCrypto.unwrapWithRecoveryCode(
                Data(base64Encoded: material.wrapped_dek) ?? Data(),
                code: recoveryCode,
                aad: SyncCrypto.syncAad(accountId: accountId, scope: "account", payloadType: "dek-wrap"))
        }
        guard SyncCrypto.dekFingerprint(unwrapped) == material.dek_fingerprint else {
            throw SyncCryptoError.decryptFailed
        }
        dek = unwrapped
        Keychain.set(unwrapped, for: Keychain.dek)
        phase = .ready
        await refreshJobs()
    }

    func signOut() async {
        await auth.signOut()
        dek = nil
        accountId = nil
        jobs = []
        jobNames = [:]
        cache.clear()
        phase = .signedOut
    }

    // MARK: - jobs

    func refreshJobs() async {
        guard let dek, let accountId else { return }
        do {
            let fetched = try await api.listJobs()
            var names: [String: JobMeta] = [:]
            for job in fetched {
                if let enc = job.name_enc, let blob = Data(base64Encoded: enc),
                   let plain = try? SyncCrypto.decryptForSync(
                       blob, dek: dek,
                       aad: SyncCrypto.syncAad(accountId: accountId, scope: job.id, payloadType: "name")),
                   let meta = try? JSONDecoder().decode(JobMeta.self, from: plain) {
                    names[job.id] = meta
                }
            }
            jobs = fetched
            jobNames = names
            lastError = nil
            cache.saveJobList(fetched)
        } catch {
            // Offline: show the cached list rather than an empty screen.
            if jobs.isEmpty, let cached = cache.loadJobList() {
                jobs = cached
            }
            lastError = error.localizedDescription
        }
    }

    func displayName(for job: CloudJob) -> String {
        jobNames[job.id]?.name ?? job.name
    }
}

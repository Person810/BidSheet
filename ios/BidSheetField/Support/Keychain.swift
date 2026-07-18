/**
 * Minimal Keychain wrapper for the app's secrets: the Supabase refresh token
 * and (after unlock) the account DEK. Everything is stored
 * AfterFirstUnlockThisDeviceOnly — available for background sync once the
 * phone has been unlocked since boot, never migrated to another device via
 * backup (a restored phone must re-enter the recovery key, by design).
 */

import Foundation
import Security

enum Keychain {
    private static let service = "com.bidsheet.field"

    static func set(_ data: Data, for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func setString(_ value: String, for key: String) {
        set(Data(value.utf8), for: key)
    }

    static func data(for key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func string(for key: String) -> String? {
        data(for: key).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // Well-known keys
    static let refreshToken = "supabase.refresh_token"
    static let email = "supabase.email"
    static let userId = "supabase.user_id"
    static let dek = "cloud.dek"
    static let accountId = "cloud.account_id"

    /// Wipe everything on sign-out.
    static func clearAll() {
        [refreshToken, email, userId, dek, accountId].forEach(delete)
    }
}

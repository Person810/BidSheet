/**
 * Cloud endpoints — same public values as the desktop's
 * src/main/cloud/config.ts. The publishable key only identifies the Supabase
 * project (auth still needs the user's password + TOTP), and the Worker
 * rejects anything without a verified aal2 JWT.
 */

import Foundation

enum CloudConfig {
    static let supabaseURL = URL(string: "https://ugyhtckanjemsgigwcax.supabase.co")!
    static let supabasePublishableKey = "sb_publishable_VSD3Iez_jQCLG4tvYzqlmg_rBHE-KP5"
    static let apiURL = URL(string: "https://bidsheet-api.lm-wiley.workers.dev")!
}

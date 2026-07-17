/**
 * BidSheet Field — the iOS companion to the BidSheet desktop estimating app.
 * Phase 5 of the cloud plan: sign in to the same account, unlock with the
 * recovery key, browse synced jobs, view plans offline, and send jobsite
 * photos back to the office.
 */

import SwiftUI

@main
struct BidSheetFieldApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .task { await model.start() }
        }
    }
}

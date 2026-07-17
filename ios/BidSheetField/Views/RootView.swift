import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        switch model.phase {
        case .launching:
            ProgressView("Loading…")
        case .signedOut:
            SignInView()
        case .needsTotp:
            TotpView()
        case .needsDesktopSetup:
            DesktopSetupView()
        case .locked:
            UnlockView()
        case .ready:
            JobListView()
        }
    }
}

/// Shown when the account exists but has no verified authenticator yet —
/// TOTP enrollment is deliberately desktop-only.
struct DesktopSetupView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "desktopcomputer")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Finish setup on your computer")
                .font(.title2.bold())
            Text("Cloud sync needs an authenticator app, which you set up in BidSheet on your computer (Settings → Cloud Sync). Once that's done, sign in here again.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Back to sign in") {
                Task { await model.signOut() }
            }
            .buttonStyle(.bordered)
        }
        .padding(32)
    }
}

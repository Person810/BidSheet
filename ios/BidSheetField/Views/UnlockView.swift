import SwiftUI

/// Recovery-key entry — the zero-knowledge unlock. The key never leaves the
/// phone; it unwraps the account DEK locally and the DEK is cached in the
/// Keychain so this screen appears once per device, not once per launch.
struct UnlockView: View {
    @EnvironmentObject private var model: AppModel
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Your bids are end-to-end encrypted", systemImage: "lock.shield")
                            .font(.headline)
                        Text("Enter the recovery key you saved when you set up cloud sync on your computer. It starts with BSK1.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    TextField("BSK1-XXXX-XXXX-…", text: $code, axis: .vertical)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .lineLimit(3, reservesSpace: true)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        submit()
                    } label: {
                        if busy {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Unlock").frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(busy || code.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Section {
                    Text("Lost the key? It can be viewed or regenerated in BidSheet on your computer (Settings → Cloud Sync → Encryption). Neither BidSheet nor the cloud can recover it for you — that's the point.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Unlock")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Sign Out") { Task { await model.signOut() } }
                }
            }
        }
    }

    private func submit() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await model.unlock(recoveryCode: code)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

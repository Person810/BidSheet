import SwiftUI

/// Downloads, decrypts, and displays one jobsite photo, with its capture
/// metadata underneath. Decrypted bytes are cached for offline viewing.
struct PhotoViewerView: View {
    @EnvironmentObject private var model: AppModel
    let jobId: String
    let file: ManifestFile

    @State private var image: UIImage?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            if let image {
                ZoomableScrollView(maxZoom: 6) {
                    Image(uiImage: image)
                }
                .background(Color.black)
            } else if let error {
                Spacer()
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
                    .padding()
                Spacer()
            } else {
                Spacer()
                ProgressView("Loading photo…")
                Spacer()
            }
            HStack(spacing: 16) {
                if let taken = WireTimestamp.localLabel(file.taken_at) {
                    Label(taken, systemImage: "clock")
                }
                if let lat = file.gps_lat, let lng = file.gps_lng {
                    Label(String(format: "%.5f, %.5f", lat, lng), systemImage: "location.fill")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(8)
        }
        .navigationTitle("Photo")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let dek = model.dek, let accountId = model.accountId else { return }
        let cacheName = "photo-\(file.filename)"
        if let cached = model.cache.load(jobId: jobId, name: cacheName), let ui = UIImage(data: cached) {
            image = ui
            return
        }
        do {
            let blob = try await model.api.getFile(key: file.r2_key)
            // Field-app photos are BSE1-encrypted; tolerate a plaintext blob
            // in case an older/other client ever uploaded one.
            let bytes: Data
            if SyncCrypto.isEncryptedPayload(blob) {
                bytes = try SyncCrypto.decryptForSync(
                    blob, dek: dek,
                    aad: SyncCrypto.syncAad(accountId: accountId, scope: jobId,
                                            payloadType: "photo:\(file.filename)"))
            } else {
                bytes = blob
            }
            guard let ui = UIImage(data: bytes) else {
                error = "This file isn't a viewable image."
                return
            }
            model.cache.save(bytes, jobId: jobId, name: cacheName)
            image = ui
        } catch {
            self.error = error.localizedDescription
        }
    }
}

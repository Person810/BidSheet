import SwiftUI

/// One job in the field: the plan set (cached for offline), the photo log,
/// and the camera button that sends geotagged jobsite photos back to the
/// office. Everything downloaded is decrypted on-device; everything uploaded
/// is encrypted before it leaves the phone.
struct JobDetailView: View {
    @EnvironmentObject private var model: AppModel
    let job: CloudJob

    @State private var manifest: JobManifest?
    @State private var snapshot: JobSnapshot?
    @State private var planData: Data?
    @State private var loadingPlan = false
    @State private var showingCamera = false
    @State private var uploading = false
    @State private var error: String?
    @State private var uploadedCount = 0

    private var photos: [ManifestFile] {
        manifest?.files.filter { $0.type == "photo" } ?? []
    }
    private var planFiles: [ManifestFile] {
        manifest?.files.filter { $0.type == "plan" } ?? []
    }

    var body: some View {
        List {
            if let info = snapshot?.job {
                Section("Job") {
                    if let client = info.client, !client.isEmpty {
                        LabeledContent("Client", value: client)
                    }
                    if let location = info.location, !location.isEmpty {
                        LabeledContent("Location", value: location)
                    }
                    if let status = info.status, !status.isEmpty {
                        LabeledContent("Status", value: status.capitalized)
                    }
                }
            }

            Section("Plans") {
                if planFiles.isEmpty {
                    Text("No plan synced for this job.")
                        .foregroundStyle(.secondary)
                } else if let planData {
                    NavigationLink("View plan (\(planFiles.first?.filename ?? "PDF"))") {
                        PlanViewerView(data: planData, title: model.displayName(for: job))
                    }
                } else {
                    Button {
                        Task { await loadPlan() }
                    } label: {
                        if loadingPlan {
                            HStack { ProgressView(); Text("Downloading…") }
                        } else {
                            Label("Download plan for offline use", systemImage: "arrow.down.circle")
                        }
                    }
                    .disabled(loadingPlan)
                }
            }

            Section("Jobsite Photos (\(photos.count + uploadedCount))") {
                Button {
                    showingCamera = true
                } label: {
                    if uploading {
                        HStack { ProgressView(); Text("Uploading…") }
                    } else {
                        Label("Take Photo", systemImage: "camera")
                    }
                }
                .disabled(uploading)
                ForEach(photos) { photo in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(photo.taken_at?.prefix(16).replacingOccurrences(of: "T", with: " ") ?? photo.filename)
                            .font(.subheadline)
                        if photo.gps_lat != nil {
                            Label("Geotagged", systemImage: "location.fill")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
        .navigationTitle(model.displayName(for: job))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingCamera) {
            CameraPicker { image in
                Task { await upload(image: image) }
            }
        }
    }

    // MARK: - loading

    private func load() async {
        guard let dek = model.dek, let accountId = model.accountId else { return }
        do {
            manifest = try await model.api.manifest(jobId: job.id)

            // job.json carries the snapshot (incl. the plan's sha256, which
            // is part of the plan blob's AAD).
            let jobBlob = try await model.api.getFile(key: "\(accountId)/\(job.id)/job/job.json")
            let plain = try SyncCrypto.decryptForSync(
                jobBlob, dek: dek,
                aad: SyncCrypto.syncAad(accountId: accountId, scope: job.id, payloadType: "job"))
            snapshot = try? JSONDecoder().decode(JobSnapshot.self, from: plain)
            model.cache.save(plain, jobId: job.id, name: "job.json")
            error = nil
        } catch {
            // Offline: fall back to whatever was cached earlier.
            if let cached = model.cache.load(jobId: job.id, name: "job.json") {
                snapshot = try? JSONDecoder().decode(JobSnapshot.self, from: cached)
            }
            self.error = manifest == nil && snapshot == nil ? error.localizedDescription : nil
        }
        if let plan = snapshot?.plan, planData == nil {
            planData = model.cache.load(jobId: job.id, name: "plan-\(plan.sha256).pdf")
        }
    }

    private func loadPlan() async {
        guard let dek = model.dek, let accountId = model.accountId, let plan = snapshot?.plan else {
            error = "Open this job once while online to fetch its plan info."
            return
        }
        loadingPlan = true
        defer { loadingPlan = false }
        do {
            let blob = try await model.api.getFile(key: "\(accountId)/\(job.id)/plans/\(plan.filename)")
            let bytes = try SyncCrypto.decryptForSync(
                blob, dek: dek,
                aad: SyncCrypto.syncAad(accountId: accountId, scope: job.id, payloadType: "plan:\(plan.sha256)"))
            model.cache.save(bytes, jobId: job.id, name: "plan-\(plan.sha256).pdf")
            planData = bytes
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - photo upload

    private func upload(image: UIImage) async {
        guard let dek = model.dek, let accountId = model.accountId,
              let jpeg = image.jpegData(compressionQuality: 0.8)
        else { return }
        uploading = true
        defer { uploading = false }
        do {
            let takenAt = Date()
            let location = await LocationProvider().currentLocation()
            let filename = "\(UUID().uuidString.lowercased()).jpg"
            // Photos are E2EE like everything else: AAD binds the blob to
            // this account/job/filename (payload type "photo:<filename>").
            let encrypted = try SyncCrypto.encryptForSync(
                jpeg, dek: dek,
                aad: SyncCrypto.syncAad(accountId: accountId, scope: job.id, payloadType: "photo:\(filename)"))
            try await model.api.putPhoto(
                key: "\(accountId)/\(job.id)/photos/\(filename)",
                body: encrypted,
                lat: location?.coordinate.latitude,
                lng: location?.coordinate.longitude,
                takenAt: takenAt)
            uploadedCount += 1
            error = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

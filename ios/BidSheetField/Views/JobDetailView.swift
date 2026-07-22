import SwiftUI

/// One job in the field: the plan set and takeoff markup (cached for
/// offline), every file synced for the job, and the camera button that sends
/// geotagged jobsite photos back to the office. Everything downloaded is
/// decrypted on-device; everything uploaded is encrypted before it leaves
/// the phone.
struct JobDetailView: View {
    @EnvironmentObject private var model: AppModel
    let job: CloudJob

    @State private var manifest: JobManifest?
    @State private var snapshot: JobSnapshot?
    @State private var markup: MarkupDoc?
    @State private var planData: Data?
    @State private var loadingPlan = false
    @State private var showingCamera = false
    @State private var uploading = false
    @State private var pendingCount = 0
    @State private var error: String?

    private var photos: [ManifestFile] {
        (manifest?.files.filter { $0.type == "photo" } ?? [])
            .sorted {
                (WireTimestamp.parse($0.taken_at ?? $0.created_at) ?? .distantPast)
                    > (WireTimestamp.parse($1.taken_at ?? $1.created_at) ?? .distantPast)
            }
    }
    private var planFile: ManifestFile? {
        manifest?.files.first { $0.type == "plan" }
    }

    var body: some View {
        List {
            jobSection
            planSection
            photoSection
            filesSection
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

    // MARK: - sections

    @ViewBuilder private var jobSection: some View {
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
    }

    @ViewBuilder private var planSection: some View {
        Section("Plans & Takeoff") {
            if snapshot?.plan == nil && planFile == nil {
                Text("No plan synced for this job.")
                    .foregroundStyle(.secondary)
            } else if let planData {
                NavigationLink {
                    PlanViewerView(data: planData, title: model.displayName(for: job))
                } label: {
                    Label(snapshot?.plan?.filename ?? "Plan set", systemImage: "doc.richtext")
                }
                if let markup, !markup.takeoff.pagesWithMarkup.isEmpty {
                    NavigationLink {
                        TakeoffView(planData: planData, markup: markup, title: "Takeoff")
                    } label: {
                        Label("Takeoff markup", systemImage: "scribble.variable")
                    }
                } else if markup != nil {
                    Text("No takeoff drawn on this plan yet.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
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
    }

    @ViewBuilder private var photoSection: some View {
        Section("Jobsite Photos (\(photos.count))") {
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
            if pendingCount > 0 {
                Label("\(pendingCount) photo\(pendingCount == 1 ? "" : "s") waiting to upload",
                      systemImage: "clock.arrow.circlepath")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(photos) { photo in
                NavigationLink {
                    PhotoViewerView(jobId: job.id, file: photo)
                } label: {
                    HStack {
                        Image(systemName: "photo")
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(photoTitle(photo)).font(.subheadline)
                            if photo.gps_lat != nil {
                                Label("Geotagged", systemImage: "location.fill")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var filesSection: some View {
        if let files = manifest?.files, !files.isEmpty {
            Section("All Files (\(files.count))") {
                ForEach(files) { file in
                    HStack {
                        Image(systemName: icon(for: file.type))
                            .foregroundStyle(.secondary)
                            .frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(file.filename).font(.subheadline).lineLimit(1)
                            Text("\(file.type.capitalized) • \(byteString(file.size_bytes))\(dateSuffix(file))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    // MARK: - loading

    private func load() async {
        guard let dek = model.dek, let accountId = model.accountId else { return }
        // Push any photos captured offline first, so the manifest fetched
        // below already includes them.
        pendingCount = model.cache.pendingPhotos(jobId: job.id).count
        await uploadPendingPhotos()
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

            await loadMarkup()
            error = nil
        } catch {
            // Offline: fall back to whatever was cached earlier.
            if let cached = model.cache.load(jobId: job.id, name: "job.json") {
                snapshot = try? JSONDecoder().decode(JobSnapshot.self, from: cached)
            }
            if markup == nil, let cached = model.cache.load(jobId: job.id, name: "markup.json") {
                markup = try? JSONDecoder().decode(MarkupDoc.self, from: cached)
            }
            self.error = manifest == nil && snapshot == nil ? error.localizedDescription : nil
        }
        if let plan = snapshot?.plan, planData == nil {
            planData = model.cache.load(jobId: job.id, name: "plan-\(plan.sha256).pdf")
        }
    }

    /// The markup overlay doc the desktop publishes for this app.
    private func loadMarkup() async {
        guard let dek = model.dek, let accountId = model.accountId else { return }
        do {
            let blob = try await model.api.getFile(key: "\(accountId)/\(job.id)/markup/takeoff.json")
            let plain = try SyncCrypto.decryptForSync(
                blob, dek: dek,
                aad: SyncCrypto.syncAad(accountId: accountId, scope: job.id, payloadType: "markup"))
            markup = try JSONDecoder().decode(MarkupDoc.self, from: plain)
            model.cache.save(plain, jobId: job.id, name: "markup.json")
        } catch {
            if markup == nil, let cached = model.cache.load(jobId: job.id, name: "markup.json") {
                markup = try? JSONDecoder().decode(MarkupDoc.self, from: cached)
            }
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
        guard let jpeg = image.jpegData(compressionQuality: 0.8) else { return }
        uploading = true
        defer { uploading = false }
        let location = await LocationProvider().currentLocation()
        let meta = PendingPhoto(
            jobId: job.id,
            filename: "\(UUID().uuidString.lowercased()).jpg",
            takenAt: Date(),
            gpsLat: location?.coordinate.latitude,
            gpsLng: location?.coordinate.longitude)
        // Durably persist the capture BEFORE any network attempt, so a dead
        // signal (or a mid-upload failure) can't lose the shot — it stays
        // queued and retries on the next load/refresh.
        model.cache.savePendingPhoto(jpeg, meta: meta)
        pendingCount = model.cache.pendingPhotos(jobId: job.id).count
        await uploadPendingPhotos()
        if pendingCount == 0 {
            error = nil
            await load()
        }
    }

    /// Try to push every queued photo for this job; stop at the first
    /// failure (still offline) and leave the rest queued.
    private func uploadPendingPhotos() async {
        guard let dek = model.dek, let accountId = model.accountId else { return }
        for meta in model.cache.pendingPhotos(jobId: job.id) {
            guard let jpeg = model.cache.loadPendingPhoto(meta) else {
                // Orphan metadata (torn write) — drop it.
                model.cache.removePendingPhoto(meta)
                continue
            }
            do {
                // Photos are E2EE like everything else: AAD binds the blob to
                // this account/job/filename (payload type "photo:<filename>").
                let encrypted = try SyncCrypto.encryptForSync(
                    jpeg, dek: dek,
                    aad: SyncCrypto.syncAad(accountId: accountId, scope: meta.jobId, payloadType: "photo:\(meta.filename)"))
                try await model.api.putPhoto(
                    key: "\(accountId)/\(meta.jobId)/photos/\(meta.filename)",
                    body: encrypted,
                    lat: meta.gpsLat,
                    lng: meta.gpsLng,
                    takenAt: meta.takenAt)
                // Cache the plaintext locally so the new photo views offline,
                // then clear it from the queue.
                model.cache.save(jpeg, jobId: meta.jobId, name: "photo-\(meta.filename)")
                model.cache.removePendingPhoto(meta)
            } catch {
                break
            }
        }
        pendingCount = model.cache.pendingPhotos(jobId: job.id).count
    }

    // MARK: - formatting

    private func photoTitle(_ photo: ManifestFile) -> String {
        WireTimestamp.localLabel(photo.taken_at ?? photo.created_at) ?? photo.filename
    }

    private func icon(for type: String) -> String {
        switch type {
        case "photo": return "photo"
        case "plan": return "doc.richtext"
        case "markup": return "scribble.variable"
        case "job": return "shippingbox"
        default: return "doc"
        }
    }

    private func byteString(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private func dateSuffix(_ file: ManifestFile) -> String {
        guard let date = file.created_at?.prefix(10) else { return "" }
        return " • \(date)"
    }
}

/**
 * On-device cache for the field workflow: the job list, per-job manifests,
 * decrypted plan PDFs, and jobsite photos waiting to upload, so a jobsite
 * with no signal still shows plans that were opened on wifi and never loses
 * a capture. Decrypted plans live in Application Support (excluded from
 * iCloud backup — the cloud copy is the backup); everything is wiped on
 * sign-out.
 */

import Foundation

/// A jobsite photo captured while offline (or mid-upload): the JPEG sits in
/// the pending directory next to this metadata until the upload succeeds.
struct PendingPhoto: Codable {
    let jobId: String
    let filename: String
    let takenAt: Date
}

final class FileCache {
    private let root: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        root = base.appendingPathComponent("BidSheetCache", isDirectory: true)
        createRoot()
    }

    /// Create the cache root and exclude it from iCloud/iTunes backup —
    /// applied on first launch and again whenever clear() recreates it.
    private func createRoot() {
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = root
        try? url.setResourceValues(values)
    }

    // MARK: - job list

    func saveJobList(_ jobs: [CloudJob]) {
        guard let data = try? JSONEncoder().encode(jobs) else { return }
        try? data.write(to: root.appendingPathComponent("jobs.json"), options: .atomic)
    }

    func loadJobList() -> [CloudJob]? {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("jobs.json")) else { return nil }
        return try? JSONDecoder().decode([CloudJob].self, from: data)
    }

    // MARK: - per-job blobs (already decrypted)

    private func jobDir(_ jobId: String) -> URL {
        let dir = root.appendingPathComponent(jobId, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func save(_ data: Data, jobId: String, name: String) {
        try? data.write(to: jobDir(jobId).appendingPathComponent(name), options: .atomic)
    }

    func load(jobId: String, name: String) -> Data? {
        try? Data(contentsOf: jobDir(jobId).appendingPathComponent(name))
    }

    // MARK: - pending photo uploads

    /// Photos are persisted here at capture time, before any network attempt,
    /// so a dead signal can't lose the shot. The JPEG is stored as
    /// pending/<jobId>/<filename> with a <filename>.json metadata sidecar
    /// (written last, so a torn write leaves at worst an orphan JPEG that is
    /// dropped on the next scan).
    private func pendingDir(_ jobId: String) -> URL {
        let dir = root.appendingPathComponent("pending", isDirectory: true)
            .appendingPathComponent(jobId, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func savePendingPhoto(_ jpeg: Data, meta: PendingPhoto) {
        let dir = pendingDir(meta.jobId)
        guard let metaData = try? JSONEncoder().encode(meta) else { return }
        try? jpeg.write(to: dir.appendingPathComponent(meta.filename), options: .atomic)
        try? metaData.write(to: dir.appendingPathComponent(meta.filename + ".json"), options: .atomic)
    }

    /// Pending uploads for one job, oldest first.
    func pendingPhotos(jobId: String) -> [PendingPhoto] {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: pendingDir(jobId), includingPropertiesForKeys: nil)
        else { return [] }
        return urls.filter { $0.pathExtension == "json" }
            .compactMap { url -> PendingPhoto? in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder().decode(PendingPhoto.self, from: data)
            }
            .sorted { $0.takenAt < $1.takenAt }
    }

    func loadPendingPhoto(_ meta: PendingPhoto) -> Data? {
        try? Data(contentsOf: pendingDir(meta.jobId).appendingPathComponent(meta.filename))
    }

    func removePendingPhoto(_ meta: PendingPhoto) {
        let dir = pendingDir(meta.jobId)
        try? FileManager.default.removeItem(at: dir.appendingPathComponent(meta.filename))
        try? FileManager.default.removeItem(at: dir.appendingPathComponent(meta.filename + ".json"))
    }

    func clear() {
        try? FileManager.default.removeItem(at: root)
        // Recreate through the same path as init so the backup exclusion is
        // re-applied — a bare createDirectory here left post-sign-out caches
        // backup-eligible until the next cold launch.
        createRoot()
    }
}

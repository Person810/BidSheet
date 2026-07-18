/**
 * On-device cache for the field workflow: the job list, per-job manifests,
 * and decrypted plan PDFs, so a jobsite with no signal still shows plans
 * that were opened on wifi. Decrypted plans live in Application Support
 * (excluded from iCloud backup — the cloud copy is the backup); everything
 * is wiped on sign-out.
 */

import Foundation

final class FileCache {
    private let root: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        root = base.appendingPathComponent("BidSheetCache", isDirectory: true)
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

    func clear() {
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
}

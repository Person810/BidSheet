import SwiftUI

struct JobListView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            Group {
                if model.jobs.isEmpty {
                    ContentUnavailableCompatView(
                        title: "No synced jobs yet",
                        message: "Turn on cloud sync for a job in BidSheet on your computer and it will show up here.")
                } else {
                    List(model.jobs) { job in
                        NavigationLink(value: job.id) {
                            JobRow(job: job)
                        }
                    }
                    .navigationDestination(for: String.self) { jobId in
                        if let job = model.jobs.first(where: { $0.id == jobId }) {
                            JobDetailView(job: job)
                        }
                    }
                }
            }
            .navigationTitle("Jobs")
            .refreshable { await model.refreshJobs() }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button("Refresh") { Task { await model.refreshJobs() } }
                        Button("Sign Out", role: .destructive) { Task { await model.signOut() } }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .overlay(alignment: .bottom) {
                if let error = model.lastError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.white)
                        .padding(10)
                        .background(.red.opacity(0.9), in: Capsule())
                        .padding()
                }
            }
        }
    }
}

private struct JobRow: View {
    @EnvironmentObject private var model: AppModel
    let job: CloudJob

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.displayName(for: job))
                .font(.headline)
            HStack(spacing: 12) {
                if let status = model.jobNames[job.id]?.status, !status.isEmpty {
                    Text(status.capitalized)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(.tint.opacity(0.15), in: Capsule())
                }
                if let count = job.file_count {
                    Label("\(count)", systemImage: "doc")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let updated = job.updated_at {
                    Text(updated.prefix(10))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// ContentUnavailableView needs iOS 17; this covers 16 too.
struct ContentUnavailableCompatView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }
}

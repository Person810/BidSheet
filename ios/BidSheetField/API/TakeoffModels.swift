/**
 * The markup overlay document — `markup/takeoff.json`, produced by the
 * desktop's buildMarkupDoc() (src/main/cloud/serializer.ts) exactly for this
 * client. Rows are straight SQLite table dumps, so decoding is deliberately
 * tolerant: unknown fields are ignored and desktop schema growth never
 * breaks the phone.
 *
 * Coordinate space (must match the desktop's DrawingOverlay): x_px/y_px are
 * pdf.js scale-1.0 viewport coordinates — PDF points, origin at the page's
 * top-left, y increasing downward, with the page's *intrinsic* /Rotate
 * already applied. User-applied rotation (takeoff_page_rotations) is a
 * display-time transform on top.
 */

import Foundation

struct MarkupDoc: Decodable {
    let format: Int?
    let job_name: String?
    let plan: JobSnapshot.SnapshotPlan?
    let takeoff: TakeoffData
}

struct TakeoffData: Decodable {
    let settings: TakeoffSettings?
    let page_scales: [PageScale]
    let page_rotations: [PageRotation]
    let nodes: [TakeoffNode]
    let runs: [TakeoffRun]
    let points: [TakeoffPoint]
    let items: [TakeoffItem]
    let areas: [TakeoffArea]
    let area_points: [TakeoffAreaPoint]
    let annotations: [TakeoffAnnotation]

    /// Effective px-per-foot for a page: per-page calibration first, then the
    /// legacy job-wide scale.
    func pxPerFt(page: Int) -> Double? {
        page_scales.first { $0.page_number == page }?.scale_px_per_ft
            ?? settings?.scale_px_per_ft
    }

    /// User-applied rotation for a page (0/90/180/270).
    func rotation(page: Int) -> Int {
        page_rotations.first { $0.page_number == page }?.rotation ?? 0
    }

    /// Every page that has any geometry on it, sorted.
    var pagesWithMarkup: [Int] {
        var pages = Set<Int>()
        runs.forEach { pages.insert($0.pdf_page) }
        items.forEach { pages.insert($0.pdf_page) }
        areas.forEach { pages.insert($0.pdf_page) }
        nodes.forEach { pages.insert($0.pdf_page) }
        annotations.forEach { pages.insert($0.pdf_page) }
        return pages.sorted()
    }
}

struct TakeoffSettings: Decodable {
    let scale_px_per_ft: Double?
}

struct PageScale: Decodable {
    let page_number: Int
    let scale_px_per_ft: Double
}

struct PageRotation: Decodable {
    let page_number: Int
    let rotation: Int
}

struct TakeoffRun: Decodable, Identifiable {
    let id: Int
    let label: String?
    let utility_type: String?
    let pipe_size_in: Double?
    let pipe_material: String?
    let color: String?
    let pdf_page: Int
    let sort_order: Int?
}

struct TakeoffPoint: Decodable {
    let id: Int
    let run_id: Int
    let x_px: Double
    let y_px: Double
    let sort_order: Int?
    let node_id: Int?
}

struct TakeoffNode: Decodable, Identifiable {
    let id: Int
    let x_px: Double
    let y_px: Double
    let pdf_page: Int
    let structure_type: String?
    let label: String?
}

struct TakeoffItem: Decodable, Identifiable {
    let id: Int
    let x_px: Double
    let y_px: Double
    let quantity: Int?
    let label: String?
    let pdf_page: Int
}

struct TakeoffArea: Decodable, Identifiable {
    let id: Int
    let label: String?
    let area_type: String?
    let color: String?
    let pdf_page: Int
}

struct TakeoffAreaPoint: Decodable {
    let id: Int
    let area_id: Int
    let x_px: Double
    let y_px: Double
    let sort_order: Int?
}

struct TakeoffAnnotation: Decodable, Identifiable {
    let id: Int
    let pdf_page: Int
    /// text | arrow | cloud
    let kind: String?
    let x1_px: Double
    let y1_px: Double
    let x2_px: Double?
    let y2_px: Double?
    let text: String?
    let color: String?
}

// MARK: - derived quantities

extension TakeoffData {
    /// Ordered vertices for one run.
    func polyline(runId: Int) -> [TakeoffPoint] {
        points.filter { $0.run_id == runId }
            .sorted { ($0.sort_order ?? 0, $0.id) < ($1.sort_order ?? 0, $1.id) }
    }

    /// Ordered vertices for one area polygon.
    func polygon(areaId: Int) -> [TakeoffAreaPoint] {
        area_points.filter { $0.area_id == areaId }
            .sorted { ($0.sort_order ?? 0, $0.id) < ($1.sort_order ?? 0, $1.id) }
    }

    /// Run length in feet, nil when the page has no scale calibration.
    func lengthFt(runId: Int, page: Int) -> Double? {
        guard let scale = pxPerFt(page: page), scale > 0 else { return nil }
        let pts = polyline(runId: runId)
        guard pts.count >= 2 else { return nil }
        var px = 0.0
        for i in 1..<pts.count {
            px += hypot(pts[i].x_px - pts[i - 1].x_px, pts[i].y_px - pts[i - 1].y_px)
        }
        return px / scale
    }

    /// Area in square feet (shoelace), nil when the page has no scale.
    func areaSf(areaId: Int, page: Int) -> Double? {
        guard let scale = pxPerFt(page: page), scale > 0 else { return nil }
        let pts = polygon(areaId: areaId)
        guard pts.count >= 3 else { return nil }
        var doubled = 0.0
        for i in 0..<pts.count {
            let a = pts[i]
            let b = pts[(i + 1) % pts.count]
            doubled += a.x_px * b.y_px - b.x_px * a.y_px
        }
        return abs(doubled) / 2 / (scale * scale)
    }
}

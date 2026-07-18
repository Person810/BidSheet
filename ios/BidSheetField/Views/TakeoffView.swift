import PDFKit
import SwiftUI

/**
 * The takeoff viewer: the plan sheet with the estimator's markup drawn over
 * it — pipe runs, structures, count items, restoration areas, and
 * annotations, with computed quantities (LF / SF) when the page is scale-
 * calibrated. Read-only by design: takeoff editing stays on the desktop.
 *
 * Geometry lives in pdf.js scale-1 viewport coordinates (PDF points,
 * top-left origin, y down, intrinsic page rotation applied) — see
 * TakeoffModels.swift. The page image is rendered by PDFKit in that same
 * frame, so overlay points map 1:1; user-applied page rotation is applied
 * to both via one transform.
 */
struct TakeoffView: View {
    let planData: Data
    let markup: MarkupDoc
    let title: String

    @State private var page: Int = 1
    @State private var showSummary = false

    private var takeoff: TakeoffData { markup.takeoff }
    private var pages: [Int] { takeoff.pagesWithMarkup.isEmpty ? [1] : takeoff.pagesWithMarkup }

    var body: some View {
        ZoomableScrollView {
            TakeoffPageView(planData: planData, takeoff: takeoff, page: page)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { page = pages.first ?? 1 }
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                if pages.count > 1 {
                    Menu {
                        ForEach(pages, id: \.self) { p in
                            Button {
                                page = p
                            } label: {
                                if p == page {
                                    Label("Sheet \(p)", systemImage: "checkmark")
                                } else {
                                    Text("Sheet \(p)")
                                }
                            }
                        }
                    } label: {
                        Text("Sheet \(page)")
                    }
                }
                Button {
                    showSummary = true
                } label: {
                    Image(systemName: "list.bullet.rectangle")
                }
            }
        }
        .sheet(isPresented: $showSummary) {
            TakeoffSummaryView(takeoff: takeoff, page: page)
                .presentationDetents([.medium, .large])
        }
    }
}

// MARK: - one rendered sheet + its overlay

private struct TakeoffPageView: View {
    let planData: Data
    let takeoff: TakeoffData
    let page: Int

    @State private var pageImage: UIImage?
    @State private var baseSize: CGSize = .zero  // scale-1 frame, pre-user-rotation

    private var userRotation: Int { ((takeoff.rotation(page: page) % 360) + 360) % 360 }

    /// Displayed frame after user rotation (90/270 swap the axes).
    private var displaySize: CGSize {
        userRotation % 180 == 90 ? CGSize(width: baseSize.height, height: baseSize.width) : baseSize
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let pageImage {
                Image(uiImage: pageImage)
                    .resizable()
                    .frame(width: displaySize.width, height: displaySize.height)
                TakeoffOverlay(takeoff: takeoff, page: page, baseSize: baseSize, rotation: userRotation)
                    .frame(width: displaySize.width, height: displaySize.height)
            } else {
                ProgressView().frame(width: 400, height: 300)
            }
        }
        .onAppear { render() }
        .onChange(of: page) { _ in render() }
    }

    private func render() {
        pageImage = nil
        let data = planData
        let pageNumber = page
        let rotation = userRotation
        DispatchQueue.global(qos: .userInitiated).async {
            guard let doc = PDFDocument(data: data),
                  let pdfPage = doc.page(at: max(0, pageNumber - 1))
            else { return }
            // Scale-1 frame: crop box with the page's intrinsic /Rotate
            // applied (thumbnail renders in that frame, matching pdf.js).
            let crop = pdfPage.bounds(for: .cropBox).size
            let intrinsicSwap = pdfPage.rotation % 180 != 0
            let base = intrinsicSwap ? CGSize(width: crop.height, height: crop.width) : crop
            // Render at 2.5x for crisp zooming, capped for huge sheets.
            let renderScale = min(2.5, 4096 / max(base.width, base.height))
            var image = pdfPage.thumbnail(
                of: CGSize(width: base.width * renderScale, height: base.height * renderScale),
                for: .cropBox)
            if rotation != 0 {
                image = image.rotated(byDegrees: CGFloat(rotation))
            }
            DispatchQueue.main.async {
                baseSize = base
                pageImage = image
            }
        }
    }
}

// MARK: - markup overlay

private struct TakeoffOverlay: View {
    let takeoff: TakeoffData
    let page: Int
    let baseSize: CGSize
    let rotation: Int

    /// Map a stored (unrotated-frame) point into the displayed (user-rotated)
    /// frame — same math as the desktop's rotationTransform.
    private func t(_ x: Double, _ y: Double) -> CGPoint {
        let w = baseSize.width
        let h = baseSize.height
        switch rotation {
        case 90: return CGPoint(x: h - y, y: x)
        case 180: return CGPoint(x: w - x, y: h - y)
        case 270: return CGPoint(x: y, y: w - x)
        default: return CGPoint(x: x, y: y)
        }
    }

    var body: some View {
        Canvas { context, _ in
            drawAreas(context)
            drawRuns(context)
            drawNodes(context)
            drawItems(context)
            drawAnnotations(context)
        }
        .allowsHitTesting(false)
    }

    private func drawAreas(_ context: GraphicsContext) {
        for area in takeoff.areas where area.pdf_page == page {
            let pts = takeoff.polygon(areaId: area.id)
            guard pts.count >= 3 else { continue }
            var path = Path()
            path.move(to: t(pts[0].x_px, pts[0].y_px))
            for p in pts.dropFirst() { path.addLine(to: t(p.x_px, p.y_px)) }
            path.closeSubpath()
            let color = Color(hex: area.color)
            context.fill(path, with: .color(color.opacity(0.22)))
            context.stroke(path, with: .color(color), lineWidth: 1.5)

            let cx = pts.map(\.x_px).reduce(0, +) / Double(pts.count)
            let cy = pts.map(\.y_px).reduce(0, +) / Double(pts.count)
            var label = area.label?.isEmpty == false ? area.label! : (area.area_type ?? "area").capitalized
            if let sf = takeoff.areaSf(areaId: area.id, page: page) {
                label += " • \(Int(sf.rounded())) SF"
            }
            drawLabel(context, label, at: t(cx, cy), color: color)
        }
    }

    private func drawRuns(_ context: GraphicsContext) {
        for run in takeoff.runs where run.pdf_page == page {
            let pts = takeoff.polyline(runId: run.id)
            guard pts.count >= 2 else { continue }
            var path = Path()
            path.move(to: t(pts[0].x_px, pts[0].y_px))
            for p in pts.dropFirst() { path.addLine(to: t(p.x_px, p.y_px)) }
            let color = Color(hex: run.color)
            context.stroke(path, with: .color(color),
                           style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            for p in pts {
                let c = t(p.x_px, p.y_px)
                context.fill(Path(ellipseIn: CGRect(x: c.x - 3, y: c.y - 3, width: 6, height: 6)),
                             with: .color(color))
            }
            // Label at the middle vertex: "8\" PVC Run A • 245 LF"
            let mid = t(pts[pts.count / 2].x_px, pts[pts.count / 2].y_px)
            var label = ""
            if let size = run.pipe_size_in { label += "\(size == size.rounded() ? String(Int(size)) : String(size))\" " }
            if let mat = run.pipe_material, !mat.isEmpty { label += "\(mat) " }
            if let name = run.label, !name.isEmpty { label += name }
            if let lf = takeoff.lengthFt(runId: run.id, page: page) {
                label += " • \(Int(lf.rounded())) LF"
            }
            drawLabel(context, label.trimmingCharacters(in: .whitespaces), at: mid, color: color)
        }
    }

    private func drawNodes(_ context: GraphicsContext) {
        for node in takeoff.nodes where node.pdf_page == page {
            let c = t(node.x_px, node.y_px)
            let rect = CGRect(x: c.x - 4.5, y: c.y - 4.5, width: 9, height: 9)
            context.fill(Path(ellipseIn: rect), with: .color(.white))
            context.stroke(Path(ellipseIn: rect), with: .color(.black), lineWidth: 1.5)
            let label = node.label?.isEmpty == false ? node.label! : (node.structure_type ?? "")
            if !label.isEmpty {
                drawLabel(context, label, at: CGPoint(x: c.x, y: c.y - 12), color: .black)
            }
        }
    }

    private func drawItems(_ context: GraphicsContext) {
        for item in takeoff.items where item.pdf_page == page {
            let c = t(item.x_px, item.y_px)
            var cross = Path()
            cross.move(to: CGPoint(x: c.x - 4, y: c.y - 4))
            cross.addLine(to: CGPoint(x: c.x + 4, y: c.y + 4))
            cross.move(to: CGPoint(x: c.x - 4, y: c.y + 4))
            cross.addLine(to: CGPoint(x: c.x + 4, y: c.y - 4))
            context.stroke(cross, with: .color(.red), lineWidth: 2)
            var label = item.label ?? ""
            if let qty = item.quantity, qty > 1 { label += " ×\(qty)" }
            if !label.trimmingCharacters(in: .whitespaces).isEmpty {
                drawLabel(context, label, at: CGPoint(x: c.x, y: c.y - 11), color: .red)
            }
        }
    }

    private func drawAnnotations(_ context: GraphicsContext) {
        for ann in takeoff.annotations where ann.pdf_page == page {
            let color = Color(hex: ann.color ?? "#EF4444")
            let p1 = t(ann.x1_px, ann.y1_px)
            switch ann.kind {
            case "arrow":
                guard let x2 = ann.x2_px, let y2 = ann.y2_px else { continue }
                let p2 = t(x2, y2)
                var line = Path()
                line.move(to: p1)
                line.addLine(to: p2)
                context.stroke(line, with: .color(color), lineWidth: 2)
                // Arrowhead at p2
                let angle = atan2(p2.y - p1.y, p2.x - p1.x)
                var head = Path()
                for side in [-1.0, 1.0] {
                    head.move(to: p2)
                    head.addLine(to: CGPoint(
                        x: p2.x - 10 * cos(angle + side * 0.45),
                        y: p2.y - 10 * sin(angle + side * 0.45)))
                }
                context.stroke(head, with: .color(color), lineWidth: 2)
                if let text = ann.text, !text.isEmpty {
                    drawLabel(context, text, at: CGPoint(x: p1.x, y: p1.y - 10), color: color)
                }
            case "cloud":
                guard let x2 = ann.x2_px, let y2 = ann.y2_px else { continue }
                let p2 = t(x2, y2)
                let rect = CGRect(x: min(p1.x, p2.x), y: min(p1.y, p2.y),
                                  width: abs(p2.x - p1.x), height: abs(p2.y - p1.y))
                let path = Path(roundedRect: rect, cornerRadius: 8)
                context.stroke(path, with: .color(color),
                               style: StrokeStyle(lineWidth: 2, dash: [7, 4]))
                if let text = ann.text, !text.isEmpty {
                    drawLabel(context, text, at: CGPoint(x: rect.midX, y: rect.minY - 9), color: color)
                }
            default:  // "text"
                if let text = ann.text, !text.isEmpty {
                    drawLabel(context, text, at: p1, color: color)
                }
            }
        }
    }

    /// Halo-backed label so text stays readable over dense linework.
    private func drawLabel(_ context: GraphicsContext, _ text: String, at point: CGPoint, color: Color) {
        guard !text.isEmpty else { return }
        let resolved = context.resolve(
            Text(text).font(.system(size: 9, weight: .semibold)).foregroundColor(color))
        let size = resolved.measure(in: CGSize(width: 300, height: 40))
        let rect = CGRect(x: point.x - size.width / 2 - 2, y: point.y - size.height / 2 - 1,
                          width: size.width + 4, height: size.height + 2)
        context.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(.white.opacity(0.75)))
        context.draw(resolved, at: point)
    }
}

// MARK: - quantities sheet

private struct TakeoffSummaryView: View {
    let takeoff: TakeoffData
    let page: Int

    var body: some View {
        NavigationStack {
            List {
                let runs = takeoff.runs.filter { $0.pdf_page == page }
                if !runs.isEmpty {
                    Section("Pipe Runs") {
                        ForEach(runs) { run in
                            HStack {
                                Circle().fill(Color(hex: run.color)).frame(width: 10, height: 10)
                                VStack(alignment: .leading) {
                                    Text(runTitle(run))
                                    if let type = run.utility_type {
                                        Text(type.capitalized).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                Text(takeoff.lengthFt(runId: run.id, page: page).map { "\(Int($0.rounded())) LF" } ?? "—")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                let areas = takeoff.areas.filter { $0.pdf_page == page }
                if !areas.isEmpty {
                    Section("Restoration Areas") {
                        ForEach(areas) { area in
                            HStack {
                                Circle().fill(Color(hex: area.color)).frame(width: 10, height: 10)
                                Text(area.label?.isEmpty == false ? area.label! : (area.area_type ?? "Area").capitalized)
                                Spacer()
                                Text(takeoff.areaSf(areaId: area.id, page: page).map { "\(Int($0.rounded())) SF" } ?? "—")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                let items = takeoff.items.filter { $0.pdf_page == page }
                if !items.isEmpty {
                    Section("Count Items") {
                        ForEach(items) { item in
                            HStack {
                                Text(item.label?.isEmpty == false ? item.label! : "Item")
                                Spacer()
                                Text("×\(item.quantity ?? 1)").foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if takeoff.pxPerFt(page: page) == nil {
                    Section {
                        Label("This sheet isn't scale-calibrated, so lengths and areas can't be computed. Calibrate it in BidSheet on the desktop.",
                              systemImage: "ruler")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Sheet \(page) Quantities")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func runTitle(_ run: TakeoffRun) -> String {
        var parts: [String] = []
        if let size = run.pipe_size_in {
            parts.append(size == size.rounded() ? "\(Int(size))\"" : "\(size)\"")
        }
        if let mat = run.pipe_material, !mat.isEmpty { parts.append(mat) }
        if let label = run.label, !label.isEmpty { parts.append(label) }
        return parts.isEmpty ? "Run" : parts.joined(separator: " ")
    }
}

// MARK: - image rotation

private extension UIImage {
    /// Rotate clockwise by 90/180/270 (the user page rotations).
    func rotated(byDegrees degrees: CGFloat) -> UIImage {
        let radians = degrees * .pi / 180
        let swap = Int(degrees) % 180 != 0
        let newSize = swap ? CGSize(width: size.height, height: size.width) : size
        let renderer = UIGraphicsImageRenderer(size: newSize, format: imageRendererFormat)
        return renderer.image { ctx in
            ctx.cgContext.translateBy(x: newSize.width / 2, y: newSize.height / 2)
            ctx.cgContext.rotate(by: radians)
            draw(in: CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height))
        }
    }
}

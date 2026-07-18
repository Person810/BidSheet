import PDFKit
import SwiftUI

/// Full-screen plan sheet viewer. PDFKit handles big multi-sheet civil plan
/// sets (zoom, page thumbnails) natively — takeoff markup overlay comes in a
/// later phase.
struct PlanViewerView: View {
    let data: Data
    let title: String

    var body: some View {
        PDFKitView(data: data)
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PDFKitView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.document = PDFDocument(data: data)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document == nil {
            view.document = PDFDocument(data: data)
        }
    }
}

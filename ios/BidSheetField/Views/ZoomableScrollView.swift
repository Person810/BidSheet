import SwiftUI
import UIKit

/// Pinch-zoom + pan container for the takeoff viewer — UIScrollView is still
/// the only rock-solid way to get focal-point pinch zoom of arbitrary
/// SwiftUI content.
struct ZoomableScrollView<Content: View>: UIViewRepresentable {
    private let content: Content
    private let maxZoom: CGFloat

    init(maxZoom: CGFloat = 8, @ViewBuilder content: () -> Content) {
        self.maxZoom = maxZoom
        self.content = content()
    }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.maximumZoomScale = maxZoom
        scroll.minimumZoomScale = 0.1
        scroll.bouncesZoom = true
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false

        let hosted = context.coordinator.host.view!
        hosted.translatesAutoresizingMaskIntoConstraints = true
        hosted.frame = CGRect(origin: .zero, size: context.coordinator.host.sizeThatFits(in: UIView.layoutFittingExpandedSize))
        hosted.backgroundColor = .clear
        scroll.addSubview(hosted)
        scroll.contentSize = hosted.frame.size
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.host.rootView = content
        let size = context.coordinator.host.sizeThatFits(in: UIView.layoutFittingExpandedSize)
        if context.coordinator.host.view.frame.size != size {
            context.coordinator.host.view.frame = CGRect(origin: .zero, size: size)
            scroll.contentSize = size
            fitToWidth(scroll, contentSize: size)
        }
    }

    /// Initial zoom: fit the page to the screen.
    private func fitToWidth(_ scroll: UIScrollView, contentSize: CGSize) {
        guard contentSize.width > 0, contentSize.height > 0,
              scroll.bounds.width > 0 || scroll.superview != nil else { return }
        DispatchQueue.main.async {
            guard scroll.bounds.width > 0 else { return }
            let fit = min(scroll.bounds.width / contentSize.width,
                          scroll.bounds.height / contentSize.height)
            scroll.minimumZoomScale = min(fit, 1) * 0.5
            scroll.zoomScale = fit
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(host: UIHostingController(rootView: content))
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        let host: UIHostingController<Content>

        init(host: UIHostingController<Content>) {
            self.host = host
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            host.view
        }
    }
}

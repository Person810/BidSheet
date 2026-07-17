/**
 * One-shot GPS fix for tagging jobsite photos. Best-effort by design: a
 * denied permission or timeout returns nil and the photo uploads untagged —
 * location is metadata, never a gate. On first use the permission prompt is
 * awaited, so the very first photo still gets tagged if the user allows.
 */

import CoreLocation
import Foundation

final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private var awaitingAuthorization = false

    func currentLocation() async -> CLLocation? {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        return await withCheckedContinuation { cont in
            continuation = cont
            switch manager.authorizationStatus {
            case .notDetermined:
                awaitingAuthorization = true
                manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways:
                manager.requestLocation()
            default:
                finish(nil)
                return
            }
            // Don't hold up a photo upload for a slow fix.
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                self?.finish(nil)
            }
        }
    }

    private func finish(_ location: CLLocation?) {
        continuation?.resume(returning: location)
        continuation = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard awaitingAuthorization else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            awaitingAuthorization = false
            manager.requestLocation()
        case .denied, .restricted:
            awaitingAuthorization = false
            finish(nil)
        default:
            break  // still .notDetermined while the prompt is up
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        finish(locations.first)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(nil)
    }
}

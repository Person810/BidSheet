# BidSheet Field (iOS companion) — early development

The iOS companion app for BidSheet — Phase 5 of the cloud plan. Field crews
sign in to the same BidSheet Cloud account as the office, unlock with the
account recovery key, and get:

- **Job list** — every cloud-synced job, with names decrypted on-device
- **Plan viewing** — download the job's plan set once on wifi, view it
  offline at the jobsite (PDFKit: pinch-zoom, page scrubbing)
- **Jobsite photos** — camera capture with GPS + timestamp, encrypted on the
  phone and uploaded into the job's cloud folder for the office to pull down

Everything is end-to-end encrypted with the same frozen wire formats as the
desktop (`src/main/cloud/sync-crypto.ts`): the server only ever stores
ciphertext, and the phone decrypts with the account DEK unwrapped from the
user's recovery key.

## Why this exists before an App Store listing

None of this needs a paid Apple Developer account or App Store approval:

- The **simulator** runs the app with zero signing setup.
- A **free Apple ID** can sign and run the app on your own iPhone from Xcode
  (the install expires after 7 days — plug in and hit Run again).
- The $99/year account only becomes necessary for TestFlight betas and the
  App Store itself, both of which can come whenever the app is ready.

The whole backend (auth, manifest endpoint, GPS photo metadata, E2EE key
distribution) was built with this client in mind, so building now is mostly
UI + the crypto port — and the crypto port is pinned by golden tests.

## Building (requires a Mac with Xcode 15+)

```sh
brew install xcodegen
cd ios
xcodegen generate
open BidSheetField.xcodeproj
```

Select the `BidSheetField` scheme and a simulator, then Run. To run on your
own iPhone: Xcode → project → Signing & Capabilities → set Team to your
(free) Apple ID, plug the phone in, Run.

The `.xcodeproj` is generated from `project.yml` and stays out of git —
regenerate it after adding/removing source files.

## Tests

`Cmd-U` in Xcode runs `BidSheetFieldTests`. The important suite is
**SyncCryptoGoldenTests**: the exact frozen golden vectors from the
desktop's `sync-crypto.golden.test.ts` (real ciphertexts from a known-good
build). If the Swift crypto can open all of them, it interops byte-for-byte
with what users already have in the cloud. Never edit a vector to make a
test pass.

## Layout

```
BidSheetField/
  BidSheetFieldApp.swift    app entry
  Crypto/SyncCrypto.swift   BSE1 envelope, recovery keys, X25519 seal — the
                            Swift port of the desktop's sync-crypto.ts
  Auth/SupabaseAuth.swift   GoTrue REST client: password → TOTP → aal2 JWT
  API/CloudAPI.swift        Worker API subset (/me, /jobs, manifest, files)
  API/Models.swift          wire models
  State/AppModel.swift      signedOut → needsTotp → locked → ready
  State/FileCache.swift     offline cache (job list, job.json, plan PDFs)
  Views/                    SwiftUI screens
  Support/                  config, Keychain, one-shot GPS
BidSheetFieldTests/         golden-vector crypto tests
project.yml                 XcodeGen spec (generates the .xcodeproj)
```

## Decisions that differ from desktop (on purpose)

- **TOTP enrollment is desktop-only.** The phone can *verify* a code but not
  enroll a new authenticator — enrolling the second factor on the same
  device that holds the session would weaken MFA, and the desktop flow
  already exists.
- **Short (80-bit) recovery keys can't unlock yet.** They require scrypt,
  which CryptoKit doesn't provide. BSKD blobs are detected and rejected with
  a clear message; full-length (256-bit) keys work. Options for later: a
  small vendored scrypt, or libsodium via SPM.
- **Photos are uploaded encrypted** with AAD payload type
  `photo:<filename>` (scope = cloud job id), mirroring the `plan:<sha>`
  pattern. The desktop doesn't display synced photos yet — when that lands
  (Phase 5b), it must use this same AAD.

## Not yet built (roadmap)

- Desktop-side photo gallery (Phase 5b) — pull the crew's photos into the
  job's Documents tab
- Takeoff markup overlay on the plan viewer (decrypt `markup/takeoff.json`)
- Offline upload queue (photos taken with no signal send when back on wifi)
- Short-recovery-key unlock (scrypt)
- Background manifest refresh + push on new addenda

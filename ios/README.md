# BidSheet Field (iOS companion) — early development

The iOS companion app for BidSheet — Phase 5 of the cloud plan. Field crews
sign in to the same BidSheet Cloud account as the office, unlock with the
account recovery key, and get:

- **Job list** — every cloud-synced job, with names decrypted on-device
- **Files** — every synced file on the job (plans, photos, markup, snapshot)
  with type, size, and date
- **Plan viewing** — download the job's plan set once on wifi, view it
  offline at the jobsite (PDFKit: pinch-zoom, page scrubbing)
- **Takeoff viewing** — the estimator's markup drawn over the plan sheet:
  pipe runs, structures, count items, restoration areas, and annotations,
  with computed LF/SF quantities and a per-sheet quantities summary
- **Jobsite photos** — camera capture with timestamp, encrypted on the
  phone and uploaded into the job's cloud folder; synced photos view (and
  cache) on the phone with their capture metadata

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

The whole backend (auth, manifest endpoint, encrypted file metadata, E2EE key
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
  API/TakeoffModels.swift   markup/takeoff.json document + LF/SF math
  State/AppModel.swift      signedOut → needsTotp → locked → ready
  State/FileCache.swift     offline cache (job list, job.json, plan PDFs)
  Views/                    SwiftUI screens
  Support/                  config, Keychain, colour helpers
BidSheetFieldTests/         golden-vector crypto tests
project.yml                 XcodeGen spec (generates the .xcodeproj)
```

## Decisions that differ from desktop (on purpose)

- **TOTP enrollment is desktop-only.** The phone can *verify* a code but not
  enroll a new authenticator — enrolling the second factor on the same
  device that holds the session would weaken MFA, and the desktop flow
  already exists.
- **There is one recovery-key shape, and this app can open it.** Short
  (80-bit) keys and their scrypt `BSKD` envelope were retired platform-wide on
  2026-07-26, partly *because* they made this app permanently unable to unlock
  such an account — CryptoKit has no scrypt, and a 128 MiB KDF working set is
  not something a phone should carry. Nothing writes a BSKD blob any more;
  `SyncCrypto` still detects one from desktop v0.3.3 or earlier and reports it
  accurately instead of letting it look like corrupt data. Do not "add scrypt
  support" later — the format is gone, not deferred.
- **Photos are uploaded encrypted** with AAD payload type
  `photo:<filename>` (scope = cloud job id), mirroring the `plan:<sha>`
  pattern. The desktop doesn't display synced photos yet — when that lands
  (Phase 5b), it must use this same AAD.

## Not yet built (roadmap)

- Desktop-side photo gallery (Phase 5b) — pull the crew's photos into the
  job's Documents tab
- Walls and elevation surfaces in the takeoff overlay (runs, areas, items,
  nodes, and annotations render today)
- Offline upload queue (photos taken with no signal send when back on wifi)
- Background manifest refresh + push on new addenda

# BidSheet Field vs CompanyCam — jobsite photo capture

*Drafted 2026-07-28. Companion to `bid-management-competitive-analysis.md` and
`bidsheet-cloud/docs/ios-field-app-roadmap.md`. Our side is sourced from the
code, not the marketing pages; their side from published 2026 pricing.*

## TL;DR

The 100 GB cap is a real problem, but it is **not our biggest one**, and it is
the cheapest of our problems to fix. Ranked by what actually stops a customer
from paying us today:

1. **The app is not on the App Store.** `ios/README.md` describes a free-Apple-ID
   sideload that expires every 7 days. We cannot onboard a single real crew.
2. **Photos are one-way.** The desktop cannot display what the crew shoots
   (open item C4; Phase 5b unbuilt). For "site picture taking software," the
   office not being able to see the pictures is disqualifying.
3. **No Android.** The repo has `ios/` and nothing else. A meaningful share of
   field crews are on Android, and they are simply excluded.
4. **The 100 GB cap** — which a one-line image resize and a storage add-on
   largely dissolve. See §3.

Head-to-head as a *photo app*, we lose and will keep losing: their pricing model
funds unlimited storage and ours structurally cannot (§4). Head-to-head as
*the estimator's plan and takeoff in the crew's pocket*, they have no answer at
all. That is the fight worth picking.

---

## 1. What each side actually is

|  | **BidSheet Field** | **CompanyCam** |
|---|---|---|
| Price | $20/mo flat, whole account | $29/user/mo annual, $34 monthly |
| Minimum spend | $20/mo | ~$87/mo (3-seat minimum, no single-user plan) |
| 5-person crew | **$20/mo** | **$145/mo** |
| Storage | 100 GB pooled (10 GB trial) | Unlimited, every tier |
| Trial | 30 days, no card | 14 days, no card |
| Platforms | iOS only, not yet shipped | iOS, Android, web |
| Encryption | E2EE — server holds ciphertext only | Server-side; vendor can read everything |
| Photo → plan link | Takeoff overlay + planned pins | GPS/project tagging |

Sources: [CompanyCam pricing guide](https://roofingsoftwareguide.com/guides/companycam-pricing/),
[CompanyCam pricing 2026](https://www.scanmanifold.com/blog-posts/companycam-pricing-2026-complete-guide-f0fd7),
[G2](https://www.g2.com/products/companycam/pricing).

The price column is the headline: **for a five-person crew we are 7× cheaper.**
100 GB is not a limitation we should apologise for — it is the thing we are
trading for a 7× price difference. We currently present it as an embarrassment.

---

## 2. Pros and cons

### Where we win

**E2EE is unmatched at any price.** The server stores ciphertext; names, capture
times, and pixels are all sealed under the account DEK. CompanyCam can read every
photo their customers take, and so can anyone who breaches or subpoenas them. For
a sub whose photo library *is* the evidence in a future change-order dispute or
differing-site-conditions claim, that is a substantive difference, not a
checkbox. No competitor at this price point offers it.

**Price, and the shape of the price.** Flat per-account with unlimited members
means adding a crew member costs nothing. CompanyCam's 3-seat floor means a
two-man shop pays for three.

**The plan and the takeoff.** This is the moat and it is not close. A photo
pinned to a station on the estimator's own sheet — next to the pipe run, invert
elevations, and quantities that were actually bid — is a different artifact from
a GPS-tagged photo in a project folder. We already have the plan viewer, the
takeoff coordinate system, and the scale calibration. CompanyCam has none of it
and cannot easily get it. Roadmap Tier 1 item 3 is the single highest-leverage
thing on the board.

**The feedback loop.** Roadmap Tier 2 item 5 (daily production capture feeding
`production_rates`) is the HeavyBid↔HeavyJob loop HCSS charges six figures for.
CompanyCam does not do estimating and will not.

**Zero-egress infrastructure.** R2 charges $0.015/GB-month and nothing for
egress. CompanyCam on conventional object storage pays every time a photo is
viewed. Our marginal cost per stored-and-viewed GB is *lower than the competitor
offering unlimited storage.* Capping at 100 GB on top of that is an unforced
error.

**Local-first and GPLv3.** The desktop is free and the data is not hostage.

### Where we lose

**Unlimited vs 100 GB, in the sales conversation.** We will lose deals on this
line alone, regardless of whether the prospect would ever have used 100 GB.
"Unlimited" ends the conversation; "100 GB, and contact us if you need more"
starts an uncomfortable one.

**No expansion path at all.** `storage_cap_bytes` is a per-account column, so
raising a cap is a manual DB update. The pricing FAQ promises "contact us and we
will sort out a larger tier" — a promise with no product behind it. Every such
conversation costs a human.

**E2EE forecloses a whole feature category.** We cannot thumbnail, transcode,
search, or AI-tag server-side, ever. CompanyCam ships AI actions in their trial.
On-device Vision can recover some of this, but it is meaningfully harder and
will not match. This is permanent, not deferred — worth being honest about
internally.

**No sharing links.** GCs, inspectors, and adjusters expect a URL. E2EE means
device-side export only. Correct trade, real friction.

**No GPS.** Deliberately removed in migration 0013 — a coordinate the server can
read is a jobsite address in the clear. Defensible, but prospects will ask, and
plan pins (Tier 1 item 3) are the only honest answer. Ship them.

**Feature depth.** Annotation, captions, checklists, video, PDF photo reports,
integrations — all shipped on their side, all roadmap on ours.

**Maturity.** They are a known quantity with an App Store listing. We have a
sideload that expires in 7 days.

---

## 3. The cap, with real numbers

### 3a. We are burning the cap 4–8× faster than necessary

`ios/BidSheetField/Views/JobDetailView.swift:262`:

```swift
guard let jpeg = image.jpegData(compressionQuality: 0.8) else { return }
```

That is quality 0.8 applied to the **full-resolution original** with no
downscale. A modern 24 MP iPhone capture of a high-entropy jobsite scene (dirt,
gravel, foliage — everything JPEG compresses badly) lands around 4–8 MB. Call it
5 MB.

At 5 MB/photo, 100 GB is ~20,000 photos, shared with plan sets and the DB
backup. Against realistic crew burn rates (25 photos/day, 250 working days):

| Crews | Photos/yr | GB/yr @ 5 MB | Cap hit in |
|---|---|---|---|
| 1 | 6,250 | 31 GB | ~3.2 years |
| 3 | 18,750 | 94 GB | **~13 months** |
| 5 | 31,250 | 156 GB | **~8 months** |

Resize the long edge on capture and the picture changes completely:

| Long edge | ~Size | Photos in 100 GB | 5 crews last |
|---|---|---|---|
| Native (today) | 5 MB | 20,000 | 8 months |
| 3200 px | 1.2 MB | 85,000 | ~2.7 years |
| 2048 px | 600 KB | 170,000 | **5+ years** |

3200 px keeps station markings, pipe labels, and crack widths legible for
as-built evidence while recovering 4× the cap. **This is one line of Swift and
it is the single cheapest fix to the problem as stated.**

### 3b. Compression immediately exposes a second cap

`bidsheet-cloud/src/index.js:65` sets `MAX_FILES_PER_ACCOUNT = 100000`. At
600 KB/photo that binds at **60 GB** — before the byte cap. Any compression work
must raise the file-count cap in the same change, or we trade one wall for a
nearer one.

### 3c. The cap leaks

Platform audit F21 describes the filename-flip loop re-uploading the same plan
PDF to alternating opaque R2 keys forever. Those orphans are never deleted and
**still count against `storage_bytes_used`**. Accounts can lose cap to a bug
with no way to see it or reclaim it. There is no orphan sweep.

### 3d. Hitting the cap fails badly in the field

Over the cap, uploads get 507 (`index.js:20-23`). On the phone the message is
`CloudAPI.swift:119`:

> "Cloud storage is full. Free space from BidSheet on your computer."

The crew member in the trench cannot act on that. Photos queue locally
(`FileCache.savePendingPhoto`) and the queue stops at the first failure — so it
grows until the *phone* fills. The only remedy is someone at a desktop turning
off sync for old jobs (`CloudSyncCard.tsx:219`). A storage cap should degrade
into a phone call, not into a crew that silently stops being able to document
work.

---

## 4. Why they can offer unlimited and we cannot

Storage cost is driven by **the number of cameras**. CompanyCam charges **per
camera**, so revenue and cost scale together — a 10-person crew pays $290/mo and
can absorb multiple TB. We charge **per account**, so a one-man shop and a
20-person crew both pay $20 while generating 20× different load. Our pricing
axis is decoupled from our cost driver. That is the whole story, and no amount
of infrastructure efficiency fixes it.

Against $20/mo (≈$18.50 net after Paddle):

| Stored | R2 cost | % of net |
|---|---|---|
| 100 GB | $1.50 | 8% |
| 500 GB | $7.50 | 41% |
| 1 TB | $15.00 | **81%** |

So "just make it unlimited" is not available to us at $20 flat. Two viable moves:

**Cheap: a storage add-on.** $10/mo per +250 GB (costs $3.75, ~62% margin), or
metered at $0.05/GB-month over 100 GB. Turns a lost deal and a manual DB edit
into revenue. `storage_cap_bytes` is already per-account, so the only real work
is a second Paddle price and webhook handling.

**Correct: charge for field seats.** $20 base (office/desktop, unchanged) plus
~$5/field-member/mo, each field seat carrying +100 GB. A five-person crew pays
$45/mo — **still 3× cheaper than CompanyCam's $145** — and the 600 GB
entitlement costs us $9/mo. Cost and revenue finally scale on the same axis, and
we can then say "effectively unlimited for a normal crew" and mean it.

Both preserve the story that the desktop estimating app is free forever.

---

## 5. Recommendation

**Do not position BidSheet Field as "premier site picture taking software."**
On that framing CompanyCam wins on storage, platforms, features, maturity, and
sharing, and our best case is a cheaper imitation. We would be fighting on the
one axis where their pricing model beats ours by construction.

Position it as **the estimator's plan and takeoff in the crew's pocket, with the
crew's reality flowing back into the next bid.** Photos are evidence attached to
a bid, not a photo library. On that framing CompanyCam is not a competitor and
the 100 GB cap stops being the headline — nobody asks a takeoff tool for
unlimited photo storage.

In order:

1. **Resize on capture** (`JobDetailView.swift:262`) — 4–8× the effective cap
   for one line. Raise `MAX_FILES_PER_ACCOUNT` in the same change.
2. **Ship the desktop photo gallery** (Phase 5b / C4). One-way photos make the
   product incoherent regardless of how much storage we sell.
3. **Plan pins** (Tier 1 item 3) — the actual differentiator, and our honest
   answer to the GPS question.
4. **Storage add-on tier**, then reprice around field seats.
5. **Client-side thumbnails** at capture, uploaded as a second sealed object.
   E2EE means we cannot thumbnail server-side, and the photo grid currently
   downloads full JPEGs over cell.
6. **App Store listing.** Everything above is theoretical until a crew can
   install the app.

# Bid Management Competitive Analysis — HeavyBid & the Field vs. BidSheet

*Research date: 2026-06-28. Updated 2026-07-17 (added §4.6 job document
management and roadmap item 5). Audience: BidSheet product/engineering.*

> **Companion doc:** Methvin and STACK — the two products this one leaves as a
> single table row and a blank — are covered in `bidsheet-cloud` →
> `docs/methvin-stack-analysis.md` (2026-07-30). It lives cloud-side because its
> conclusion about the pay-item/resource split touches the sync snapshot
> contract.

This document contrasts the bid-management feature set of **HCSS HeavyBid** and the
broader heavy-civil estimating market against **what BidSheet actually does today
in code** — not what the README advertises, but what is wired up and working. It
then identifies the gaps worth closing and the advantages worth protecting.

> **Sourcing note.** Competitor facts come from vendor pages and third-party
> reviews (HCSS help/blog, Trimble/B2W, InEight, Sage, RIB, TCLI, SharpeSoft,
> AGTEK, Capterra/G2/SoftwareAdvice, ENR). Many vendor sites block automated
> fetching, so some details are triangulated from search extracts and are flagged
> where single-sourced. BidSheet facts are grounded in the repository (file paths
> cited inline) and are authoritative.

---

## 1. BidSheet today — actual capabilities (code-verified)

BidSheet is a **single-user, local-first Electron + SQLite desktop app** (Windows/
Linux), GPLv3, free, with an optional **$20/mo cloud backup/sync** beta. Target
market: **underground-utility subcontractors** (water, sewer, storm, civil).

**What genuinely works:**

| Area | Actual capability | Where |
|---|---|---|
| **Material catalog** | Categories, fuzzy-search aliases, price history, TON↔CY density conversion | `database.ts` (materials, material_categories, price_updates) |
| **Labor** | Labor roles with hourly rate + burden multiplier | `labor_roles` |
| **Crews** | Crew templates = roles × quantity | `crew_templates`, `crew_members` |
| **Production rates** | Per-crew, per-unit production rate (units/hr) | `production_rates` |
| **Equipment** | Owned/rented, hourly/daily/mobilization/fuel cost | `equipment` |
| **Assemblies** | Material bundles **plus** optional crew + production rate + equipment hours/unit | `assemblies`, `assembly_items` |
| **Estimate structure** | Job → sections → line items; sections can be **alternates** with markup overrides | `bid_sections`, `bid_line_items` |
| **Line-item cost** | material = qty×unit; labor = hrs×rate; equipment = hrs×rate; **one** sub lump sum | `shared/lineItemCost.ts` |
| **Markups** | Job-level **overhead %, profit %, bond %, tax %, material escalation %**; per-section overrides; alternates priced independently | `shared/bidCalc.ts` |
| **Cost codes** | `cost_code` + `item_number` per line; roll-up report with % of total | `CostCodeReportModal.tsx` |
| **Sub/supplier quotes** | Per scope: vendor, contact, amount, date, notes; **one winner per scope**; send winner to bid | `ipc/quotes.ts`, `QuotesTab.tsx` |
| **Change orders** | Child jobs linked to a parent, with CO numbers | `jobs` (parent_job_id) |
| **Plan takeoff** | **Built-in** PDF viewer, per-page scale calibration, page rotation, pipe runs (with invert/rim elevations & structure types), surface-restoration areas (cut/fill/finished-elev grade modes), walls, TIN surfaces, annotations (text/arrow/cloud), node snapping, marquee multi-select, undo/redo, send-to-bid, CSV export | `modules/underground/plan-takeoff/*` (44 files) |
| **Trench profiling** | Excavation/bedding/backfill volumes, pipe/bedding/backfill materials, convert to bid line items | Job **Profiles** tab (`TrenchProfileList.tsx`, `trench_profiles`) |
| **Concrete calc** | Slab/volume calculator module | `modules/concrete/*` |
| **Exports** | Customizable **proposal PDF**, **QuickBooks CSV**, **unit-price schedule CSV** (markups folded into unit sell prices), **cost-code report**, takeoff CSV | `ipc/export.ts`, `csv-export.ts` |
| **What-if** | Side-by-side job comparison; duplicate a job as a starting point | `CompareJobsModal.tsx`, `jobs:duplicate` |
| **Pricing intake** | CSV price-sheet import with fuzzy matching to catalog | `ipc/price-import.ts`, `shared/quoteMatching.ts` |
| **Dashboard** | Active drafts, bids submitted, total bid volume, **win rate (W/L)**, recent jobs w/ urgency | `Dashboard.tsx` |
| **Cloud (beta)** | Cloudflare Worker + R2 + D1; Supabase auth w/ **MFA**; **client-side E2EE** whole-DB backup; account-wide catalog sync; per-job sync; Paddle billing; storage/abuse caps | `bidsheet-cloud/`, `src/main/cloud/*` |
| **Ops** | Setup wizard, walkthrough, backup/restore, auto-update, bid lock | `SetupWizard.tsx`, `updater.ts` |

**"Claimed but not as advertised":**

- **Standalone Trench Profiler is disabled.** `modules/underground/manifest.ts` ships
  `tools: []` with the comment *"Trench Profiler is temporarily disabled while it
  gets more polish."* The README touts a "Trench profiler" — it **does** work, but
  only inside a job's **Profiles** tab, not as the sidebar tool implied. Either
  re-enable it or adjust the README so the two agree.
- **Cloud sync is backup/replication, not collaboration.** It is whole-DB encrypted
  backup + last-writer catalog/job snapshots, single-user per account
  (`account_members` exists but "invites/extra seats come in a later phase" per the
  cloud README). It is **not** multi-estimator concurrent editing.
- **The cost engine is a single flat markup.** There is exactly one markup pass
  (`computeBidSummary` in `bidCalc.ts`): OH/profit/bond as a flat % of direct cost,
  tax on material, escalation on material. There is **no markup spreading, no
  indirect-cost pool, no per-cost-type markup, no bid balancing.** The unit-price
  CSV folds markup into unit prices on export, but the user can't interactively
  shape unit prices on bid day.

---

## 2. How the category actually works (HeavyBid as the reference model)

HeavyBid is the heavy-civil standard ("50,000+ estimators," projects $50K–$1B+,
$25K–$200K+/yr). Its model is the yardstick the rest of the market is measured by.

**Estimating model — three levels: Bid Item → Activity → Resource.**
- A **bid item** is a client pay item (or a holding/header/subtotal line).
- An **activity** is a unit of work carrying cost; a bid item holds many activities.
- A **resource** is labor/equipment/material/sub at the lowest level.
- Activities are **production-rate driven**: you enter a production type + rate and
  HeavyBid computes crew hours (Crew Hours = Quantity ÷ Production Rate), via **nine
  productivity factors** (units/hr, hrs/unit, units/shift, etc.) tied to calendars
  and work rules. ([help.hcss.com Estimate Entry], [ewksol productivity factors])

**Cost libraries / Master Estimate.** A company-wide **Master Estimate** plus
**codebooks** (bid-item, activity, material, equipment) — HCSS ships a library of
**4,500+ crews & production rates**, integrates RSMeans, and **refreshes costs from
actual field production** pulled back from HeavyJob. ([heavycivildata.com], [hcss.com/estimating])

**Bid-day / final pricing — the crown jewel.** A central **Bid Pricing** screen:
- markup as % **per cost type** (labor vs. material vs. equipment) + overhead/profit;
- **indirect-cost folders** (mobilization, bonds, trailers) spread across items
  **evenly / proportionally / manually** via Spread Instructions & overrides;
- **balancing/unbalancing** unit prices to front-load cash flow or meet owner rules;
- **plus/minus adjustments**, **component pricing**, **addons/pass-throughs**;
- live what-if recalculation. ([help.hcss.com Bid Pricing / Spread Instructions])

**Quote management — full lifecycle.** Quote **folders** by scope/estimator;
side-by-side **leveling**; **self-perform vs. sub** analysis; **RFQ generation** to a
vendor database with response tracking; auto-update when quantities change;
RFQ → subcontract → PO. ([hcss.com/products/quote-management])

**DOT / electronic bidding.** Direct **bid-item import** from state DOTs and
**round-trip export** to **AASHTOWare, PennDOT ECMS, UDOT, iCX, Bid Express**.
([hcss.com/products/unit-price-bidding])

**Reporting / intelligence.** Cost reports at item/activity/resource level;
cost-code rollups into HeavyJob; **HCSS Insights** (Power BI); **Pre-Construction**
go/no-go, **win-probability / bid-to-hit ratio**, benchmarking vs. similar jobs.

**Collaboration.** Web HeavyBid (2026) brings **simultaneous multi-user** editing,
audit trails, and **JV estimating up to 25 estimators on one bid**.

**Integrations.** Bidirectional **HeavyJob** (field/job-cost feedback loop), 30+
accounting/ERP connectors, bidirectional **P6 / MS Project**, **AGTEK** takeoff, open APIs.

---

## 3. The competitive landscape (where BidSheet sits)

| Tier | Tools | Estimating model | Takeoff | DOT e-bid | Cloud/multi-user | Price |
|---|---|---|---|---|---|---|
| **Enterprise heavy-civil** | HeavyBid, B2W Estimate, InEight | Activity/crew + production rates; spreading; risk (InEight) | Via AGTEK/partners | **Yes** | Cloud transition; multi-user | $25K–$200K+/yr |
| **Mid heavy-civil** | Trimble Quest, RIB Candy | First-principles resource-based (+planning/cash-flow in Candy) | Quest/Candy QTO | Quest some; Candy no US-DOT | Desktop/DaaS | ~$1K–$5K/yr |
| **Small/value heavy-civil** ← *BidSheet's real peers* | **TCLI Estimating Link, SharpeSoft Estimator** | Cost/resource, per-cost-type markup, sub-quote compare | Light/none | **Yes** (TCLI: AASHTOWare/iCX; SharpeSoft: DOT item import) | TCLI cloud option | **TCLI ~$166/mo**; SharpeSoft quote |
| **Commercial/general** | Sage Estimating, ProEst, STACK, Procore Est. | Cost-database + assemblies (RSMeans) | 2D, some 3D | No | Sage on-prem; others cloud | $2.6K–$8K+/yr |
| **Takeoff specialists** | AGTEK, InSite Elevation Pro, Carlson, Trimble BC | Takeoff only (true 3D cut/fill, mass-haul, trench) | **Best-in-class** | No | Desktop + mobile | $7K+/yr |
| **AI-native / emerging** | Beam AI, Kreo, Togal, Autodesk Takeoff | AI takeoff/bid-support | AI auto-takeoff | No | Cloud | varies |

**The key positioning insight:** BidSheet is **not** competing with HeavyBid's
$200K enterprise tier and shouldn't try to clone it. Its real comparables are
**TCLI Estimating Link** and **SharpeSoft** at the bottom of the heavy-civil market,
plus general cloud tools (STACK). Against *those*, BidSheet is uniquely **free,
local-first, underground-specialized, with built-in takeoff** — but is missing
several **table-stakes** bid-management features that even the cheap tools have.

---

## 4. Gap analysis

Features classified as **[Table-stakes]** (near-universal in serious bid tools and
expected by utility subs), **[Differentiator]** (advanced; would set BidSheet apart),
or **[Fix]** (already in BidSheet but broken/weak/misadvertised).

### 4.1 Bid-day & final pricing — the biggest functional gap

- **[Table-stakes] Markup spreading to unit prices.** Every bid tool from TCLI up
  lets you push overhead/indirects/profit onto unit prices (evenly, proportionally,
  or manually) so the *cost is hidden* and the *unit prices the owner sees* are
  yours to shape. BidSheet only folds markup at CSV-export time
  (`ipc/export.ts` unit-price export) — there is no interactive bid-day screen.
- **[Table-stakes] Indirect-cost / general-conditions pool.** A place for
  mobilization, bonds, traffic control, trailers, superintendent time, dewatering —
  costs that aren't per-line-item — to be entered once and distributed. BidSheet has
  no concept of indirect costs; bond is a flat % and everything else must be faked
  as a line item.
- **[Table-stakes] Per-cost-type markup.** Different margin on labor vs. material
  vs. equipment vs. sub. BidSheet applies one OH% and one profit% to total direct
  cost (`bidCalc.ts`).
- **[Differentiator] Bid balancing / unbalancing.** Front-load early pay items for
  cash flow. Advanced, but a real competitive edge for utility subs on unit-price work.
- **[Table-stakes] Last-minute "what's my number" bid-day view.** A live
  cost-vs-price / margin summary you watch as quotes land in the final hour.
  BidSheet has the summary math but no bid-day-oriented screen.

### 4.2 Subcontractor / supplier quote management — shallow

BidSheet's quotes are a flat list (scope, vendor, amount, one winner — `ipc/quotes.ts`).
Missing vs. the field:

- **[Table-stakes] Side-by-side quote leveling.** Compare multiple vendors for the
  same scope on one screen with scope inclusions/exclusions, not just "lowest wins."
- **[Table-stakes] Self-perform vs. sub comparison.** Put your own crew+equipment
  estimate next to incoming sub quotes — central to utility subs deciding what to sub
  out (boring, paving, traffic control).
- **[Table-stakes] RFQ generation & tracking.** Email quote requests scoped to bid
  items; track who was solicited / responded. (SharpeSoft and HeavyBid both do this.)
- **[Differentiator] Vendor database** with history (BidSheet stores vendor as free
  text per quote — no reusable vendor list).
- **[Differentiator] Quote line-item import.** `raw_quote_lines`/`quote_aliases`
  tables exist for price-sheet matching — extend that to ingest a supplier's quote
  PDF/CSV and auto-map to scopes.

### 4.3 DOT / public-agency bidding — absent (decide if in scope)

- **[Table-stakes for DOT subs] DOT bid-item import.** Pull the pay-item schedule
  from a state DOT/owner file (CSV/Excel at minimum) to seed sections + line items
  instead of retyping. This is the single highest-leverage DOT feature and is *not*
  hard — even an Excel/CSV "import bid schedule" covers most small subs.
- **[Differentiator] Electronic bid export** (AASHTOWare Project Bids / Bid Express
  formats). High effort, narrow audience — most BidSheet users are subs to a prime,
  not the prime submitting to the DOT. Recommend **deferring** the full e-bid
  submission and doing **bid-schedule import** first.
- *Note:* unit-price schedule export already exists, which is the sub-facing half.

### 4.4 Cost model depth

- **[Differentiator] Multiple resources per line / activity model.** A BidSheet line
  carries exactly one material + one crew + one equipment + one sub
  (`bid_line_items`). Real utility work (e.g., "install 8" PVC") is pipe + bedding +
  backfill + fittings + crew + excavator + compactor. **Assemblies are the existing
  escape hatch** (they bundle materials + a crew + equipment) — leaning harder on
  assemblies, and letting a line expand from an assembly with multiple resources, is
  the pragmatic path rather than a full activity rewrite.
- **[Differentiator] Reusable cross-job estimate templates.** Assemblies cover
  component bundles, but there's no "master estimate" / saved bid skeleton beyond
  *duplicate a whole job*. A library of standard sections (e.g., "8" sanitary
  sewer package") would speed repeat bidders.
- **[Differentiator] Production rate by condition / depth.** `production_rates` has a
  `conditions` text field but rates aren't selected by depth bracket or soil — the
  one thing underground estimators most want to vary. (AGTEK Underground brackets
  trench by depth; BidSheet's trench profiler knows depth — connect the two.)

### 4.5 Reporting & analytics — minimal

- **[Table-stakes] Bid analysis / cost-vs-price summary report** beyond the
  cost-code rollup: labor hours total, crew-day count, equipment hours,
  $/LF by pipe size, margin by section.
- **[Differentiator] Win/loss intelligence.** Dashboard shows a raw win rate
  (`Dashboard.tsx`); there's no breakdown by client, work type, estimator, or
  bid-size, and no captured *bid vs. actual award* spread. The data model
  (`jobs.status`) already supports this — it's a reporting build.
- **[Differentiator] Historical production feedback loop.** No actuals come back from
  the field (BidSheet has no field/job-cost product). A lightweight "enter actual
  production for this job" capture would let crews tune `production_rates` over time —
  a poor-man's version of the HeavyBid↔HeavyJob loop.

### 4.6 Job document management — absent (added 2026-07-17)

Enterprise suites treat the estimate as one artifact among many on a job:
plans, addenda, geotech reports, sub quote PDFs, photos, specs, and signed
proposals live alongside the bid (HeavyBid via HCSS Plans; commercial tools
via cloud project folders). BidSheet has no per-job file story at all:

- **[Table-stakes] Per-job document storage.** The only file a job references
  is the takeoff plan, stored as an *absolute path* to wherever the user
  picked it (`takeoff_job_settings.pdf_path`) — move or rename the file, or
  open the DB on a second machine, and the takeoff silently loses its plan.
  Everything else (addenda, quotes, geotech, photos, contracts) lives outside
  the app entirely. Fix: a `job_documents` table + an app-managed store under
  `userData/job-files/<job-uuid>/` (files **copied in** on attach, never
  path-referenced), surfaced as a **Documents tab** in `JobDetail` with
  categories (plans/quotes/specs/photos/contracts), sorting, drag-and-drop,
  and open-in-OS. Migrating the takeoff plan into the managed store retires
  the fragile `pdf_path` for free.
- **[Differentiator] E2EE document sync.** The infrastructure mostly exists:
  the cloud worker's R2 key convention is already
  `accountId/jobId/<photos|plans|markup|job>/<filename>` with an unused
  `photos` folder type, per-file caps, and storage-cap accounting
  (`bidsheet-cloud/src/index.js`), and the desktop sync engine already
  content-addresses, encrypts, and de-duplicates the plan PDF
  (`sync-engine.ts`). Generalizing "one plan per job" to "N documents per
  job" is incremental — and end-to-end-encrypted job files are something no
  competitor at this price point offers.
- *Caveat:* documents live outside SQLite, so the whole-DB encrypted backup
  (`backup.ts`) will not include them; per-job sync covers them instead, and
  the UI should say so.

### 4.7 Collaboration

- **[Differentiator] Multi-estimator / multi-seat.** Cloud is single-user backup
  today (`account_members` stubbed for "a later phase"). True concurrent editing is a
  large lift and arguably *not* needed for one-or-two-person utility shops — **low
  priority** relative to bid-day tools. Multi-*device* for one user (already the cloud
  sync goal) matters more.

### 4.8 Fixes to existing, advertised features

- **[Fix] Re-enable or re-document the Trench Profiler.** `manifest.ts` `tools: []`.
- **[Fix] Reconcile README ↔ reality** for cloud "sync" (it's backup + snapshot
  replication, not live collaboration) so users aren't surprised.

---

## 5. BidSheet's genuine advantages (protect & lean in)

1. **Built-in plan takeoff.** This is a real moat. **HeavyBid has no native
   takeoff** — it depends on AGTEK ($7K+/yr) or HCSS Plans. BidSheet ships PDF
   takeoff, scale calibration, pipe runs with invert/rim elevations, area/wall/
   surface measurement, and send-to-bid **for free, in one app**. Most cheap
   competitors (TCLI, SharpeSoft) have little/no takeoff. **This is the headline.**
2. **Underground/utility specialization.** Trench profiling with bedding/backfill
   volumes, depth-aware surfaces, structure types (MH/CO), and a seeded
   water/sewer/storm catalog — out of the box. Generalist tools require building all
   of this.
3. **Free + local-first + private.** No subscription to estimate; data lives on the
   user's machine; cloud backup is **end-to-end encrypted** (server can't read bids).
   That's a credible differentiator against $166/mo–$200K/yr incumbents and a real
   trust story.
4. **Single calc source of truth.** `shared/bidCalc.ts` / `lineItemCost.ts` keep UI,
   PDF, and CSV in agreement — a clean base to extend the cost engine on.

---

## 6. Recommendation — prioritized roadmap

Ordered by **value to a small utility sub ÷ effort**, grounded in what BidSheet can
realistically build on its current schema.

### Now (table-stakes that close the most painful gaps)
1. **Bid-day pricing screen with markup spreading + indirect-cost pool.** One screen:
   enter indirects (mobilization, bond, traffic control, etc.), choose spread method,
   watch live cost-vs-price/margin, and shape unit prices. *Biggest single win;
   builds directly on `bidCalc.ts`.*
2. **Quote leveling + self-perform-vs-sub.** Upgrade `QuotesTab` from a flat list to
   side-by-side comparison per scope, with a column for the in-house estimate.
3. **Bid-schedule import (CSV/Excel).** Seed sections/line items from an owner's pay-
   item list. Reuses the existing CSV/fuzzy-match infrastructure (`price-import.ts`).
4. **Fix the Trench Profiler / README mismatch.**

### Next (differentiators that build on BidSheet's strengths)
5. **Per-job document storage** (Documents tab + managed local store, §4.6), then
   extend per-job cloud sync to cover documents — E2EE job files at $20/mo is a
   real differentiator, and the takeoff-plan path fragility gets fixed as a
   side effect. *(added 2026-07-17)*
6. **Reusable estimate/section templates** (a "master assembly library" of standard
   utility packages), and **multi-resource line expansion** from assemblies.
7. **Depth-/condition-based production rates**, wired to the trench profiler's known
   depths.
8. **Vendor database + RFQ generation/tracking.**
9. **Bid-analysis reports** (labor hrs, crew-days, $/LF by size) and **win/loss
   breakdowns** by client/work-type/estimator.

### Later (high effort or narrow audience)
10. **Bid balancing/unbalancing** for unit-price cash-flow strategy.
11. **Actual-production capture** (lightweight field feedback loop) to tune rates.
12. **Electronic DOT bid submission** (AASHTOWare/Bid Express) — only if a meaningful
    share of users are primes, which today they are not.
13. **Multi-estimator concurrent editing** — large lift, limited demand for 1–2-person shops.

### Explicitly *don't* build
- A full HeavyBid-style activity/codebook rewrite. BidSheet's assembly model + a
  better bid-day screen gets ~80% of the value at a fraction of the cost and keeps
  the app approachable — which is the whole point.

---

## Appendix — selected sources

HCSS HeavyBid: hcss.com/products/construction-estimating-software, /unit-price-bidding,
/quote-management, /pre-construction, /products/hcss-insights; help.hcss.com tutorials
(Estimate Entry, Bid Pricing, Spread Instructions, Editions); ewksol.com (HeavyBid &
Beyond). B2W Estimate: trimble.com/en/products/b2w-software/estimate. InEight Estimate:
ineight.com/products/ineight-estimate (built-in benchmarking, Monte Carlo). Sage
Estimating + BidMatrix: sage.com/en-us/products/sage-estimating. RIB Candy:
rib-software.com/en/rib-candy. TCLI Estimating Link: tcli.com (utility-estimating-
software, pricing, cloud-link). SharpeSoft: sharpesoft.com. AGTEK: agtek.com
(products/underground, /gradework). InSite: insitesoftware.com. Carlson:
carlsonsw.com/product/carlson-takeoff. ProEst: construction.autodesk.com/products/proest.
STACK: stackct.com. Beam AI: ibeam.ai. DOT e-bidding: aashtowareproject.org/bids,
infotechinc.com. Reviews/aggregators: capterra.com, g2.com, softwareadvice.com,
selecthub.com, itqlick.com, softwareconnect.com. M&A: enr.com (Nemetschek–HCSS $2.4B,
2026). *Several vendor pages block automated fetching; single-sourced or third-party-
estimate items (notably pricing) are flagged in the body.*

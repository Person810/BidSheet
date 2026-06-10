# BidSheet Competitive Review

**Date:** 2026-06-10
**Goal:** Identify what BidSheet needs to equal or exceed paid takeoff and quoting software for its target user — an underground utility subcontractor estimating water, sewer, storm, and civil work.

Benchmarks used: PlanSwift, STACK, and Bluebeam Revu (takeoff); HCSS HeavyBid and similar (estimating/quoting).

---

## Where BidSheet already competes

These are genuinely competitive today, and a few are *better* than generic paid tools because they are trade-specific:

| Capability | Notes |
|---|---|
| Linear pipe run takeoff | Polyline runs with per-segment footage callouts, rubber-band preview, utility-type color coding |
| **Trench volume automation** | Excavation/bedding/backfill CY computed from pipe size, depth, grade, and trench width — PlanSwift/STACK need plugins or manual assemblies for this |
| **Shared junction nodes** | Manholes/cleanouts as cross-run anchors with rim/invert elevations and auto-grade calc — most generic tools have nothing comparable |
| Count items | Material-aware fitting/valve picker with pipe-size context filtering |
| Per-page scale calibration | Two-point or preset scales, per page |
| Takeoff → estimate flow | Runs → trench profiles → bid; items → bid sections |
| Crew-based labor costing | Crew templates, burden multipliers, production rates |
| Markup engine | Overhead/profit/bond on direct cost, tax on materials, single source of truth (`bidCalc.ts`) |
| Change orders | Parent/child jobs with revised-total rollup |
| Proposal output | GC-ready PDF, print, QuickBooks CSV |
| Win/loss tracking | Status pipeline + dashboard win rate |
| Price + offline + ownership | Free, GPL, fully local data — no subscription, no cloud lock-in |

## Gaps closed in this change

| Gap (vs paid tools) | What was added |
|---|---|
| **No area measurement** — the biggest single takeoff gap; underground work always carries surface restoration (asphalt/concrete patch, gravel, seeding) | Polygon **Add Area** tool: click-to-draw with live SF/SY preview, surface type + depth config, per-page persistence, edit/delete via context menu, SF/SY/CY/perimeter in the summary panel |
| No takeoff → bid path for restoration quantities | **Send Areas to Bid** creates a "Surface Restoration" section grouped by surface type + depth, quantities in SY, catalog pricing when the linked material is priced per SY |
| No layer control on busy plan sheets | **Layers** dropdown toggles visibility per utility type, count items, and areas |
| No takeoff reporting | **Export CSV** produces a quantity report: pipe runs with trench volumes, count items grouped by material, measured areas with volumes |
| Completed shapes swallowed clicks during drawing/calibration | Shapes are now non-interactive while any drawing or calibration is in progress |

## Tier 1 gaps — closed

| Gap | What was added |
|---|---|
| No undo/redo beyond in-progress drawing | Full snapshot-based undo/redo (Ctrl+Z / Ctrl+Y, toolbar buttons) across run/item/node/area mutations, restored transactionally to SQLite with entity IDs preserved |
| No page rotation | Per-page 90° rotation, persisted, with overlay coordinates kept in the unrotated frame so drawings stay put |
| No bid alternates | Sections can be flagged as alternates: excluded from base bid totals, priced independently with their own markups, shown as "Add Alternate" lines in the grid and an Add Alternates block on the proposal PDF; excluded from QuickBooks export |
| Global-only markups | Per-section overhead/profit/bond overrides (blank = job default), applied in one shared calculation used by the UI, PDF, and CSV exports |
| No takeoff visibility on the bid | Takeoff summary card on the job estimate tab: LF by utility, item counts, restoration SY, and uncalibrated-page warnings |

## Tier 2 gaps — closed

| Gap | What was added |
|---|---|
| No quote management | Quotes tab per job: competing quotes grouped by scope with lowest-quote flagging, one selectable winner per scope, and one-click "Send to Bid" creating subcontractor line items |
| No unit price schedules | Owner item numbers on line items plus a Unit Price Schedule CSV export that folds overhead/profit/bond/escalation/tax into each line's unit sell price (DOT/municipal bid-form style), with alternates in their own block |
| No cost codes | Cost-code field on line items, shown in the grid, with a Cost Code Summary report (direct cost by material/labor/equipment/sub per code, % of direct) and CSV export |
| Material-only assemblies | Assemblies can carry a labor component (production rate + crew, burdened) and an equipment component (machine + hours per unit); expansion into the bid scales all of it by quantity |
| No assembly-driven takeoff | Measured areas can link an assembly; Send Areas to Bid expands the full assembly (materials + labor + equipment) per measured SY |
| No escalation | Job-level material escalation %: raises material direct cost before markups, taxed like the materials it represents, shown on the grid/PDF/exports; job markups are now also editable per job (previously creation-time only) |

## Remaining gaps, prioritized

### Tier 3 — parity items, lower urgency for the trade

- Annotation/markup tools (text, arrows, clouds) on plan sheets
- Multi-select and bulk edit of takeoff objects
- Scenario comparison (what-if duplicate with delta view)
- OCR/auto-count of repeated symbols
- Mobile/web access and multi-user collaboration (an architectural decision, not a feature)

## Positioning

BidSheet should not chase generic-takeoff feature parity item by item. Its edge is **trade depth**: trench math, junction elevations, restoration areas, and crew-based costing in one tool, free and local. Paid generic tools make underground estimators assemble that themselves. With Tiers 1 and 2 closed, BidSheet covers the estimating workflow end to end — takeoff through unit-price bid forms, quote management, and cost-code reporting; what remains in Tier 3 is generic-tool polish, not trade capability.

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

## Remaining gaps, prioritized

### Tier 1 — highest value per effort (do next)

1. **Full undo/redo history** in takeoff. Today only the in-progress run/area supports point-by-point undo. A command stack over run/item/area mutations (the persistence layer already funnels through a few manager hooks) would match a core expectation from every paid tool.
2. **Page rotation** in the PDF viewer. Plan sets routinely arrive rotated; pdf.js supports a rotation parameter — the work is keeping overlay coordinates consistent.
3. **Bid alternates / base-bid + add-alt.** Public and DOT work requires it. Model: flag sections as alternates, exclude from base totals, show separately on the proposal PDF.
4. **Per-section markup overrides.** HeavyBid users expect markup by trade/department; a nullable per-section override of the job percentages is a small schema change with high perceived value.
5. **Takeoff summary on the proposal/bid page.** Surface measured quantities (LF by utility, restoration SY) on the job detail page so the estimator can sanity-check the bid against the takeoff.

### Tier 2 — strong differentiators

6. **Subcontractor/supplier quote tracking** — record competing quotes per scope, pick a winner, flow into line items.
7. **Unit price schedules** — bid forms with owner-supplied line numbers and units (DOT/municipal work), exportable in the owner's format.
8. **Cost-code roll-ups and bid-to-actual** — even a simple cost-code field per line item plus a roll-up report opens the door to job costing.
9. **Assembly-driven takeoff** — let a measured run/area expand a full assembly (pipe + bedding + labor production rate + equipment) instead of material-only line items.
10. **Material price escalation** — date-based escalation percentage for long-lead bids.

### Tier 3 — parity items, lower urgency for the trade

- Annotation/markup tools (text, arrows, clouds) on plan sheets
- Multi-select and bulk edit of takeoff objects
- Scenario comparison (what-if duplicate with delta view)
- OCR/auto-count of repeated symbols
- Mobile/web access and multi-user collaboration (an architectural decision, not a feature)

## Positioning

BidSheet should not chase generic-takeoff feature parity item by item. Its edge is **trade depth**: trench math, junction elevations, restoration areas, and crew-based costing in one tool, free and local. Paid generic tools make underground estimators assemble that themselves. Tier 1 above keeps that edge while removing the gaps a paying user would notice in the first week.

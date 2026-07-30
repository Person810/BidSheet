# Methvin & STACK vs. BidSheet — public-materials pass

*Research date: 2026-07-30. Audience: BidSheet product/engineering.
Companion to `bid-management-competitive-analysis.md`, which covers HeavyBid and
the heavy-civil field. That document mentions STACK once in a table and never
mentions Methvin; this one fills both in.*

> **Sourcing note — read this before quoting anything here.** Both vendors block
> automated fetching (`methvin.org`, `methvin.us`, `stackct.com`,
> `support.stackct.com`, and `help-preconstruction.stackct.com` all returned 403
> to both WebFetch and curl). Everything below about the two products is
> triangulated from search-result extracts of vendor pages and from third-party
> review sites (Capterra, G2, SoftwareAdvice, SelectHub, SoftwareFinder). Feature
> *names* are quoted from vendor copy and are reliable; feature *semantics* are
> inferred and should be treated as hypotheses to confirm in the hands-on
> session (§6). BidSheet facts are code-grounded with file paths and are
> authoritative.

---

## 1. Why these two are worth studying

They bracket BidSheet from opposite sides.

- **Methvin** is the closest structural analogue to what BidSheet is trying to
  be: first-principles civil estimating, cheap, with a genuinely free tier. Its
  cost model is *deeper* than BidSheet's in exactly the place BidSheet's is
  thinnest.
- **STACK** is the market-leading cloud takeoff tool whose estimating module is
  admittedly secondary. Its takeoff and plan-management UX is the benchmark, and
  its items/assemblies/formulas layer shows what a mainstream contractor
  actually expects an assembly to do.

Neither targets underground-utility subs specifically. That remains BidSheet's
moat, and nothing below suggests otherwise.

---

## 2. Methvin

**Shape.** Cloud suite (estimating + 2D takeoff + Gantt scheduler + tender
portal), single login, aimed at small contractors and subcontractors. Civil /
engineering lean, AU/NZ origin.

**Plans** — three tiers: **Free (forever)**, **Business ~$27/user/mo**,
**Enterprise ~$179/user/mo**. The free tier is unusually generous: online
estimating, the takeoff tool, the Gantt scheduler, a tender portal, collaboration
with up to 5 users, and 24/7 support. Business adds two apps, up to 10 users, and
SDK integrations (MYOB, Wave, Xero, Workbench, Primavera). Enterprise adds API
access to Oracle, SAP/JDE, Viewpoint.

**Estimating data model — the important part.**

| Concept | What it is |
|---|---|
| **Bill of Quantities (BoQ)** | The estimate spine. Imported from the client's schedule of quantities (CSV/Excel) or built by hand. |
| **Bill item** | A pay item on the BoQ, priced by a **worksheet**. |
| **Worksheet** | The rate build-up for a bill item. Same worksheet logic is used for bill items, assemblies, *and* complex resources — so build-ups copy/paste between all three levels. |
| **Simple resource** | Leaf cost: labour, plant, material, consumables, subcontractor. |
| **Complex resource** | A resource composed of other resources, with **unlimited nesting depth**. This is the first-principles mechanism. |
| **Assembly** | A named grouping that (per their guide) should hold complex resources only. |
| **Global variables** | Project-wide constants (slab thickness, compaction ratio, material density) usable in bill items, assemblies, complex resources, *and* the bill quantity field. Changing one recalculates every linked quantity. |
| **Formula engine** | JavaScript-based; supports if/then logic, custom functions, nested equations. |
| **Resource libraries** | Labour/material/plant rates imported from CSV/Excel, shared across a team, contributed to by every estimator. |

**Takeoff.** PDF, DWG, DXF (vector and raster) with no conversion step. Measurement
types: **count, length, area, wall area, volume, end-area**. Cross-sections at
chainage intervals produce 3D volume profiles from 2D plans, with cut/fill
overlays feeding earthworks quantities. Quantities flow live into the BoQ — no
CSV round-trip, and the bill updates as measurements are added, revised, or
deleted. There is an "Auto Estimate" feature in their what's-new stream.

**Tender portal / procurement.** This is the piece BidSheet has no analogue for.
Publish the client's SoQ out to subcontractors so they price their trades
directly back to you; each addendum to the SoQ is tracked and traced
individually. Incoming quotes land in **procurement packages** — multiple quotes
per package against the same scope — and **subcontractor adjudication** shows a
side-by-side table of price, **variance to the tendered budget line**, scope
**inclusions/exclusions**, and **qualifications**, then pushes the winner
straight into the BoQ without re-keying.

**Reported weaknesses.** Reviews are genuinely split on the UI — a meaningful
minority call it unintuitive with a steep learning curve, especially for users
without a construction background. Recurring complaints: slow performance on
large complex projects, integration gaps, and slow support despite the "24/7"
claim. Takeoff is described as adequate but not for highly complex work — no
automatic curve recognition, no 3D modelling.

---

## 3. STACK

**Shape.** Pure cloud (browser) takeoff + estimating, plus a separate
"Build & Operate" field/PM product. Broad trade coverage, US-centric, ~1,300+
reviews at 4.5/5 on Capterra. Takeoff is the strength; estimating is the
follow-on.

**Plans.** The "free version" is a **trial in disguise**: up to 2 concurrent
projects, **7 days**, 10 takeoffs per project. Paid: Build & Operate from
~$599/yr; **Takeoff & Estimate ~$2,999/yr for 1 user**, ~$2,599/yr each at 2
users, ~$2,199/yr each at 3+. AI features (autocount, AI chat) sit at the
$2,999/yr tier. Per-seat, and reviewers complain about exactly that.

**Estimating data model.**

| Concept | What it is |
|---|---|
| **Item** | The atomic cost row — *not* material-only. An item is a material, equipment, labor, or subcontracting cost, tagged with a **Cost Type** (Crew Hours, Equipment, Labor, Material Costs, …). ~10,000 items ship pre-built, organized by trade. |
| **Assembly** | A bundle of items used together, with **input variables** (coverage rates, waste percentages, layers, depths) and **variable options** — e.g. pick 5/8" vs ½" drywall and the whole assembly re-resolves. |
| **Item formula** | Per-item expression whose job is "convert a **Takeoff Variable** into the **Purchase Unit** of the item." This is the seam between geometry and procurement. |
| **Estimate line fields** | Editable: **Unit Cost**, **Waste %**, **Line Item Markup %**. Plus non-measured costs, markup, and tax at the estimate level. |
| **Reports** | Customizable takeoff and estimating reports; export to Excel/CRM/accounting. |

**Takeoff & plans.** Measurement types: count, linear, area, volume, arc, pitched.
Plan/spec/document management with instant page processing and **plan page
autonaming**, plan search, and **automatic versioning** so crews can't work from
a superseded sheet. **Plan overlay** layers sheets in distinct colors to diff
revisions visually (explicitly visual-only — it does not affect measurements).
Real-time sharing of projects, takeoffs and documents with clients, subs, and
internal team; mobile markup.

**Integrations.** ~15 named: Excel (push takeoff data directly), Procore
(store/markup/measure Procore-managed documents, sync plan updates and addenda),
QuickBooks Online, Sage Intacct (create a STACK project from a Sage project;
export a finished estimate back as a project estimate), Acumatica, Buildertrend,
Viewpoint Vista, Google Drive, Dropbox. Open API for extracting data out of
STACK.

**Reported weaknesses.** Performance and lag are the dominant complaint —
especially with large plan files or weak internet, which is a structural
consequence of being browser-only. Cost, per-seat licensing, and inflexible
refunds come next. No offline mobile capability (users ask for it). Estimating
described as "solid but secondary" to takeoff, with complex pricing workflows
needing workarounds; GCs wanting takeoff *plus* bid management and sub outreach
find it incomplete alone.

---

## 4. Model comparison against BidSheet's actual schema

BidSheet's estimate spine is `jobs → bid_sections → bid_line_items`
(`src/main/database.ts`), where a line item carries **fixed columns** for each
cost bucket: one `material_id` + `material_unit_cost`, one `crew_template_id` +
`production_rate_id` → `labor_hours`, one `equipment_id` + `equipment_hours`, and
one flat `subcontractor_cost`. Assemblies are one level deep: `assemblies` +
`assembly_items` (materials only, fixed `quantity` each) plus a single optional
`crew_template_id`, `production_rate_id`, `equipment_id`, and
`equipment_hours_per_unit` on the assembly row itself.

| Dimension | Methvin | STACK | BidSheet today |
|---|---|---|---|
| Cost decomposition | Unlimited nested complex resources | Item (cost-typed) → assembly, one level + formulas | Assembly → materials, one level; one crew, one equipment |
| Cost buckets per line | Labour/Plant/Material/Consumables/Subcontract + unlimited accounting groups | Open cost-type tag per item | **Four hardcoded columns** — max one material, one crew, one equipment, one lump sub per line |
| Quantity logic | Global variables + JS formulas, if/then, custom functions | Per-item formula: takeoff variable → purchase unit; waste %, coverage, layers, depth | Fixed qty-per-unit; waste/compaction only on imported trench quantities |
| Markup granularity | Worksheet-level build-up | Job + **line-item markup %** | Job-level OH/profit/bond/tax/escalation, section overrides (`shared/bidCalc.ts`) — **no line-level markup** |
| Owner's bid schedule | **BoQ/SoQ import** (CSV/Excel), addenda tracked individually | — | **None.** `ipc/price-import.ts` imports *price sheets*, not bid schedules |
| Sub quotes | Packages, multi-quote adjudication, variance-to-budget, inclusions/exclusions/qualifications, push winner to BoQ | Not a bid-management tool | `quotes` table: vendor/contact/amount/date/notes, one winner per scope |
| Plan revisions | Addenda traced against SoQ | Auto-versioning + colored overlay diff | `job_documents` + folders; no versioning, no overlay |
| Takeoff → estimate | Live, no export step | Live via item formulas | Live (send-to-bid), plus CSV export |
| Deployment | Cloud, per-seat, lags on big projects | Cloud, per-seat, lags on big plans | **Local Electron + SQLite, free, no account** |

---

## 5. What this says BidSheet should consider

Ranked by (gap × fit with the underground-utility niche). Items 1–3 are the ones
both competitors independently converged on, which is the strongest signal here.

1. **A variable/formula layer on assemblies.** Both products treat "convert a
   measured quantity into a purchase quantity" as a first-class, user-editable
   expression — waste %, coverage rate, layers, depth, spacing. BidSheet hardcodes
   a fixed quantity per unit and only applies waste/compaction on imported trench
   volumes. For utility work the obvious wins are bedding/backfill compaction
   factors, pipe stick lengths, and fitting counts per run. Start with a
   per-`assembly_items` `waste_pct` and `coverage_qty` before reaching for a
   general expression engine.
2. **Break the four-column cost model.** `bid_line_items` physically cannot hold
   two materials, two pieces of equipment, or a consumables bucket. Every real
   estimating product models line cost as *rows* (resources), not *columns*. This
   is the single biggest structural difference and it constrains everything above
   it — including item 1. It is also the most invasive migration in the list; the
   honest sequencing is to do it deliberately, once, rather than adding a fifth
   column each time a gap shows up.
3. **Line-item markup.** STACK exposes `Line Item Markup %` per line; BidSheet
   stops at section overrides. Cheap to add, and it is the first thing an
   estimator reaches for when a single risky line needs padding — related to the
   bid-day pricing gap already flagged as §4.1 of the HeavyBid analysis.
4. **BoQ / bid-schedule import.** Utility subs bid to GCs and agencies off a
   supplied item schedule. Methvin makes importing it the *start* of the estimate.
   BidSheet has no path from "GC sent me an Excel bid form" to a populated section
   — the estimator retypes it. High value, low architectural risk, and it reuses
   the existing fuzzy-matching code in `shared/quoteMatching.ts`.
5. **Quote adjudication depth.** Add inclusions/exclusions, qualifications, and
   variance-against-the-estimated-line to `quotes`. Methvin's adjudication view is
   the model. This also feeds §4.2 of the existing analysis.
6. **Plan revision overlay.** BidSheet already owns its PDF viewer
   (`modules/underground/plan-takeoff/`), so a two-sheet colored overlay is a
   feature it can build *better* than the cloud tools — locally, with no upload
   latency. Pairs naturally with addenda tracking on `job_documents`.

**Do not copy:** the Gantt scheduler (Methvin free-tier bait, unrelated to
bidding), a 10,000-item generic trade library (a curated underground catalog is
worth more than a broad shallow one), per-seat pricing, or browser-only
architecture — the top complaint about *both* products is lag on large files,
which is precisely the failure mode a local Electron + SQLite app does not have.
That is worth saying out loud on the marketing site.

---

## 6. Hands-on session plan (for when you're at your machine)

Both are browser apps, so this is Chromium + Playwright on Linux — **no Wine
needed**. Confirm that before anything else; it's the one assumption that would
change the plan.

**Sequencing matters because the two free tiers behave differently.** Methvin's
free tier is forever, so it can be explored slowly across sessions. STACK's is
2 projects / 10 takeoffs / **7 days** — a one-shot clock. So: explore Methvin
first to learn what questions matter, then spend the STACK week deliberately.

Priority capture list, most transferable first:

1. **Exports.** Make one small dummy job in each (a few hundred LF of pipe, a
   manhole, some restoration), then export everything each tool offers — Excel,
   CSV, PDF. Export files leak the internal model better than the UI does. I can
   read those here with no local setup at all, so this step is worth doing even
   if we never run a browser session.
2. **Network traffic on your own account.** Playwright request logging or
   devtools while you click. Their own JSON payloads are the clearest statement of
   their schema, and that's what maps to `bidsheet-cloud`.
3. **The assembly/complex-resource editor.** The single most valuable screen in
   both products, since §5 items 1–2 hinge on it. Capture what fields exist, what
   is computed vs. entered, and what an assembly can nest.
4. **Methvin's BoQ import and adjudication screens** — the two things BidSheet
   has no equivalent of.
5. **STACK's plan overlay and versioning UX** — directly informs §5 item 6.
6. **Both onboarding/empty states** — how each product explains what a bid *is*
   to a first-time user, which is the highest-leverage thing to steal for the
   BidSheet setup wizard.

**Boundaries for that session** (worth settling before we start, since it's your
account and your company): hand-paced clicking on accounts you own, no bulk
scraping, no automated crawling of their doc sites. We take workflow structure
and data-model concepts — not code, not their rate libraries or item content.
Most SaaS terms of service bar competitor evaluation outright, so this is a call
for you to make knowingly rather than one to discover later.

---

## Appendix — sources

Methvin: methvin.org (products, pricing, estimating & takeoff user guides, tender
portal, procurement-manager and estimator role pages), methvin.co (articles).
STACK: stackct.com (takeoff, takeoff-and-estimating, integrations, procore, blog
posts on items & assemblies and plan overlay), support.stackct.com and
help-preconstruction.stackct.com (takeoff toolbar, unit-cost estimate overview,
assembly formulas, custom assemblies).
Third-party: Capterra, G2, SoftwareAdvice, SelectHub, SoftwareFinder,
SoftwareSuggest, GetApp, SoftwareConnect, ITQlick, struvia.co, estimatorsuite.com,
pricingnow.com.

All vendor pages above returned 403 to automated fetching on 2026-07-30; content
was triangulated from search-engine extracts. Re-verify specifics in the hands-on
session before acting on them.

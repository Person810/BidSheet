# BidSheet Plan Takeoff -- Technical Scope

## What This Document Is

This is the build spec for BidSheet's plan takeoff feature. It covers what to build, why, how the pieces fit together, and the constraints to build within. Any chat that tackles implementation should reference this document for context.

BidSheet is a free, open-source Electron desktop estimating app for small underground utility subcontractors. Stack: Electron, React, TypeScript, better-sqlite3, Zustand. Six runtime dependencies, 20K line budget. GPLv3. Codebase at `C:\Users\lmwil\Desktop\new\BidSheet\BidSheet`.

---

## Why Plan Takeoff Matters

Right now, BidSheet's estimating workflow is manual entry: a contractor types in "200 LF of 8-inch PVC at 6 feet deep" and the app does the math. That works, but it's slow. The actual job site information lives on PDF plan sheets that the GC hands out at bid time. Every competing estimating tool -- PlanSwift ($1,700+/yr), AGTEK Underground ($5,000+), STACK ($1,200+/yr), Bluebeam ($240+/yr) -- lets the estimator measure directly on those PDFs.

Plan takeoff closes that gap. The contractor loads the plan PDF, clicks along the pipe route, and BidSheet calculates everything: pipe length, excavation volume, bedding, backfill, tracer wire, warning tape. No retyping dimensions from the plan into input fields.

For a small sub bidding 3-5 jobs a week, this is the difference between spending 2 hours on a takeoff and spending 30 minutes.

---

## How The Industry Does It

Research across PlanSwift, STACK, AGTEK Underground, Bluebeam, Houzz Pro, Buildxact, and Beam AI reveals a consistent workflow pattern:

**Step 1 -- Load and scale.** User uploads a PDF plan. They set the drawing scale by clicking two points on a known dimension (like a scale bar or a wall labeled "50'-0"") and typing the real-world distance. Everything measured after that is accurate.

**Step 2 -- Measure.** Three measurement types: linear (click endpoints along a path to get total length), area (click corners of a region to get square footage), and count (click to place individual items). Linear measurement is the core tool for pipe takeoff.

**Step 3 -- Attach meaning.** Raw measurements alone are just numbers. The magic is attaching *assemblies* to those measurements -- telling the tool that this linear run is "8-inch PVC SDR-35 at 6 feet deep" so that measuring 200 LF automatically generates 200 LF of pipe, X CY of excavation, Y tons of bedding, Z CY of backfill, plus tracer wire and warning tape. PlanSwift and STACK both emphasize this "measure and estimate in one action" workflow.

**Step 4 -- Place structures.** Manholes, valves, cleanouts, tees, and other fittings get placed as count items at specific points on the run. AGTEK's approach is notable: fittings are context-aware to the pipe size, so placing an 8-inch tee automatically pulls the right catalog item.

**Step 5 -- Review and export.** All quantities roll up into a summary, grouped by material, that feeds directly into the bid. AGTEK specifically breaks output by *depth bracket* (0-4', 4-8', 8-12'+) because excavation pricing varies dramatically with depth.

### What BidSheet Can Do Better

Every tool above costs money and is built for medium-to-large contractors. None are open source. The UX of the enterprise tools (especially AGTEK and Viewpoint) is dated -- users complain about cumbersome navigation and steep learning curves. BidSheet's advantage is:

- Free and offline (no subscription, no cloud dependency)
- Purpose-built for underground utility subs (not generic)
- Modern UI with minimal clicks (direct differentiator vs. Viewpoint/ProContractor)
- The trench math engine (`trenchCalc.ts`) already exists and is proven
- Assemblies system already exists in the app for material bundles

---

## What Already Exists in BidSheet

These are the pieces that plan takeoff plugs into. They're already built and tested.

### trenchCalc.ts (the math engine)

Location: `src/renderer/modules/underground/trenchCalc.ts`

Pure functions, no React, no side effects. Takes a `TrenchInput` (pipe size, start depth, grade, run length, trench width, bench width, bedding depth, backfill type) and returns a `TrenchOutput` (pipe LF, end depth, avg depth, excavation CY, bedding CY, backfill CY, tracer wire LF, warning tape LF). This is the calculation backbone that plan takeoff reuses per-segment.

Key detail: the engine already handles grade correctly. A 2% grade on a 100' run means the pipe falls 2 feet, and the true pipe length is the hypotenuse (slightly longer than horizontal). The engine computes variable-depth excavation using average end area.

### Trench Profiles (per-job database records)

Table: `trench_profiles` (migration V7 + V8). Each profile stores pipe size, material, start depth, grade, run length, width, bench, bedding/backfill type, and FK references to catalog materials. A job can have 30+ profiles representing structure-to-structure segments across water/sanitary/storm/fiber.

Plan takeoff will create these same records programmatically as the user draws segments.

### Assemblies

Table: `assemblies` + `assembly_items`. Materials-only bundles (e.g., "8-inch Manhole Assembly" = base + riser + cone + frame + cover + boots). Plan takeoff can leverage these when placing structures.

### Bid Line Items and Sections

Existing `bid_sections` and `bid_line_items` tables with full cost roll-up through `jobs:summary`. Plan takeoff output feeds directly into this pipeline. The `JobDetail` component already aggregates trench profile materials into bid line items.

### Module Architecture

Trade modules are self-contained folders under `src/renderer/modules/`. The underground module has a manifest at `src/renderer/modules/underground/manifest.ts` that registers tools in the sidebar. Plan takeoff becomes a new tool entry in that manifest.

---

## Build Plan: Three Parts

Plan takeoff ships in three parts. Each part is independently useful -- the user doesn't need Part 2 to get value from Part 1. Each part should be buildable in its own chat session.

### Part 1: PDF Viewer + Linear Pipe Takeoff

**The core experience.** User loads a plan PDF, calibrates the scale, clicks along pipe routes, and gets quantities.

#### File Structure

```
src/renderer/modules/underground/plan-takeoff/
  PlanTakeoff.tsx        -- main page component, layout + state
  PdfViewer.tsx          -- pdf.js rendering + pan/zoom
  DrawingOverlay.tsx     -- SVG layer for pipe runs + structures
  ScaleCalibration.tsx   -- two-point scale calibration modal
  TrenchConfigModal.tsx  -- pipe/depth/grade config per run
  RunSummaryPanel.tsx    -- right-side panel showing quantities
  takeoffStore.ts        -- Zustand store for takeoff state
  takeoffTypes.ts        -- TypeScript interfaces
```

Target: ~800-1,200 lines across all files combined. No file over 400 lines.

#### New Dependency

`pdfjs-dist` (Mozilla's pdf.js). This is the only PDF rendering library worth using -- it's open source (Apache 2.0), battle-tested, works in Electron, and is the same library Bluebeam and many others build on. It renders PDF pages to a `<canvas>` element.

Security note (from prior discussion): pdf.js runs in the renderer process near the IPC bridge. Mitigated by keeping pdf.js updated, and existing security config: `contextIsolation: true`, `nodeIntegration: false`.

#### User Workflow

**1. Open plan takeoff for a job.** Navigate to a job, click a "Plan Takeoff" tool in the sidebar (added to the underground module manifest). The page opens with an empty viewer and a "Load Plan" button.

**2. Load a PDF.** File dialog opens (IPC to main process via `dialog.showOpenDialog`, same pattern as CSV import). The PDF renders in the viewer. Multi-page support: page navigation arrows at the top. Only one page visible at a time. The file path is stored on the job record so it persists.

**3. Set the scale.** Before any measuring, the user must calibrate. A toolbar button enters "Set Scale" mode. User clicks two points on a known dimension on the drawing (like a scale bar, a property line labeled with a distance, or a building wall with a known measurement). A small input appears asking "What is the real-world distance between these points?" User types "100" and selects "ft". The app calculates pixels-per-foot. This ratio persists on the job and only needs to be set once per plan sheet. If the user loads a different page, they can recalibrate.

**4. Start a pipe run.** User clicks "Add Run" in the toolbar (or right-clicks on the plan and selects "Add Pipe Run" from a context menu). A modal opens -- the **Trench Config Modal** -- with these fields:

| Field | Default | Notes |
|---|---|---|
| Label | "" | Optional, e.g. "San. Sewer MH-1 to MH-2" |
| Pipe Size | 8" | Autocomplete from materials catalog |
| Pipe Material | PVC SDR-35 | Autocomplete, filtered to pipe items |
| Starting Invert Depth | 4 ft | Depth at the first click point |
| Grade (%) | 2.0 | Slope of the pipe |
| Trench Width | 3 ft | |
| Bench Width | 0 ft | |
| Bedding Type | #57 Stone | Autocomplete from materials catalog |
| Bedding Depth | 0.5 ft | |
| Backfill Type | Native | Autocomplete from materials catalog |

The user fills this in once per run. Many runs on the same job will share similar configs, so a "Copy from last run" shortcut is valuable.

**5. Click points along the route.** After confirming the config, the cursor changes to a crosshair. The user clicks points along the pipe route on the plan. Each click creates a node (visible as a small circle on the SVG overlay). Lines connect the nodes. The distance in real-world feet (computed from pixel distance / scale ratio) displays along each segment as the user clicks.

A running total shows in the summary panel on the right: total LF so far, and all the trenchCalc outputs (excavation CY, bedding CY, backfill CY, etc.), updating live with each new point.

**Double-click or press Escape to finish the run.** The run is saved to the database.

**6. View and edit runs.** Completed runs display on the overlay as colored lines (color-coded by utility type: blue for water, green for sanitary sewer, orange for storm -- consistent with industry convention). Clicking a completed run selects it and shows its quantities in the summary panel. Right-click offers Edit Config (reopens the modal), Delete Run, or Edit Points (re-enter point editing mode to adjust nodes).

**7. Quantities feed into the bid.** A "Send to Bid" action on the summary panel creates bid line items from the takeoff data. This works the same way the existing trench profile "convert to bid" flow works in JobDetail -- group by material, sum quantities, create or update line items.

#### Technical Details: The Drawing Overlay

The overlay is an SVG element absolutely positioned on top of the pdf.js canvas. SVG is the right choice over a second canvas because:

- SVG elements are individually addressable (clickable, hoverable) -- critical for selecting and editing runs
- SVG scales cleanly with zoom (vector, not bitmap)
- React can manage SVG elements declaratively
- No conflict with the pdf.js canvas underneath

The overlay SVG must stay in sync with the PDF viewport. When the user pans or zooms, the SVG viewBox transforms must match the canvas transforms. This is the trickiest part of the implementation -- get this wrong and clicks land in the wrong place.

Pan and zoom: implement via mouse wheel (zoom) and click-drag (pan) when no drawing tool is active. Transform state lives in the Zustand store so both the canvas and SVG stay synced. Touch/trackpad support is nice-to-have but not required for v1 (desktop-first app).

#### Technical Details: The PDF Viewer

Use `pdfjs-dist` directly, not a React wrapper library (keeps dependencies minimal, gives full control over the canvas). The rendering pattern:

1. Load the PDF document: `pdfjsLib.getDocument(filePath)`
2. Get a page: `doc.getPage(pageNumber)`
3. Create a viewport at the desired scale: `page.getViewport({ scale })`
4. Render to a canvas: `page.render({ canvasContext: ctx, viewport })`

For zoom, re-render at a different scale. For pan, apply CSS transforms to a container div rather than re-rendering (much faster). Only re-render the canvas when zoom level changes significantly (debounce).

HiDPI support: multiply canvas dimensions by `window.devicePixelRatio`, apply inverse scale via CSS `width`/`height`, so lines stay crisp on Retina displays.

#### Technical Details: Data Model

New table (migration V11):

```sql
CREATE TABLE takeoff_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label           TEXT NOT NULL DEFAULT '',
  utility_type    TEXT NOT NULL DEFAULT 'sanitary',   -- sanitary, storm, water, fiber, other
  pipe_size_in    REAL NOT NULL DEFAULT 8,
  pipe_material   TEXT NOT NULL DEFAULT 'PVC',
  start_depth_ft  REAL NOT NULL DEFAULT 4,
  grade_pct       REAL NOT NULL DEFAULT 2.0,
  trench_width_ft REAL NOT NULL DEFAULT 3,
  bench_width_ft  REAL NOT NULL DEFAULT 0,
  bedding_type    TEXT NOT NULL DEFAULT '#57 Stone',
  bedding_depth_ft REAL NOT NULL DEFAULT 0.5,
  backfill_type   TEXT NOT NULL DEFAULT 'Native',
  pipe_material_id    INTEGER REFERENCES materials(id),
  bedding_material_id INTEGER REFERENCES materials(id),
  backfill_material_id INTEGER REFERENCES materials(id),
  color           TEXT NOT NULL DEFAULT '#2196F3',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  pdf_page        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_takeoff_runs_job ON takeoff_runs(job_id);

CREATE TABLE takeoff_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES takeoff_runs(id) ON DELETE CASCADE,
  x_px        REAL NOT NULL,   -- pixel coordinates on the PDF at scale=1
  y_px        REAL NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_takeoff_points_run ON takeoff_points(run_id);

CREATE TABLE takeoff_job_settings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  pdf_path        TEXT,              -- file path to the loaded PDF
  scale_px_per_ft REAL,              -- pixels per foot (set during calibration)
  scale_point1_x  REAL,              -- calibration reference points (for re-display)
  scale_point1_y  REAL,
  scale_point2_x  REAL,
  scale_point2_y  REAL,
  scale_distance_ft REAL             -- the known distance the user entered
);

CREATE INDEX idx_takeoff_settings_job ON takeoff_job_settings(job_id);
```

Why pixel coordinates at scale=1: storing points in the PDF's native coordinate space (before any zoom/pan) means they remain correct regardless of how the user is viewing the document. Convert to screen coordinates at render time using the current viewport transform.

#### How trenchCalc.ts Gets Reused

For each run, the total horizontal distance is computed as the sum of point-to-point distances (converted from pixels to feet via the scale ratio). That total distance becomes `runLengthLF` in the `TrenchInput`. All other inputs come directly from the run's config fields. Call `calculateTrench()` and you get the full output. No new math needed.

For variable-depth accuracy within a run: the depth at any point along the run equals `startDepthFt + (gradePct / 100) * distanceFromStart`. If the user places 5 points over a 500-foot run, BidSheet could theoretically subdivide into per-segment calculations. For Part 1, treating the whole run as one segment using average end area (which trenchCalc already does) is accurate enough. Per-segment subdivision is a Part 2 enhancement.

#### IPC Handlers Needed

```
db:takeoff-runs:list         (jobId) -> TakeoffRun[]
db:takeoff-runs:save         (run) -> { id }
db:takeoff-runs:delete       (id) -> void
db:takeoff-points:save       (runId, points[]) -> void  // bulk upsert
db:takeoff-settings:get      (jobId) -> TakeoffJobSettings | null
db:takeoff-settings:save     (settings) -> void
db:takeoff:open-pdf          () -> { filePath, ... } | null  // dialog
```

Preload API additions to match.

---

### Part 2: Count Items + Fittings

**Adds the ability to place structures and fittings on the plan.**

This is the second layer on top of Part 1's linear measurement.

#### Two Placement Modes

**Mode A -- Quick Place (for common structures).** User selects an item type from a toolbar palette (manhole, cleanout, valve, hydrant, tee, 90-degree bend, 45-degree bend, cap, thrust block). Clicks a location on the plan. A symbol appears on the overlay. The item is automatically sized to match the pipe run it's nearest to (context-aware). For example, placing a tee near an 8-inch sanitary sewer run creates an "8-inch PVC Tee" from the materials catalog.

**Mode B -- Custom Place.** Right-click on the plan, select "Add Fitting," opens the materials autocomplete to pick any item from the catalog. Place it at the click location. This handles anything not in the quick palette.

#### Auto-Assembly

Placing certain fittings should auto-add related items. Examples:

- Place a **tee** -> also add a thrust block (sized to pipe) + boot seals
- Place a **gate valve** -> also add a valve box + cover
- Place a **fire hydrant** -> also add hydrant shoe/tee, gate valve, valve box, thrust block, breakaway flange
- Place a **cleanout** -> also add cleanout frame + cover, riser pipe

These auto-assembly relationships should be configurable (stored in a lookup table or as assemblies in the existing assembly system). The user should see what was auto-added and be able to remove unwanted items.

#### Data Model Addition

```sql
CREATE TABLE takeoff_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES materials(id),
  assembly_id INTEGER REFERENCES assemblies(id),
  x_px        REAL NOT NULL,
  y_px        REAL NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  label       TEXT,
  pdf_page    INTEGER NOT NULL DEFAULT 1,
  near_run_id INTEGER REFERENCES takeoff_runs(id),  -- context link
  auto_added  INTEGER NOT NULL DEFAULT 0,  -- 1 if auto-placed by an assembly rule
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_takeoff_items_job ON takeoff_items(job_id);
```

#### Summary Panel Updates

The right-side summary panel expands to show two tabs: **Runs** (linear takeoff from Part 1) and **Items** (count takeoff from Part 2). Items are grouped by material with total counts. Both tabs have a "Send to Bid" action.

#### Deep Segment Shoring Flag

If a run's calculated depth exceeds a configurable threshold (default: 5 feet, matching OSHA general threshold for protective systems), display a visual flag on that run. This doesn't auto-add shoring to the bid (the decision depends on soil type and method), but it surfaces the reminder.

---

### Part 3: Imagery Layers (Later)

**PDF plans aren't always enough. Satellite screenshots and drone photos add real-world context.**

This is the furthest-out part and should be built only after Parts 1 and 2 are solid.

#### Layer System

The plan viewer supports multiple background layers, each independently toggleable and adjustable:

| Layer Type | Source | Notes |
|---|---|---|
| PDF Plan | `.pdf` file import | Primary layer, always present when loaded |
| Satellite Image | Screenshot/export from Google Earth/Maps | Imported as `.png`/`.jpg` |
| Drone Photo | Ortho-mosaic export from drone flights | Imported as `.png`/`.jpg`/`.tif` |
| Blank Canvas | No background | For freehand estimating without a plan |

Each image layer has: opacity slider (0-100%), visibility toggle (eye icon), lock toggle (prevents accidental moves), and z-order (drag to reorder).

#### Image Alignment

For satellite/drone images to be useful alongside the PDF plan, they need to be aligned. Two approaches:

**Manual alignment (v1):** User imports an image, then drags/scales/rotates it to visually align with the PDF plan. Two control points: user clicks two matching locations on the PDF and then the same two locations on the image. The app computes the affine transform (translate + scale + rotate) to align them.

**Georeferencing (future):** If both the PDF and the image have real-world coordinates, alignment is automatic. Most drone ortho-mosaics include georeferencing metadata. PDF plans sometimes have survey coordinates. This is significantly more complex and should only be built if there's user demand.

#### Progressive Disclosure

Imagery layers are an advanced feature. They should be off by default in settings, revealed via a toggle. The base experience (Part 1 + Part 2) should not be complicated by layer controls until the user opts in.

---

## Constraints and Guidelines

These apply to all three parts and match BidSheet's established patterns.

### Code Discipline

- Total plan takeoff code should target 1,500-2,000 lines for Part 1, staying well within the 20K app budget
- No file over 400 lines. Split early.
- One function does one thing.
- No UI component libraries. All styling uses the app's existing CSS classes (`btn`, `btn-primary`, `form-control`, `modal-overlay`, `modal`, etc.)
- Math stays in utility files, not in components

### Dependency Policy

- `pdfjs-dist` is the only new dependency. It's justified: there is no lighter alternative for PDF rendering in JavaScript, and the feature is impossible without it.
- No additional UI libraries, canvas libraries, or drawing libraries. Use plain SVG + React for the overlay.

### UX Principles

- No developer jargon in the UI. "Pipe Run" not "Linear Segment Entity."
- Field-standard unit labels: LF, CY, EA, ft, in.
- Minimize clicks. Starting a new run should be 2 clicks + fill a short form + start clicking points. Not a wizard.
- "Copy from last run" on the config modal saves massive time on repetitive bids.
- Right-click context menus for discoverability without toolbar clutter.
- Color-code by utility type: blue = water, green = sanitary, orange = storm, purple = fiber. Industry convention.

### Data Safety

- All takeoff data tied to job_id with ON DELETE CASCADE. Delete a job, takeoff data goes with it.
- Point coordinates stored in PDF-native space, not screen space.
- Scale calibration persists per job so reopening a plan doesn't require recalibration.
- The PDF file itself is NOT stored in the database. Only the file path. Same pattern as the file-linking design for job attachments.

### Integration Points

- Plan takeoff creates `trench_profiles` or `bid_line_items` via "Send to Bid" -- reusing the existing pipeline, not inventing a new one.
- The materials catalog autocomplete (already built) is reused for pipe, bedding, and backfill selection in the config modal.
- The assemblies system (already built) is reused for auto-assembly when placing fittings.
- The Zustand store pattern (already used for app state) is used for takeoff viewport/tool state.

---

## What's Explicitly Out of Scope

These are things that competitor tools do but BidSheet should NOT attempt in this phase:

- **Bezier curves / arc segments.** We discussed this early on. Curved pipe runs are real, but the math is complex and the UI for bezier handles is finicky. Straight-line segments between click points are accurate enough for most residential/commercial utility runs. Curves can be approximated by clicking more points along the arc. Revisit only if users ask for it.
- **Auto-detection / AI symbol counting.** Beam AI, Countfire, and STACK offer this. It requires ML models, training data, and cloud infrastructure. Not aligned with BidSheet's offline-first architecture. Maybe someday as an optional paid add-on.
- **DWG/CAD import.** PDF is the universal format that every GC distributes. CAD import adds a massive dependency and complexity. Skip.
- **3D visualization.** AGTEK does this. It's impressive but adds no bidding accuracy for a small sub. Skip.
- **Cut and fill / earthwork surfaces.** This is computational geometry (TIN surface modeling) that's a project in itself. Skip.
- **Machine control export.** AGTEK exports trench models for GPS-guided excavators. Way beyond scope.
- **Multi-user collaboration / real-time sync.** Cloud features are long-term paid-tier ideas.
- **Revision overlay / version comparison.** Nice feature in On-Screen Takeoff and HCSS. Not needed for v1.

---

## Build Order Recommendation

1. **Part 1A -- PDF viewer with pan/zoom/page navigation.** Get pdf.js rendering cleanly in the Electron app with smooth controls. No drawing yet. This validates the dependency and the rendering pipeline.

2. **Part 1B -- Scale calibration.** Two-point calibration flow. Store scale on the job. This is a small, testable piece.

3. **Part 1C -- Drawing overlay + pipe run creation.** SVG overlay, click-to-place points, live distance calculation, trench config modal, trenchCalc integration, summary panel. This is the bulk of Part 1.

4. **Part 1D -- Persistence + bid integration.** Save runs and points to SQLite. Load them when reopening a job. "Send to Bid" action.

5. **Part 2 -- Fittings and count items.** After Part 1 is stable and tested.

6. **Part 3 -- Imagery layers.** After Part 2 is stable and tested. Only if demand materializes.

---

## Reference: Existing File Locations

| Purpose | Path |
|---|---|
| IPC handlers | `src/main/ipc-handlers.ts` |
| Preload API | `src/main/preload.ts` |
| Database + migrations | `src/main/database.ts` |
| Underground module | `src/renderer/modules/underground/` |
| Module manifest | `src/renderer/modules/underground/manifest.ts` |
| Module type defs | `src/renderer/modules/types.ts` |
| Trench calc engine | `src/renderer/modules/underground/trenchCalc.ts` |
| Existing trench profiler | `src/renderer/modules/underground/TrenchProfiler.tsx` |
| Job pages | `src/renderer/pages/jobs/` |
| Shared components | `src/renderer/components/` |
| App routing | `src/renderer/App.tsx` |

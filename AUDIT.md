# BidSheet Codebase Audit

**Date:** 2026-03-31
**Scope:** Every source file in the repository (~6,415 LOC across 40+ files)
**Method:** Full read of every file, pattern analysis, cross-reference of duplicated logic

---

## CRITICAL

### C1. Bid Summary Calculation Triplicated (Data Integrity Risk)

The bid total/tax/markup calculation is copy-pasted in **three separate locations** in `ipc-handlers.ts`. If the formula changes in one place but not the others, exported PDFs, QuickBooks CSVs, and the UI will show different totals for the same job.

**Location 1** — `bid:summary` handler (~line 534):
```ts
const subtotal = rows.reduce((s, r) => s + r.quantity * r.unit_cost, 0);
const markupAmt = subtotal * (job.markup_percent / 100);
const afterMarkup = subtotal + markupAmt;
const taxAmt = afterMarkup * (job.tax_rate / 100);
const total = afterMarkup + taxAmt;
```

**Location 2** — `jobs:export-pdf` handler (~line 900):
```ts
// Same formula, different variable names
```

**Location 3** — `export:quickbooks-csv` handler (~line 962):
```ts
// Same formula, yet again
```

**Fix:** Extract into a shared pure function in `src/shared/` or a `bidCalc.ts` module:
```ts
export function computeBidSummary(rows, job) { ... }
```

### C2. Raw IPC Handlers Silently Swallow Errors

7 handlers use bare `ipcMain.handle` instead of the `safeHandle` wrapper. When these throw, the renderer gets an opaque rejection with no user-facing message, and the error may not be logged.

| Handler | File | ~Line |
|---------|------|-------|
| `db:export` | ipc-handlers.ts | 788 |
| `db:restore` | ipc-handlers.ts | 821 |
| `db:csv:open` | ipc-handlers.ts | 1062 |
| `db:materials:import-prices` | ipc-handlers.ts | 1088 |
| `export:quickbooks-csv` | ipc-handlers.ts | 886 |
| `jobs:export-pdf` | ipc-handlers.ts | 944 |
| `db:takeoff:open-pdf` | ipc-handlers.ts | 1147 |

These are some of the most failure-prone operations (file I/O, DB backup/restore, PDF generation). A crash in `db:restore` or `db:export` gives the user no feedback.

**Fix:** Convert all to `safeHandle` with appropriate user-facing error messages.

### C3. Module-Level Mutable ID Counters Shared Across Renders

Both `useRunManager.ts:6` and `useItemManager.ts:6` use:
```ts
let nextLocalId = -1;
```

This is module-scoped mutable state that:
- Persists across React strict-mode double-renders
- Persists if the component unmounts and remounts (navigating away and back)
- Never resets, so IDs keep decrementing into large negatives
- Could collide if two PlanTakeoff instances were ever mounted (unlikely but architecturally fragile)

**Fix:** Use `useRef` inside the hook, or initialize from the current max ID in the items/runs array.

---

## HIGH

### H1. N+1 Query Pattern in Dashboard

`Dashboard.tsx:31` — For every job, a separate IPC call fetches the bid summary:
```ts
for (const job of jobs) {
  const summary = await window.api.getBidSummary(job.id);
  // ...
}
```

With 50 jobs this fires 51 IPC round-trips (1 for jobs + 50 for summaries). Each crosses the Electron IPC bridge and hits SQLite.

**Fix:** Add a single `getBidSummariesBatch(jobIds)` IPC handler that returns all summaries in one query using `WHERE job_id IN (...)`.

### H2. Full PDF Buffers Passed Through IPC

`db:takeoff:open-pdf` (ipc-handlers.ts ~line 1147) reads an entire PDF file into a `Buffer` and sends it over IPC to the renderer. Construction plan sheets can be 50-200MB. Electron IPC serializes this through structured clone, doubling memory usage.

Similarly, `db:takeoff:read-pdf` passes the buffer back.

**Fix:** Write the PDF to a temp file and pass the file path. The renderer's PDF.js can load from a URL/path directly via `file://` protocol or a custom protocol handler.

### H3. `window.d.ts` Types All `any` Despite Proper Interfaces Existing

`src/shared/types/window.d.ts` declares every `window.api` method with `any` parameters and `any` returns:
```ts
getMaterials: () => Promise<any>;
saveMaterial: (data: any) => Promise<any>;
```

Meanwhile, `src/shared/types/index.ts` has well-defined interfaces (`Material`, `Job`, `BidLineItem`, etc.) that are **never imported or used anywhere in the renderer**.

This means:
- No compile-time safety on IPC calls
- Typos in property names silently pass
- Refactoring the DB schema won't surface breaking changes

**Fix:** Type the window.d.ts methods using the shared interfaces:
```ts
getMaterials: () => Promise<Material[]>;
saveMaterial: (data: SaveMaterialPayload) => Promise<{ id: number }>;
```

### H4. `formatCurrency` Duplicated 5 Times

Five independent implementations of the same function:

| File | Line | Implementation |
|------|------|---------------|
| `Dashboard.tsx` | ~22 | `(n) => '$' + n.toFixed(2).replace(...)` |
| `MaterialsPage.tsx` | ~155 | `(n) => '$' + n.toFixed(2).replace(...)` |
| `EquipmentPage.tsx` | ~154 | `(n) => '$' + n.toFixed(2).replace(...)` |
| `CsvImportModal.tsx` | (inline) | `'$' + Number(val).toFixed(2)` |
| `helpers.ts` | ~line 30 | `(n) => '$' + n.toFixed(2).replace(...)` |

Some include thousands separators, some don't. `CsvImportModal` doesn't add commas. The helpers.ts version exists specifically to be shared but isn't used by the other files.

**Fix:** Delete all copies except `helpers.ts`, import from there everywhere.

### H5. `statusBadge` Function Duplicated 3 Times

Three identical copies of the job status badge renderer:

- `Dashboard.tsx` ~line 15
- `JobList.tsx` ~line 10
- `JobDetail.tsx` ~line 15

**Fix:** Move to `helpers.ts` or a shared component.

### H6. Duplicate Interface Definitions Across Labor Files

The same interfaces are redefined in multiple files instead of sharing:

| Interface | Files |
|-----------|-------|
| `LaborRole` | `LaborRolesTab.tsx:4-11`, `CrewTemplatesTab.tsx:8-15` |
| `CrewMember` | `CrewTemplatesTab.tsx:17-25`, `ProductionRatesTab.tsx:8-16` |
| `CrewTemplate` | `CrewTemplatesTab.tsx:27-32`, `ProductionRatesTab.tsx:18-23` |

**Fix:** Define once in a shared types file (e.g., `src/shared/types/labor.ts`) and import.

---

## MEDIUM

### M1. `UNITS` Array Duplicated 3 Times

Three separate definitions of the units list:

- `MaterialsPage.tsx:12` — `['LF', 'EA', 'CYD', ...]`
- `AssembliesPage.tsx:46` — `['LF', 'EA', 'CYD', ...]`
- `ProductionRatesTab.tsx:55` — `['LF', 'EA', 'CYD', ...]`

They're slightly different — `ProductionRatesTab` has `['LF', 'EA', 'CYD', 'VF', 'SY', 'TON']` (6 items) while the others have more options.

**Fix:** Define once in `src/shared/constants/units.ts`.

### M2. Two Competing Modal CSS Patterns

`global.css` defines two completely separate modal systems:

1. `.modal-overlay` + `.modal` (line 628-661) — used by most components
2. `.modal-backdrop` + `.modal-content` + `.modal-header` + `.modal-body` + `.modal-footer` (line 900-960) — used only by `AssembliesPage.tsx`

`AssembliesPage` is the only file using `modal-backdrop`/`modal-content`. Every other modal in the app uses `modal-overlay`/`modal`.

**Fix:** Migrate `AssembliesPage` to the standard pattern and remove the alternate CSS.

### M3. `alert()` Used for Error Handling Instead of Toast System

Three labor page components use raw `alert()` for errors despite a toast store existing:

- `LaborRolesTab.tsx:69` — `alert(err.message || 'Failed to delete role.')`
- `CrewTemplatesTab.tsx:106` — `alert(err.message || 'Failed to delete crew template.')`
- `ProductionRatesTab.tsx:111` — `alert(err.message || 'Failed to delete production rate.')`

The app has a proper `useToastStore` for this purpose.

**Fix:** Replace `alert()` with `addToast(err.message, 'error')`.

### M4. `ipc-handlers.ts` is 1,758 Lines — God File

This single file contains:
- All ~60 IPC handlers
- CSV parsing logic
- PDF HTML template builder (hundreds of lines of template literals)
- Bid summary calculations
- File dialog operations
- Database CRUD for every entity

**Fix:** Split by domain:
- `ipc/materials.ts`
- `ipc/jobs.ts`
- `ipc/takeoff.ts`
- `ipc/export.ts` (PDF, CSV, QuickBooks)
- `ipc/backup.ts` (export/restore)

### M5. PDF Export HTML Template Hardcodes Company Type

`ipc-handlers.ts` ~line 1543:
```ts
<div style="...">Underground Utility Contractor</div>
```

This is baked into the PDF export template. Users in other trades will see "Underground Utility Contractor" on their exported bid sheets.

**Fix:** Pull from company settings or the trade module configuration.

### M6. `document.execCommand` Used (Deprecated API)

`main.tsx:12`:
```ts
document.execCommand('insertText', false, '.');
```

Used for the numpad decimal fix. `execCommand` is deprecated and will be removed from browsers. While Electron's Chromium version is pinned, this is a ticking time bomb for upgrades.

**Fix:** Use `InputEvent` constructor or the `beforeinput` event API.

### M7. `app:log-dir` Handler Registered Outside `registerIpcHandlers`

`main.ts` registers one handler directly:
```ts
ipcMain.handle('app:log-dir', () => logDir);
```

While all other handlers go through `registerIpcHandlers(db)`. This means:
- Easy to miss when auditing IPC surface
- Not wrapped in `safeHandle`
- Split registration makes it unclear where to look for handlers

Similarly, `updater.ts` registers its own handlers inside `initAutoUpdater`.

**Fix:** Move all handler registrations into `registerIpcHandlers` or at minimum document the split clearly.

### M8. Toast Store Uses Module-Level Counter

`toast-store.ts:26`:
```ts
let nextId = 1;
```

Same pattern as the takeoff ID counters. Not a real bug since toasts are ephemeral, but inconsistent with React best practices. If the store were ever reset or re-created (e.g., in tests), the counter wouldn't reset.

### M9. No Error Handling on `handleSave` in Labor Pages

`LaborRolesTab.tsx:42`, `CrewTemplatesTab.tsx:82`, `ProductionRatesTab.tsx:84`:
```ts
const handleSave = async () => {
  await window.api.saveLaborRole({...});
  setShowModal(false);
  onRefresh();
};
```

No try/catch. If the save fails, the modal closes and the user thinks it worked. Delete has error handling (via `alert()`), but save doesn't.

**Fix:** Wrap in try/catch, show error toast on failure, don't close modal.

---

## LOW

### L1. PDF.js Worker Bundling May Fail in Production

`PdfViewer.tsx` imports the worker via Vite URL import:
```ts
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
```

This works in dev but may not survive electron-builder's asar packaging. The `?url` import gives a path relative to the Vite output, but asar archives can't serve files via normal path resolution.

`package.json` has no `extraResources` configuration for the worker file.

**Recommendation:** Test in a production build. If broken, add the worker to `extraResources` in electron-builder config and resolve the path at runtime.

### L2. `better-sqlite3` Native Module Packaging

`better-sqlite3` is a native Node module requiring platform-specific binaries. It's listed in `dependencies` (not `devDependencies`), which is correct, but electron-builder needs `externals` or `extraResources` config to handle it properly.

The current config relies on electron-builder's automatic native module rebuilding. This works in most cases but can fail silently on some platforms.

**Recommendation:** Verify the production build actually works on both Windows and Linux targets.

### L3. `JobDetail.tsx` is 905 Lines

While not as extreme as `ipc-handlers.ts`, this is a large component handling:
- Job metadata editing
- Section management
- Line item CRUD
- Trench profile conversion
- Change order management
- PDF/QuickBooks export triggers
- Print view

**Recommendation:** Extract sections into sub-components (e.g., `JobSections.tsx`, `ChangeOrdersPanel.tsx`).

### L4. Inline Styles Used Extensively in Plan Takeoff Components

Components like `SummaryPanel.tsx`, `TakeoffToolbar.tsx`, `ScaleCalibration.tsx`, `ItemPickerModal.tsx`, and `TrenchConfigModal.tsx` use extensive inline `style={{...}}` objects instead of CSS classes.

This isn't a bug but makes the UI harder to maintain and theme consistently.

### L5. `safeHandle` Error Messages Are Generic

The `safeHandle` wrapper provides user-friendly messages, but they're static strings set at registration time. For example:
```ts
safeHandle('db:materials:save', 'saving material', async (_, data) => { ... });
```

If the actual error is "UNIQUE constraint failed: materials.name", the user just sees "Error saving material." The underlying error is logged but not surfaced.

**Recommendation:** For constraint violations, parse the SQLite error and return a more specific message (e.g., "A material with that name already exists").

### L6. CSV Parser in IPC Handlers

`ipc-handlers.ts` contains an inline CSV parser (~lines 1062-1088) instead of using a library. It handles basic cases but doesn't cover all RFC 4180 edge cases (embedded newlines in quoted fields, BOM markers, etc.).

Ironically, `csv-export.ts` correctly implements RFC 4180 escaping for *output* but the *input* parser is hand-rolled.

**Recommendation:** Use a lightweight CSV parsing library like `papaparse` (already commonly used in Electron apps).

---

## Summary by Category

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Architectural Drift | — | H3 | M4, M7 | L3 |
| Duplication | C1 | H4, H5, H6 | M1, M2 | — |
| Silent Failures | C2 | — | M3, M9 | L5 |
| Electron Gotchas | — | H2 | — | L1, L2 |
| PDF.js Issues | — | — | — | L1 |
| State & Data Integrity | C3 | H1 | M5, M8 | — |
| Dead Code / Debt | — | — | M6 | L4, L6 |

**Total: 3 Critical, 6 High, 9 Medium, 6 Low**

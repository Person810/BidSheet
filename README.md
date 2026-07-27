# BidSheet

Free, open-source construction estimating software for underground utility subcontractors. Build bid proposals for water, sewer, and civil work without paying for expensive proprietary tools.

Everything runs locally on your machine.

## What It Does

- Maintain a material catalog with pricing and price history
- Build crews with burdened labor rates and production rates
- Track equipment costs (owned and rented)
- Create bid estimates organized by section and line item
- Auto-calculate totals with overhead, profit, bond, tax, and material escalation markups
- Job-level indirect costs (mobilization, traffic control, dewatering) spread into unit prices
- Bid alternates and per-section markup overrides
- Reusable section templates for standard work packages
- Subcontractor/supplier quote tracking with winner selection per scope
- Unit price schedule export (markups folded into unit sell prices) and cost-code roll-up reports
- Bid analysis report: labor hours, crew-days, equipment hours, margin by section, $/LF by pipe size
- Stale-price warnings when line items ride on catalog prices that haven't been updated in 90+ days
- Assemblies with labor and equipment components, expandable from measured takeoff areas
- Generate professional bid proposal PDFs
- Duplicate previous bids as starting points for new jobs
- Plan takeoff with PDF viewer, scale calibration, page rotation, and pipe run drawing
- Drag-to-edit takeoff geometry with node snapping and Shift-ortho drawing
- Area measurement for surface restoration (asphalt, concrete, gravel) with SF/SY/CY quantities
- Plan annotations (text notes, arrows, revision clouds) and marquee multi-select with bulk edit
- Full undo/redo, layer visibility toggles, and takeoff quantity CSV export
- Side-by-side estimate comparison for what-if scenarios
- Trench profiles on each job (Profiles tab) with excavation and backfill volume calculations
- Compaction/waste factor on imported bedding and backfill quantities
- Per-job document storage with user-organized nested folders: plans, addenda, quotes, photos, and contracts in one managed place
- CSV price sheet import with fuzzy matching to your catalog
- Win/loss tracking and bid status management, with win-rate breakdowns by client and bid size
- Database backup and restore

## Pricing

BidSheet is free. The app is GPLv3 open source and runs fully local. Your
catalog, bids, and plans live in a SQLite database on your machine, with no
account and no internet connection required.

Optional cloud sync ($20/month, currently in beta) adds online backup and
multi-computer sync, and funds development of the free app. Your data always
lives locally regardless of subscription status, and a local-only mode in
Settings hides cloud sync entirely for shops that will never use it.

Cloud backups are encrypted on your computer, under a key only your recovery
key can unlock, before they upload. We store the backup, but we can never read
it.

## Platforms

Windows and Linux today. **macOS is planned, alongside the iOS companion app** — the iOS field app is now in early development in [`ios/`](ios/).

## Screenshots

*(coming soon)*

## Getting Started

### Requirements

- Node.js 20+
- C++ build tools:
  - **Windows:** Visual Studio with "Desktop development with C++"
  - **Linux:** `build-essential`

### Development

```bash
git clone https://github.com/Person810/BidSheet.git
cd BidSheet
npm install
npm run dev
```

Then in a second terminal:

```bash
npm start
```

### Tests & Typecheck

```bash
npm test            # unit tests (bid math, trench volumes, CSV export)
npm run typecheck   # strict TypeScript check of renderer + main
```

Both run in CI on every push and pull request.

### Build Installers

```bash
npm run dist:win       # Windows .exe
npm run dist:linux     # Linux .AppImage and .deb
```

## Download

Prebuilt installers are available on the [Releases](https://github.com/Person810/BidSheet/releases) page.

## Contributing

Contributions welcome. This project is in early development.

If you are a contractor or estimator, your real-world feedback is the most valuable contribution. Open an issue describing your workflow and what you need.

For code contributions, fork the repo and open a pull request. Bug reports and feature requests go to the [Issues](https://github.com/Person810/BidSheet/issues) tracker.

## Tech Stack

Electron, React, TypeScript, SQLite (better-sqlite3), Zustand

## License

[GPLv3](LICENSE)

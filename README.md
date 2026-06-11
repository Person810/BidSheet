# BidSheet

Free, open-source construction estimating software for underground utility subcontractors. Build bid proposals for water, sewer, and civil work without paying for expensive proprietary tools.

Everything runs locally on your machine.

## What It Does

- Maintain a material catalog with pricing and price history
- Build crews with burdened labor rates and production rates
- Track equipment costs (owned and rented)
- Create bid estimates organized by section and line item
- Auto-calculate totals with overhead, profit, bond, tax, and material escalation markups
- Bid alternates and per-section markup overrides
- Subcontractor/supplier quote tracking with winner selection per scope
- Unit price schedule export (markups folded into unit sell prices) and cost-code roll-up reports
- Assemblies with labor and equipment components, expandable from measured takeoff areas
- Generate professional bid proposal PDFs
- Duplicate previous bids as starting points for new jobs
- Plan takeoff with PDF viewer, scale calibration, page rotation, and pipe run drawing
- Area measurement for surface restoration (asphalt, concrete, gravel) with SF/SY/CY quantities
- Plan annotations (text notes, arrows, revision clouds) and marquee multi-select with bulk edit
- Full undo/redo, layer visibility toggles, and takeoff quantity CSV export
- Side-by-side estimate comparison for what-if scenarios
- Trench profiler with excavation and backfill volume calculations
- CSV price sheet import with fuzzy matching to your catalog
- Win/loss tracking and bid status management
- Database backup and restore

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

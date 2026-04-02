# BidSheet

Free, open-source construction estimating software for underground utility subcontractors. Build bid proposals for water, sewer, and civil work without paying for expensive proprietary tools.

Everything runs locally on your machine.

## What It Does

- Maintain a material catalog with pricing and price history
- Build crews with burdened labor rates and production rates
- Track equipment costs (owned and rented)
- Create bid estimates organized by section and line item
- Auto-calculate totals with overhead, profit, bond, and tax markups
- Generate professional bid proposal PDFs
- Duplicate previous bids as starting points for new jobs
- Plan takeoff with PDF viewer, scale calibration, and pipe run drawing
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

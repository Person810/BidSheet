# Contributing to BidSheet

Thanks for your interest in improving BidSheet. This project is free, open
source (GPLv3), and in early development. Contributions of all kinds are
welcome.

## The Most Valuable Contribution

If you are a contractor or estimator, **your real-world feedback is worth more
than code.** Open an [issue](https://github.com/Person810/BidSheet/issues)
describing your actual workflow, what slows you down, and what a tool would need
to do to earn a place in your bid process. That feedback shapes the roadmap.

## Reporting Bugs and Requesting Features

- Search existing [issues](https://github.com/Person810/BidSheet/issues) first
  to avoid duplicates.
- For bugs, include your platform (Windows / Linux), the app version, what you
  expected, what happened, and steps to reproduce.
- For security issues, **do not** open a public issue — see
  [SECURITY.md](SECURITY.md).

## Development Setup

Requirements:

- Node.js 20+
- C++ build tools (for the native `better-sqlite3` module):
  - **Windows:** Visual Studio with "Desktop development with C++"
  - **Linux:** `build-essential`

```bash
git clone https://github.com/Person810/BidSheet.git
cd BidSheet
npm install
npm run dev      # terminal 1: build watchers + Vite dev server
npm start        # terminal 2: launch Electron
```

## Before You Open a Pull Request

Run the checks that CI runs on every push and PR:

```bash
npm run typecheck   # strict TypeScript check of renderer + main
npm test            # unit tests (bid math, trench volumes, CSV export)
```

Both must pass. If you change calculation logic (bid totals, trench volumes,
markups), add or update a unit test that covers it — the math is the heart of
the app and regressions there are costly.

## Pull Request Guidelines

1. Fork the repo and create a topic branch off `main`.
2. Keep changes focused; one logical change per PR is easier to review.
3. Match the existing code style — TypeScript, functional React components,
   Zustand for state. Look at neighboring files before introducing new patterns.
4. Reuse shared helpers instead of duplicating logic. Currency formatting,
   units, bid calculations, and shared types already have a home in
   `src/shared/` and `src/renderer/utils/`.
5. Describe what changed and why in the PR description. Link any related issue.

## Project Layout

- `src/main/` — Electron main process: IPC handlers, database, cloud sync
- `src/renderer/` — React UI (pages, components, stores)
- `src/shared/` — types, constants, and pure functions used by both sides
- The cloud sync backend lives in a separate repository.

## License

By contributing, you agree that your contributions will be licensed under the
[GPLv3](LICENSE), the same license that covers the project.

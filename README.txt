UtilEstimator
=============

Free, open source construction estimating software for underground utility
subcontractors. Build bid proposals for water, sewer, and civil work without
paying for expensive proprietary tools.

Everything runs locally on your machine. No account, no cloud, no subscriptions.

What It Does
------------

- Maintain a material catalog with pricing and price history
- Build crews with burdened labor rates and production rates
- Track equipment costs (owned and rented)
- Create bid estimates organized by section and line item
- Auto-calculate totals with overhead, profit, bond, and tax markups
- Print bid proposals
- Duplicate previous bids as starting points for new jobs

Runs on Windows and Linux.

Getting Started
---------------

Requires Node.js 20+ and C++ build tools (Visual Studio with "Desktop
development with C++" on Windows, or build-essential on Linux).

    git clone https://github.com/Person810/BidSheet.git
    cd BidSheet
    npm install
    npm run dev      (compiles main process + starts Vite renderer)

    Then in a second terminal:
    npm start        (launches the Electron app)

To build installers:

    npm run dist:win       (Windows .exe)
    npm run dist:linux     (Linux .AppImage and .deb)

Contributing
------------

Contributions welcome. This project is in early development.

If you are a contractor or estimator, your real-world feedback is the most
valuable contribution. Open an issue describing your workflow and what you need.

For code contributions, fork the repo and open a pull request.

Bug reports and feature requests go to the GitHub Issues tracker.

Project Info
------------

Website:    (coming soon)
Issues:     https://github.com/Person810/BidSheet/issues
License:    GPLv3 - see LICENSE file
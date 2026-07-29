# Implementation Plan: HDD Multi-Bore Pricing & Dynamic Rates Fixes

## Proposed Changes

### Database & Migrations
Introduce dedicated database columns `hdd_bores_per_pit` (INTEGER DEFAULT 1) and `hdd_additional_pipes_json` (TEXT) in `trench_profiles` via migration `V50` to replace field reuse.

### Estimator logic
Adjust `calculateHDD` to receive lengths in canonical feet, converting internally to meters if en-AU, and correct division calculations.

### UI & Forms
Update `TrenchProfileForm.tsx` and `TrenchProfileList.tsx` to read/write these new fields, and wire `customRates` from settings. Localize default tab in `HDDRatesModal.tsx`.

## Verification Plan
- Unit tests in `hddCalc.test.ts`.
- Database migration tests.
- Typecheck and manual verification.

# Feature Specification: HDD Multi-Bore Pricing & Dynamic Rates Fixes

**Feature Branch**: `feature/hdd-trenching`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description: "/speckit-all to fix the issues but DO NOT commit upstream I must manually test"

## User Scenarios & Testing

### User Story 1 - Proper Metric Unit Calculations (Priority: P1)
As an estimator in Australia (en-AU), when I view or calculate estimate pricing for an HDD trench profile, the calculation engine must correctly interpret the stored length (which is saved as feet in the database) by converting it to meters, preventing inflated pricing.

**Why this priority**: Correct commercial pricing calculations are the core value of the application.
**Independent Test**: Can be tested via unit tests in `hddCalc.test.ts` asserting that calculations receive canonical feet but return metric pricing correctly.

**Acceptance Scenarios**:
1. **Given** a profile with method set to HDD, **When** calculating pricing under en-AU locale, **Then** length is read as feet and converted to meters internally.
2. **Given** a profile with method set to HDD, **When** calculating pricing under en-US locale, **Then** length is read as feet directly.

---

### User Story 2 - Dedicated HDD Database Columns (Priority: P1)
As the developer, I want to store the HDD-specific data (number of bores per pit and additional pipes JSON) in dedicated database columns rather than reusing the `backfill_type` field, preventing compatibility bugs.

**Why this priority**: Field-reuse is error-prone and causes weird edge bugs.
**Independent Test**: Can be tested via database migrations tests asserting that version 50 successfully creates the columns.

**Acceptance Scenarios**:
1. **Given** a new or upgraded database, **When** migrations are run, **Then** the columns `hdd_bores_per_pit` and `hdd_additional_pipes_json` exist in the `trench_profiles` table.

---

### User Story 3 - Custom Rates Integration & Modal Localization (Priority: P2)
As an estimator, I want custom rates configured in Settings to be fully integrated into all HDD profile estimators and lists, and I want the rates configuration modal to open with the correct locale tab by default.

**Why this priority**: Critical to ensure custom business calculations align with the configured rates.
**Independent Test**: Can be tested via unit tests in `hddCalc.test.ts` asserting that custom rates affect calculator outputs.

**Acceptance Scenarios**:
1. **Given** custom rates are set in Settings, **When** calculating HDD pricing, **Then** the custom rates are used instead of defaults.
2. **Given** the app standard unit system is Metric, **When** opening the HDD Rates modal, **Then** the Metric (en-AU) tab is active by default.

---

### Edge Cases
- **Swapping Run Types**: If a user switches a profile's method from HDD back to Open Cut, the new HDD columns must be handled correctly without affecting open-cut takeoff views or calculations.
- **Backdrop Clicks**: The HDD Rates modal must not close accidentally on background click (handled by `dismissOnEscOnly`).

## Requirements

### Functional Requirements
- **FR-001**: Introduce migration `migrateV50` to add `hdd_bores_per_pit` (INTEGER DEFAULT 1) and `hdd_additional_pipes_json` (TEXT) columns to `trench_profiles`.
- **FR-002**: Ensure `hdd_rates_json` is whitelisted in `catalog-sync.ts` whitelistedSyncedSettings.
- **FR-003**: Rework `calculateHDD` to accept length in canonical feet, converting it internally to meters for metric calculations.
- **FR-004**: Wire custom rates from settings into all calls to `calculateHDD` in `TrenchProfileForm.tsx` and `TrenchProfileList.tsx`.
- **FR-005**: Correct the production rate math in `hddCalc.ts` (division vs multiplication).
- **FR-006**: Set the default active tab of the HDD Rates modal based on the current unit system.
- **FR-007**: Ensure the settings page stages changes made in the HDD rates modal cleanly.

### Constitution-Derived Requirements
- **CR-001**: Local calculations must be completely deterministic and tested before committing.
- **CR-002**: All commits must be explicitly authorized by the user before running.

## Success Criteria

### Measurable Outcomes
- **SC-001**: 100% of unit tests pass cleanly.
- **SC-002**: TypeScript typecheck passes with 0 errors.
- **SC-003**: The app runs locally and HDD calculations are correct.

# Tasks: Material Category CRUD Rework

**Input**: Design documents from `specs/001-material-category-crud/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Tests are MANDATORY. Every behaviour change is guarded by testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup & Diff Reset (Cleanup)

**Purpose**: Discard lockfile changes and drop dead code highlighted by the maintainer.

- [x] T001 Revert all changes in `package-lock.json` to keep the PR diff clean.
- [x] T002 Delete unused file `src/renderer/components/CategoryPickerModal.tsx`.
- [x] T003 Remove unused `reassignMaterialsCategory` type declarations in `src/shared/types/ipc.ts` and `src/shared/types/window.d.ts`.
- [x] T004 Remove unused `reassignMaterialsCategory` preload bridge registration in `src/main/preload.ts`.
- [x] T005 Remove unused `db:materials:reassign-category` IPC handler registration in `src/main/ipc/catalog.ts`.

**Checkpoint**: Typecheck compiles clean. The dead code is dropped.

---

## Phase 2: Cloud Sync Documentation (Backend)

**Purpose**: Document the local-only sync limitation of category hard deletes.

- [x] T006 Add warning code comments inside `deleteMaterialCategory` in `src/main/ipc/material-categories.ts` explaining that category hard deletes are local-only and do not propagate through cloud sync yet.

**Checkpoint**: Comment is added. Tests pass.

---

## Phase 3: Stranded Sidebar Selection Fix (UI)

**Goal**: Automatically update active sidebar category selection after deletion to prevent stranded empty states.

### Red Tests for User Story 3 Rework ⚠️

- [x] T007 [US3] Verify `getPostDeleteCategorySelection` test suite in `src/renderer/components/materialCategoryForm.test.ts` is running and passing successfully.

### Implementation for User Story 3 Rework

- [x] T008 [US3] Wire `getPostDeleteCategorySelection` into the `onDeleteSuccess` callback (or deletion handler) in `src/renderer/pages/MaterialsPage.tsx` to set the active sidebar category to the new selection.
- [x] T009 [US3] Run focused tests and verify no errors.

**Checkpoint**: Active sidebar selection correctly resets upon deletion of the active category.

---

## Phase 4: Polish & PR Submission

**Goal**: Full verification of compile gates, typecheck, tests, and PR branch updates.

- [x] T010 Run full test suite: `npm test`.
- [x] T011 Run typecheck: `npm run typecheck`.
- [x] T012 Run production build: `npm run build`.
- [x] T013 Verify PR diff contains no lockfile edits, no dead files, and only the required category CRUD changes.
- [x] T014 Push the updated branch `feature/material-category-crud` to your fork origin and verify CI runs green.

**Checkpoint**: PR is clean, tests pass, CI runs successfully.

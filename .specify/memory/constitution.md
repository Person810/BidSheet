<!--
Sync Impact Report
- Version change: 1.1.0 → 1.2.0
- Modified guidance:
  - Added Principle IX: Database Authority and Renderer Freshness
  - Product and Technical Constraints: defined permissible transient renderer state
  - Development Workflow and Quality Gates: added authoritative-data refresh review
- Added sections:
  - IX. Database Authority and Renderer Freshness
- Removed sections: none
- Templates synchronized:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
  - ✅ CONTRIBUTING.md
- Runtime guidance reviewed:
  - ✅ README.md (no change required)
  - ✅ SECURITY.md (existing reporting guidance remains compatible)
  - ✅ Installed Spec Kit skills (generic constitution-loading guidance remains compatible)
- Follow-up TODOs: none
-->
# Sigtech Quote Desk Constitution

## Core Principles

### I. Specification Before Implementation

Every feature and material behaviour change MUST begin with a written, testable
specification describing user value, scope, acceptance scenarios, edge cases and
measurable outcomes. Material ambiguity MUST be resolved before implementation
planning. Plans and tasks MUST trace back to approved requirements. If implementation
reveals a conflict or missing requirement, work MUST stop until the specification and
dependent artifacts are updated.

Rationale: the product is being redirected from a construction estimator into a focused
commercial quoting tool. Written intent prevents inherited architecture or incidental
code from deciding the product.

### II. Tests Before Production Code

Behavioural changes MUST follow red-green-refactor:

1. Write the smallest test that expresses the approved requirement.
2. Run it and confirm it fails for the expected missing or incorrect behaviour.
3. Make the smallest production change that passes the test.
4. Run focused and regression suites.
5. Refactor only while all tests remain green.

Bug fixes MUST begin with a reproducing test. Database migrations, calculations,
imports, exports, destructive operations and commercial rules MUST have automated
regression coverage. Presentation-only changes MAY use a documented manual validation
when automation would test markup rather than behaviour, but extractable state and
logic MUST remain automated. Tests MUST NOT be weakened merely to accept an
implementation; the specification must change first when expected behaviour changes.

Rationale: commercial and catalogue regressions can silently corrupt quotes or erase
business knowledge. Test-first evidence makes intended behaviour reviewable.

### III. User-Workflow Simplicity

The interface MUST be designed around the user's real workflow and demonstrated
computer literacy. User-facing language MUST use familiar commercial terms. Primary
tasks MUST have an obvious entry point, visible outcome and safe cancellation path.
Complexity MUST stay behind the interface rather than appearing as additional menus,
configuration or technical concepts.

Every user-facing feature MUST define an independently testable journey and include
usability validation proportionate to its risk. Destructive actions MUST explain their
effect and require deliberate confirmation. New navigation, modes or required fields
MUST be justified by user value.

Rationale: adoption is the product constraint. A capable feature that the intended user
cannot discover or confidently operate has failed.

### IV. Local-First and Subscription-Free

Core quoting, catalogue, pricing, document generation, search, backup and recovery
MUST work on company-controlled hardware without an account, subscription or network
connection. User data MUST remain available locally in a documented, recoverable form.
Network services and hosted features MUST be optional, explicitly approved and unable
to gate local core functionality.

Features MUST be validated with network access unavailable when offline operation is
relevant. No telemetry, account dependency or recurring service cost may be introduced
without an explicit constitution amendment.

Rationale: the approved product direction is a self-hosted or single-machine tool with
no subscription dependency.

### V. Commercial Data Integrity

Prices, quantities, costs, margins, markups, freight, taxes and totals MUST be
deterministic, reproducible and traceable to their inputs. Commercial values MUST NOT be
silently invented, inferred or changed. Overrides MUST be visible and preserve the
reason or provenance required by the feature specification.

AI MAY assist with extraction, matching, comparison and drafting, but it MUST NOT be
the authoritative calculator or silently approve commercial values. Data-changing
operations MUST either complete fully or leave the prior state intact. Specifications
MUST identify records and attributes that must be preserved.

Rationale: the application will become a commercial source of truth. Convenience
cannot outrank correctness or traceability.

### VI. Safe Evolution and Recovery

Changes to persisted data MUST include a migration and compatibility assessment.
Migrations MUST be deterministic, tested against representative existing data and
preserve user records unless deletion is an explicit approved requirement. Destructive
or irreversible changes MUST define rollback or recovery before implementation.

Risky data changes MUST verify current backup and restore behaviour. Releases MUST NOT
depend on users manually repairing databases. Startup, upgrade, backup and restore paths
MUST receive regression coverage whenever they are affected.

Rationale: a local-first application places custody of business history on the desktop
application and its upgrade path.

### VII. Incremental Delivery and Scope Discipline

Work MUST be organized into the smallest complete user journeys that can be specified,
tested and demonstrated independently. The highest-value journey MUST be deliverable as
an MVP before optional stories. Every increment MUST leave the branch in a green,
buildable state.

Speculative architecture, unused abstractions and unrelated ERP functionality MUST NOT
be added. Reuse of inherited BidSheet code MUST be justified by the target workflow,
not by its presence in the fork. Scope expansion requires an updated specification and
plan.

Rationale: controlled vertical slices reduce the risk of an open-ended rewrite and
provide early feedback from real quoting work.

### VIII. Open-Source and Dependency Responsibility

The project MUST comply with the GPLv3 licence and retain required notices and source
availability obligations. New dependencies MUST have a documented purpose, compatible
licence, maintained release history and acceptable security posture. Versions MUST be
locked through the project dependency manifest and lockfile.

Dependency changes MUST pass production dependency auditing. Upstream BidSheet changes
MUST be reviewed as deliberate patches; they MUST NOT be merged blindly when they
conflict with product scope, local-first operation or data integrity.

Rationale: the fork inherits both useful code and continuing legal, security and
maintenance responsibilities.

### IX. Database Authority and Renderer Freshness

The local database MUST be the authoritative source for all persisted business data.
The renderer MUST NOT maintain an independent cache or duplicate source of truth for
categories, materials, clients, jobs, prices, settings or any other persisted entity.
After a successful persisted-data mutation, every affected view MUST re-query the
authoritative main-process operation before presenting the result as current.

The renderer MAY hold transient interaction state required to display a query result,
edit an unsaved form, control a dialog, sort or filter the currently displayed result,
or report progress. Such state MUST NOT outlive the relevant view as an authoritative
record, decide a destructive operation without main-process revalidation, or replace a
database query after stored data may have changed. Optimistic updates MAY provide
temporary feedback only when they are reconciled immediately with the authoritative
result and cannot silently diverge.

Destructive and commercially significant operations MUST validate current persisted
state in the main process within the operation's transaction or equivalent consistency
boundary. Performance concerns in the single-user desktop application MUST NOT justify
stale business data or renderer-owned persistence caches.

Rationale: a single local source of truth is simpler to reason about and prevents stale
renderer snapshots from blocking work, misreporting catalogue state or making unsafe
decisions.

## Product and Technical Constraints

- The primary deployment is a locally installed Windows desktop application; supported
  additional platforms MUST not weaken the Windows workflow.
- SQLite remains the local source of truth until a separately specified multi-user
  requirement justifies another storage model.
- The renderer MUST access privileged operations only through the typed preload and
  main-process boundary. Renderer code MUST NOT gain direct filesystem or database
  access.
- Renderer components and stores MUST treat queried persisted records as disposable
  display snapshots. They MUST re-query affected records after mutations and MUST NOT
  use a stored snapshot as the final authority for destructive or commercially
  significant decisions.
- Commercial calculations MUST live in independently testable functions or services,
  separate from presentation code.
- Authored executable source files SHOULD remain at or below 400 physical lines.
  Files from 401 through 600 lines are acceptable without special justification.
  Files from 601 through 799 lines MUST receive an extraction assessment in the
  implementation plan or code review. An authored executable source file that reaches
  800 lines MUST be refactored before material new behaviour is added.
- Declarative data, generated code, type registries, stylesheets and ordered database
  migrations MAY exceed these thresholds when splitting would reduce clarity or safety,
  but the plan or review MUST identify the exemption and its rationale. Tests MUST
  protect behaviour before any size-driven refactor.
- Specifications involving persisted data MUST state migration, preservation, backup
  and recovery expectations.
- Specifications involving user workflows MUST define empty, error, cancellation and
  destructive-action states.
- Security-sensitive changes MUST follow `SECURITY.md`; secrets and customer commercial
  data MUST not be written to logs or committed to the repository.
- GPLv3 compatibility and production dependency audit results are release gates.

## Development Workflow and Quality Gates

Every feature follows this sequence:

1. Specify user stories, acceptance scenarios, edge cases and measurable outcomes.
2. Clarify material ambiguities.
3. Plan architecture, data effects, recovery and constitution compliance.
4. Generate dependency-ordered tasks with tests before corresponding production work.
5. Analyze cross-artifact consistency and resolve critical or high findings.
6. Implement in red-green-refactor order, recording evidence for destructive or
   commercially significant behaviour.
7. Validate requirements, usability and offline behaviour as applicable.
8. Converge implementation against specification, plan and tasks before completion.

Before a story or release is considered complete:

- New tests MUST have been observed failing for the expected reason before production
  implementation.
- Focused tests and the full regression suite MUST pass.
- Renderer and main-process type checking MUST pass.
- The production build MUST succeed.
- Data migrations and backup/restore checks MUST pass when applicable.
- User journeys and accessibility checks MUST pass when applicable.
- Production dependencies MUST pass the configured audit gate.
- Code review MUST report touched executable source files above 600 lines and MUST
  include a refactoring task or documented exemption for any touched file at or above
  800 lines.
- Git diff checks MUST show no accidental generated files, secrets or unrelated edits.
- Persisted-data workflows MUST demonstrate that affected renderer views re-query after
  mutation and that destructive or commercially significant decisions are revalidated
  against current database state in the main process.

Code review MUST verify requirement traceability, test-first evidence, data preservation,
scope discipline and constitution compliance. A failed gate blocks completion unless
the constitution is amended through the governance process below.

## Governance

This constitution is the highest project-level authority for specifications, plans,
tasks, implementation and review. When another project artifact conflicts with it, the
artifact MUST be corrected.

Amendments require:

1. A documented reason and impact assessment.
2. Explicit approval by the project owner.
3. Updates to affected Spec Kit templates and runtime guidance.
4. A migration or transition plan when existing work is affected.
5. A semantic version change recorded in the Sync Impact Report.

Versioning rules:

- **MAJOR**: removes or materially weakens a principle, or introduces incompatible
  governance.
- **MINOR**: adds a principle or materially expands mandatory guidance.
- **PATCH**: clarifies wording without changing obligations.

Every specification plan MUST include a constitution check before research and after
design. Every implementation review MUST confirm the applicable gates. Compliance
exceptions are not permitted through informal task notes; they require an approved
constitution amendment.

**Version**: 1.2.0 | **Ratified**: 2026-07-17 | **Last Amended**: 2026-07-18

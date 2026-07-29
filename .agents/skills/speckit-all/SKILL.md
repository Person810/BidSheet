---
name: speckit-all
description: "Orchestrate the complete gated Spec Kit preparation workflow from one feature request—specify, clarify, plan, tasks, and analyze—with extensive bounded subagent research for independent workstreams. Use for `/speckit-all`, Spec Kit all, whole-sprint packages, or multi-file strangler refactors. Implement only with an explicit `--implement` instruction."
---

# Speckit All

Create one coherent sprint package while preserving every individual Spec Kit gate.
Coordinate centrally and delegate independent investigation aggressively.

## Inputs

Treat text after the command as the feature description:

```text
/speckit-all <feature description> [--threshold N] [--target N] [--implement]
```

For size refactors, default to threshold 800, target 600, and preparation only.

## Preflight

1. Require `.specify/`, the constitution, and the five component skills used below.
2. Apply each component skill's extension-hook rules.
3. Inspect Git status. Stop only for changes overlapping targets or Spec Kit artifacts.
4. Prevent duplicate sprint specs; reuse one only when explicitly continuing it.

## Inventory and Parallel Research

For source-size work, run `scripts/inventory-source-files.ps1` from the repository root.
Use physical lines. Exclude dependencies, build output, coverage, generated/vendor files,
lockfiles, snapshots, maps, and binaries. Keep declarative data, type registries,
stylesheets, and ordered migrations visible as exemption candidates.

Spawn one read-only subagent per candidate file, in waves up to available concurrency.
Each worker owns one file and reports responsibilities, coupling, test coverage,
observable behaviour, strangler seams, dependencies, risks, rollback boundary, proposed
modules, and whether an exemption is justified.

Workers MUST NOT edit source or shared Spec Kit artifacts. Retry or visibly mark an
incomplete audit. The coordinator alone consolidates reports and writes artifacts.

## Gated Pipeline

Read each complete component `SKILL.md` immediately before its stage and follow it:

1. Specify: `../speckit-specify/SKILL.md`. Create one sprint feature with independently
   testable workstreams and exclude unrequested behaviour changes.
2. Clarify: `../speckit-clarify/SKILL.md`. Always run; resolve exemptions and targets.
3. Plan: `../speckit-plan/SKILL.md`. Use audit evidence, extraction seams, rollback, and
   validation. Document every exemption fully.
4. Tasks: `../speckit-tasks/SKILL.md`. Parallelize only non-overlapping ownership.
5. Analyze: `../speckit-analyze/SKILL.md`. Resolve critical/high inconsistencies.

## Strangler TDD Requirements

For every non-exempt target, require baseline gates and line count, characterization
tests, expected red evidence before production behaviour needed by an extraction, a
green baseline, one extraction seam at a time, focused and full regression gates,
old-code removal only after replacement proof, and a final line/cohesion assessment.

Do not mix behavioural redesign, opportunistic cleanup, or schema changes into a
size-only strangler sprint.

## Stop Boundary

Without `--implement`, stop after analysis. Do not edit production code, commit, push,
create issues, or invoke implementation. Report feature directory; candidate, refactor,
exemption, and incomplete counts; agent coverage; tasks/workstreams; analysis severities;
and next command `/speckit-implement`.

With `--implement`, pause after analysis and present readiness. Proceed only after user
approval, then read and follow `../speckit-implement/SKILL.md`. Assign non-overlapping
workstreams to subagents in waves. The coordinator owns shared artifacts, integration,
full regression gates, and commits.

## Guardrails

- Never treat an exemption candidate as approved automatically.
- Never allow concurrent edits to the same file or shared artifact.
- Stop on constitution conflicts, material ambiguity, or overlapping target changes.
- Prefer small extractions over wholesale rewrites.
- Preserve behaviour unless the approved specification changes it.


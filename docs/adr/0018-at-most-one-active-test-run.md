---
type: adr
id: ADR-0018
status: accepted
title: At Most One Active Test Run
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
  - "[[Building Block View]]"
  - "[[Runtime View]]"
---

# At Most One Active Test Run

At most one **Test Run** is active per Vault at any time. `TestExecutionService.execute()` invoked while a run is already active returns `Result.failure({ code: "RUN_IN_PROGRESS", details: { activeRunId } })`. To start a new run the user must first cancel the active one via `TestExecutionService.cancel(runId)`, which sends SIGTERM to the runner subprocess and emits `testrun.cancelled`.

A queued / parallel model is appealing but every variation drags in real complexity: cross-reload queue persistence (with its migration + corruption stories), settings-snapshotting per queued item, UI affordances for queue depth and reordering, additional events (`testrun.queued`), and report-file collision avoidance for parallel runs. For an MVP the honest contract — "one run at a time, cancel to start a new one" — preserves the predictability that's the dashboard's job, and the `TestRunAggregate` stays a single-active state machine.

## Considered alternatives

- **Queue subsequent Runs.** Solves the "I clicked Run twice" annoyance. Rejected for V1: persistence, snapshotting, cancel-all semantics, and event-vocabulary expansion are out of scope; queueing is a V2 candidate.
- **Cancel-and-replace** (a la IDE "Run" buttons). Rejected: silently destroys the first run's partial Evidence, which contradicts the audit-first product wedge.
- **Concurrent runs in parallel subprocesses.** Rejected: per AD-6 we serialise *within* a run for predictable evidence ordering; parallel *between* runs would re-introduce report-file collisions (`.testrunner/reports/cucumber-report.json` is a fixed path), confuse the live monitor, and break the dashboard's "one truth" UX.
- **Hybrid (reject same-scope, queue different-scope).** Rejected: mental model is hard to explain.

## Consequences

- `TestExecutionService.execute()` checks the `TestRunAggregate` state; emits `Result.failure({ code: "RUN_IN_PROGRESS" })` if a run is active.
- `Run` controls in every view (`TestHubView`, `UseCaseExplorerView`, `SuiteExplorerView`, `SpecificationExplorerView`) are visually disabled while a run is active, with a tooltip ("Run in progress — cancel to start a new one"). Disabled controls without tooltip discoverability is a UX bug.
- `TestExecutionService.cancel(runId)` is synchronous from the user's perspective; the new Run cannot start until `testrun.cancelled` settles.
- Cancelled runs still produce a (partial) `report.detected` → `report.imported` → `evidence.generated` chain. Evidence carries `status: "cancelled"` and counts the scenarios that did complete.
- Plugin reload mid-run is unrecoverable: Obsidian-parent process dies → runner subprocess dies → the next plugin load starts with an empty `TestRunAggregate`. Orphan partial reports under `.testrunner/reports/` are overwritten on the next Run.
- CI is unaffected — workflow-level concurrency is a GitHub-level concern, not the plugin's.

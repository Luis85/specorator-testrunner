---
type: adr
id: ADR-0032
status: accepted
title: Durable Execution Log
date: 2026-06-22
related:
  - "[[0031-test-hub-home-shell]]"
  - "[[0022-scenario-history-projection]]"
  - "[[0018-single-active-run]]"
---

# Durable Execution Log

The Test Hub home's overview section (ADR-0031) will host a "health hero" that
shows a trustworthy "last run: PASS/FAIL at <time>" verdict. The two existing
run-history sources cannot answer that honestly: the traceability snapshot's
`recentRuns` and `RunHistoryService` BOTH derive from Evidence partitions
(ADR-0016/ADR-0022), so they only see runs that produced evidence. A run that
produced none — an `errored` spawn fault, or a `cancelled` run that never wrote
a report — is invisible to them, so they keep reporting a STALE earlier run as
"latest". The hero would then show a green "last run passed" after the user's
most recent run actually errored.

This ADR records a NEW durable execution log that captures EVERY terminal run,
independent of evidence, so a later read can serve an honest latest-run verdict.

**This PR (E1-PR1) is record-only**: it lands the recording infrastructure (the
domain projection, the service, the recorder, and the wiring) and proves the log
accumulates via tests. The read path (`latest`/`list`) and its consumer (the
hero) ship together in a follow-up so no export is dead.

## Decision

### A durable, evidence-independent log
Every terminal run is appended to a single newest-first JSON array at
`.testrunner/history/execution-log.json` (under `settings.paths.testRunnerPath`),
capped at `HISTORY_DEPTH_DEFAULT`. The entry carries the run's identity, scope,
target, status, timestamps, and — when present — its duration and result
counts. It is written through the vault filesystem alongside the regenerable
`scenario-index.json`, mirroring the scenario-history idiom (folder ensured
before write, read-modify-write serialized through one `SerialQueue` so
back-to-back runs cannot clobber each other's append).

### Drained before maintenance touches the runner folder
The log lives under `settings.paths.testRunnerPath`, which `reset()` deletes and
`repair()` re-syncs. Writes are fire-and-forget, so a slow write from the
previous run could otherwise land AFTER reset removed the runtime, re-materialising
`<runner>/history/execution-log.json` with a pre-reset run. The service therefore
exposes `whenSettled()` (drains its `SerialQueue`), and `DefaultMaintenanceService`
awaits it UNDER the maintenance lock — alongside the post-run import drain — before
the destructive delete/re-sync. The lock guarantees no NEW run can enqueue a write,
and `whenSettled` drains the tail of the PREVIOUS run's, closing the race exactly as
the post-run evidence drain does (ADR-0018).

The log is its OWN source of truth, NOT derived from Evidence. That is the whole
point: it records the very runs the evidence-derived sources skip.

### A dedicated recorder, not folded into PostRunCoordinator
A small `ExecutionLogRecorder` subscribes to the three terminal run events
(`testrun.completed | testrun.failed | testrun.cancelled`) and records the
just-finished run on each. It deliberately does NOT live inside
`DefaultPostRunCoordinator`:

- The coordinator gates on importable statuses — it skips an `errored` run and a
  `cancelled`-without-report run because there is no Cucumber report to import.
  This log must record exactly those, so it applies NO importable-status gate.
- Keeping execution-logging separate from the coordinator's evidence-import /
  dashboard-refresh concern keeps each subscriber single-purpose.

An `errored` run is published as `testrun.failed` with `run.status === "errored"`
and a `cancelled` run as `testrun.cancelled`, so subscribing to the three
terminal events covers every terminal outcome. The recorder reads the SAME
`lastRun` source the coordinator does (`DefaultTestExecutionService.lastRun`,
ADR-0018), records FIRE-AND-FORGET (it must not await in the handler, or it would
hold the single-run slot through the log write — the coordinator's rationale),
and never throws into the bus. `record` itself never rejects: a missing or
corrupt log file reads as empty (logged), and a write fault returns `err`.

## Consequences
- The log starts accumulating on every terminal run as soon as this PR lands;
  it is verified by unit tests but has no reader yet.
- The read path (`latest`/`list`) and the health hero that consumes it land in a
  follow-up E1 increment, so this PR ships no dead code.
- The cap is `HISTORY_DEPTH_DEFAULT`; the log is a bounded, regenerable-by-
  accumulation projection, so a corrupt or hand-edited file degrades to empty
  rather than erroring a run.
- A late terminal event after unload cannot drive a spurious write: the recorder
  detaches its subscriptions in `onunload`. It diverges from the post-run
  coordinator (which detaches synchronously) in ONE case — when a run is active at
  unload, the recorder stays subscribed until the run fully SETTLES
  (`whenActiveSettles()`), so the run's terminal event is recorded and the
  latest-run verdict isn't stale after reload. Gating on settle (not on the
  unload `cancel()`) covers both terminal paths: our cancel publishing
  `testrun.cancelled`, AND the finalization race where the child has already
  closed so `cancel()` no-ops with `RUN_CANCELLED` and the real
  `testrun.completed`/`failed` publishes on its own. The recorded run produces no
  *new* import — the post-run coordinator is already stopped — so keeping the
  recorder alive cannot drive an evidence write.

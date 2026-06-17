# US-057 Per-scenario run history — Design

- **Story:** [[US-057]] Per-scenario run history (EPIC-014, P1, V2.0)
- **Date:** 2026-06-16
- **Status:** Approved (brainstorm)
- **ADR:** [[0022-scenario-identity-and-history-store]] (accepted; this story implements its history layer) · supersedes the [[0017-use-case-automation-rollup-with-wip-exclusion]] "floor"
- **Depends on:** [[US-056]] Scenario Reference (shipped) · a **minimal slice of [[US-060]]** pulled forward (see D2)
- **Unblocks:** [[US-058]] flakiness & quarantine · [[US-059]] failure triage view

## Problem

V1's unit of identity is the **Feature**, and the dashboard's Use Case roll-up
(`computeAutomationStatus`, ADR-0017) has no per-scenario history to read. To
avoid a targeted single-Feature rerun regressing a Use Case that already passed,
the policy leans on two workarounds: a **prior-status "floor"** (keep `passing`
if the persisted status was already `passing`) and **scope-awareness** (only a
`use-case`/`all` run can mark the whole UC passing). Both are proxies for the
real thing — knowing each scenario's actual last result.

US-056 gave every scenario a stable **Scenario Reference**
(`<featurePath>::<scenarioName>[::row-<digest>]`) and attaches it to every report
result. US-057 builds the **history** on that key, then rewires the roll-up to
derive from real per-scenario state and **deletes the floor**.

## Source of truth (ADR-0022)

ADR-0022 is explicit and **not** amended here: the year-month-partitioned
**Evidence Markdown notes are the authoritative per-run record**; scenario
history and any NDJSON index are **rebuildable projections over the notes, never
an independent source of truth** (this honors ADR-0007). So US-057's NDJSON +
runtime index are *projections*; the durability guarantee is "rebuildable from
the Evidence notes," not "the NDJSON is the record."

For that guarantee to hold *keyed by Scenario Reference*, the note must persist
each scenario's `scenarioRef`. Today's note renders a human-readable
`## Scenarios` list (status + name) but no `scenarioRef` and nothing
machine-parseable — that is US-060's job, which is still `proposed`. D2 pulls the
**minimal** slice of US-060 forward so the projection stays rebuildable now.

**When evidence Markdown is disabled** (`generateEvidenceMarkdown = false`) no
note — and therefore no `scenarioRef` block — is written, so the committed
per-run `scenarios.ndjson` is the only on-disk scenario record. Decision (codex
P2): the per-run NDJSON log is itself a **committed artifact in the Evidence
tree** (the "append-only NDJSON under `Test Evidence/`" EPIC-014's DoD sanctions),
so it is the committed record for that case — history is never lost and the index
rebuilds from it. The note's `testrunner-scenarios` block is an **additional**
rebuild source available only when notes are enabled (the default). The slice's
rebuild-from-the-human-note property therefore holds for the common case; the
opt-out is respected (no note is forced).

## Decisions

### D1 — Two projections over the authoritative notes

| Artifact | Where | Committed? | Role |
| --- | --- | --- | --- |
| Per-run scenario log | `<evidenceRoot>/YYYY/MM/<runId>/scenarios.ndjson` (ADR-0016 partition, beside `summary.md`) | **Yes** — git-mergeable | The AC's "append-only NDJSON history"; one immutable file per run |
| Scenario index | `<testRunnerRoot>/history/scenario-index.json` (ADR-0002 runtime) | No — git-ignored, regenerable | Fast `scenarioRef → latest status + last-N` read model for the roll-up |

Both locations use the **configured roots** — `settings.paths.evidencePath` and
`settings.paths.testRunnerPath` — never the literal defaults, so a vault that
customizes either folder keeps its logs/index inside the configured trees (codex
P2). The table shows the default folder names only for illustration.

- **Per-run log is write-once.** All of a run's scenario lines are written in a
  single `writeFile` of a new per-run file. So it is append-only at the *history*
  level (a new file per run) with **no append primitive** needed on
  `VaultFileSystem`, and **git-mergeable** by construction (distinct runs never
  touch the same file). Goes through `VaultFileSystem` (vault-indexed).
- **Idempotent re-imports.** `PostRunCoordinator.importLastRun()` can re-run the
  flow for the same `runId`. The log `writeFile` **overwrites** the deterministic
  per-run file (no append, no duplication, no failure), and the index `fold`
  **de-dupes by `runId`** (drops any prior entry for that run before pushing) so a
  re-import never inflates a scenario's `recent` history (codex P2).
- **Never materializes `.testrunner` prematurely.** On a fresh/uninitialized
  vault the Evidence root is absent; the rebuild returns **without writing** the
  index, so it does not create `.testrunner/history/...` before the user
  initializes the Test Hub (codex P2). An absent index reads as empty history.
- **Index is a regenerable cache** under `.testrunner/` via `AbsoluteFileSystem`
  (`writeAbsolute`/`readAbsolute`/`getVaultBasePath`). Only the per-run logs are
  committed, so the git-mergeable guarantee stays clean. On load, if the index is
  missing/unreadable it is **rebuilt by scanning the per-run logs newest-first**
  (bounded by depth). "Survives plugin reloads" holds via the committed logs +
  rebuild.

**NDJSON line schema (v1):**

```json
{ "v": 1, "scenarioRef": "Specifications/features/UC-001-x.feature::Login",
  "runId": "RUN-2026-06-16-...", "status": "passed", "at": "2026-06-16T...Z",
  "durationMs": 1234, "scope": "use-case" }
```

- `status` normalized to `passed | failed | skipped` (per-scenario analogue of
  `overallStatus`). `at` = `run.finishedAt ?? run.startedAt`. `v` versions the
  line; retries/error-group fields are left for US-058 without a forced bump.
- **One line per scenario result that has a `scenarioRef`.** Results with an
  unset ref (US-056's graceful-degradation fallback) are **skipped** — "shown in
  the note, not aggregated into history" (consistent with ADR-0022 + US-056).

**Index shape:** `{ v, depth, scenarios: { [ref]: { latest: {status, runId, at},
recent: Result[] } } }`, `recent` capped at **depth (default 50)**.

### D2 — Minimal US-060 slice: persist `scenarioRef` in the note

So the NDJSON stays a *rebuildable projection* of the authoritative Markdown
(ADR-0022), the evidence note must carry each scenario's `scenarioRef` +
normalized status in a **machine-parseable** form. US-057 adds exactly that and
no more; US-060 later completes the full audit stamp set (git SHA, env + base
URL, runner/browser versions, per-scenario counts) and may promote this into
frontmatter.

- **Form:** a fenced ` ```testrunner-scenarios ` JSON block in the note body,
  beside the existing human-readable `## Scenarios` list — robust to parse and it
  avoids straining YAML frontmatter with an array of objects. Each entry:
  `{ ref, status, durationMs? }`. The existing human list is unchanged.
- **Rebuild reads this block.** The index rebuild prefers the per-run
  `scenarios.ndjson`; where a log is absent it falls back to parsing this block
  from the note — making "rebuildable from the Evidence notes" literally true.
- Report-controlled values are JSON-encoded inside a fenced block, so the
  existing Markdown-injection concerns (`inlineMarkdownText`) do not apply to it.

### D3 — Roll-up derives from scenario history; floor removed

`computeAutomationStatus` gains a third argument — a per-scenario lookup — and
drops `useCase.automationStatus` (the floor) and the scope-awareness branch from
the pass decision:

```
computeAutomationStatus(features, latestStatusFor)
  latestStatusFor: (scenarioRef) => "passed" | "failed" | "skipped" | undefined
```

The `useCase` argument is dropped entirely: with the floor and scope-awareness
gone, the policy no longer reads `useCase.automationStatus` or `lastTestRun`.

**Migration fallback — considered and dropped (codex P2).** An upgraded vault has
Use Cases with a persisted `lastTestRun` + `automationStatus` but no per-scenario
history yet (old Evidence notes aren't keyed by `scenarioRef`, so they can't be
backfilled), so on first load they derive to `planned`/`missing-steps` until a
rerun. An earlier draft kept the **persisted status** for a UC with a
`lastTestRun` but no history, self-healing once any scenario recorded a result.
We **deliberately did not ship it**: the fallback's trigger (`lastTestRun` + no
history for the current refs) is *indistinguishable* from a UC whose history was
detached by a scenario **rename** (ADR-0022/US-056) — and that case must read as
never-run, not silently keep a stale `passing` (a rename should not preserve a
result that no longer maps to any current scenario). Honoring the migration
fallback would re-introduce exactly that masking. We accept the one-time KPI dip
for upgraded vaults instead: it self-corrects on the next run, and per ADR-0022
the history is a regenerable projection. `withDerivedStatus` therefore derives
purely from history with **no migration grace**, and a UC with no history for its
current refs reads as never-run regardless of `lastTestRun`.

Each non-`@wip` Feature's state is derived from its scenarios' latest statuses
(`featureScenarioRefs(feature)` → `latestStatusFor`):

- `missing-steps` — unchanged (`hasUndefinedSteps`): no scenarios, or any
  scenario has no steps. Outranks run state.
- **ran** — at least one of its refs has a latest status.
- **passing** — it has refs and *every* ref's latest is `passed`.
- **failing** — any ref's latest is `failed`.

Use Case roll-up over the active Features (preserving the ADR-0017 table shape):

| Active Feature states | result |
| --- | --- |
| No active Features | `not-planned` |
| Any active Feature `missing-steps` | `missing-steps` |
| No active Feature has run | `planned` |
| Any active Feature failing | `failing` |
| All active Features passing | `passing` |
| Some ran, none failing, not all passing | `implemented` |

A targeted single-Feature/scenario rerun now updates **only the scenarios it
touched**; siblings keep their last-known status, so a partial pass can neither
regress nor inflate the UC — **the floor and scope-awareness are no longer
needed and are deleted**. `useCase.lastTestRun` remains for the dashboard's
Recent Runs display; it is no longer an input to the pass decision.

**Accepted edge:** a Feature whose scenarios are *all* unresolved (no
`scenarioRef`, so no history) reads as never-run. Rare per US-056's collision-free
keying; documented, not worked around.

### D4 — `ScenarioHistoryService` (application)

New service, named to avoid colliding with the existing run-level
`RunHistoryService` (which projects `summary.md` frontmatter for the Evidence
Explorer).

```
application/services/scenario-history-service.ts (new)
  record(run, enrichedReport) -> Result<void>
     write Test Evidence/YYYY/MM/<runId>/scenarios.ndjson (skip unref'd results)
     fold the run's results into the index (update latest, push to recent,
       trim to depth) and write .testrunner/history/scenario-index.json
     publish scenario.history.recorded; best-effort, never throws
  latestStatuses() -> Result<Map<scenarioRef, status>>   (roll-up read model;
     rebuilds the index if missing)
  rebuildIndex() -> Result<void>                          (scan per-run logs
     newest-first, bounded by depth; fall back to the note block per D2)
```

- Owns its **own `SerialQueue`** — the EPIC-014 §9 "third user" of the shared
  serial queue — so index read-modify-write (`record`) and `rebuildIndex` never
  interleave even though they can be triggered from different entry points
  (post-run vs. plugin load).
- Depth from a new `historyDepth` setting (default **50**).

### D5 — Wiring

- **`PostRunCoordinator.runImportAndGenerate`** — add a `scenarioHistoryService`
  dep and call `record(run, enriched)` **after** `evidenceGenerationService.generate`
  and **before** `traceabilityService.refreshDashboard`, so the index is fresh
  when the roll-up reads it. Best-effort (a history fault must not fail the
  user-visible import/evidence outcome), matching the existing refresh-fault
  posture.
- **`DefaultTraceabilityService.withDerivedStatus`** — obtain `latestStatusFor`
  from the history service and pass it into `computeAutomationStatus`.
- **`evidence-generation-service`** — render the D2 `testrunner-scenarios` block
  (the enriched report already carries `scenarioRef` per result). Written
  regardless of the `generateEvidenceMarkdown` opt-out? No — the block lives
  *inside* the note, so it follows the note's opt-out; the **committed NDJSON +
  index are the always-on history** the roll-up depends on, written by
  `record()` independently of the Markdown opt-out.
- **`main.ts`** — construct `ScenarioHistoryService`; inject into the coordinator
  and traceability service; kick `rebuildIndex()` (or rebuild lazily on first
  `latestStatuses()`) on load.

### D6 — Event, settings, docs

- **Event:** add `scenario.history.recorded` (`{ runId, scenarioCount }`) to
  `domain-event.ts` and the Event Catalog — resolving the §16 V2 candidate noted
  in EPIC-014.
- **Settings:** add `historyDepth?: number` to `AutomationSettings` (default 50
  via a `HISTORY_DEPTH_DEFAULT` constant, mirroring optional
  `evidenceRetentionDays`); surface in the settings tab.
- **Docs:** mark the ADR-0017 floor/scope-awareness **superseded** (history-derived
  roll-up, ADR-0022/US-057); update **CONTEXT.md** (Scenario Reference history →
  *implemented*; floor removed; rename-detaches-history); note in **US-060.md**
  that the `scenarioRef` slice was pulled forward; satisfy the EPIC-014 DoD lines
  (floor removed, git-mergeable, survives reloads); add the Design link to
  **US-057.md**.

## Architecture & components

```
domain/policies/use-case-automation-policy.ts   (signature += latestStatusFor;
                                                  delete floor + scope branch)
domain/events/domain-event.ts                    (+ scenario.history.recorded)
domain/settings/settings.ts                      (+ historyDepth, default 50)

application/services/scenario-history-service.ts (new; D4)
application/services/post-run-coordinator.ts     (record() between generate and
                                                  refresh; new dep — D5)
application/services/traceability-service.ts     (inject lookup into the policy)
application/services/evidence-generation-service.ts (render testrunner-scenarios
                                                  block — D2)

main.ts                                           (compose + rebuild on load)
docs/adr/0017-...                                 (mark floor superseded)
CONTEXT.md, docs/issues/US-057.md, US-060.md, EPIC-014.md, Event Catalog
```

Reuses: `AbsoluteFileSystem` (index I/O), `VaultFileSystem` (per-run log),
`SerialQueue`, `featureScenarioRefs`/`parseScenarioReference` (US-056),
`useCaseIdFromPath`, `SettingsService`.

## Data flow

1. **Run + import:** `ScenarioIdentityResolver.enrich` attaches `scenarioRef` to
   each result (US-056) — already in place at the coordinator's seam.
2. **Record:** `ScenarioHistoryService.record` writes the per-run
   `scenarios.ndjson` (authoritative-adjacent projection) and updates the
   `.testrunner` index; `evidence-generation-service` writes the note with the
   `testrunner-scenarios` block (D2).
3. **Roll-up:** `refreshDashboard` → `withDerivedStatus` → `computeAutomationStatus`
   reads each scenario's latest status from the index (D3). No floor.
4. **Reload:** index absent → `rebuildIndex` scans per-run logs (note block as
   fallback) → roll-up reads as before.

## Testing (TDD)

- **Domain policy:** roll-up over Feature states from `latestStatusFor` —
  not-planned / planned / missing-steps precedence / failing / passing /
  implemented; `@wip` exclusion preserved; floor genuinely gone (a partial pass
  neither regresses nor inflates); all-unresolved-Feature edge → never-run.
- **`ScenarioHistoryService`:** `record` writes correct NDJSON lines (schema,
  status normalization, `at`/`scope`, unref'd results skipped); index update +
  trim-to-depth; `rebuildIndex` from per-run logs newest-first; index
  missing → rebuild; note-block fallback (D2); serial-queue ordering
  (record vs rebuild); `latestStatuses` map.
- **Evidence slice:** `testrunner-scenarios` block rendered + round-trip
  parseable; existing human `## Scenarios` list unchanged; follows the note
  opt-out.
- **Traceability:** `withDerivedStatus` passes `latestStatusFor`; roll-up
  reflects history.
- **Coordinator:** `record` called after generate, before refresh; best-effort
  (history fault doesn't change the import outcome); event published.
- **Settings:** `historyDepth` default 50 + override.

Coverage stays within existing thresholds (vitest 93% stmts/lines/funcs, 80%
branches). Patterns follow `tests/run-history-service.test.ts`,
`tests/use-case-automation-policy.test.ts`, `tests/post-run-coordinator.test.ts`.

## Out of scope (deferred, with owners)

- Flakiness score & quarantine workflow — **US-058** (consumes this history;
  adds the Cucumber Messages parser for retry granularity).
- Failure triage view (group a red run by error) — **US-059**.
- Any per-scenario history **view / UI** — US-057's user-facing payoff is the
  *existing* dashboard roll-up becoming truthful; no new view.
- Retention sweep / trimming of old per-run logs — **US-066** (the per-run logs
  accumulate; only the index is depth-bounded here).
- Full audit-grade evidence stamps (git SHA, env, versions, per-scenario counts)
  — **US-060** (US-057 pulls only the `scenarioRef` slice forward).

US-057 stops at: **per-scenario history is recorded as a committed, git-mergeable,
rebuildable projection, and the Use Case roll-up derives from it with the
ADR-0017 floor removed.**

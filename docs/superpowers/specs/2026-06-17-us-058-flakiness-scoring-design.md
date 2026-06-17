# US-058 Flakiness scoring — Design (slice 1: the scoring projection)

- **Story:** [[US-058]] Flakiness score & quarantine (EPIC-014, P1, V2.1)
- **Date:** 2026-06-17
- **Status:** Approved (brainstorm) — first slice
- **Builds on:** [[US-057]] per-scenario run history (shipped) ·
  [[0022-scenario-identity-and-history-store]]
- **Depends on:** [[US-057]], [[US-054]] (retry results)

## Scope of this slice

US-058 is large: a per-scenario stability score, a `@quarantine` tag that
excludes a scenario from the KPI (like `@wip`) but still runs it, a quarantine
note recording owner + fix-by date, dashboard metrics (quarantined count, oldest
deadline), and a cap warning (default 5% of scenarios). This design covers **only
the foundational scoring projection** — the "projection builder over the same
scenario history" — so the rest of the story has a tested, dependency-free metric
to build on. The quarantine workflow, settings, dashboard surfacing, and cap
warning are explicitly **out of scope here** (see "Deferred").

## Problem

US-057 gave every scenario a real, rebuildable result history (`recent: last-N
results`, newest-first, keyed by Scenario Reference). What it does **not** yet do
is *characterise* that history: a scenario that oscillates `passed → failed →
passed` is materially different from one that is steadily green or steadily red,
but both currently read only as their `latest` status in the Use Case roll-up.
EPIC-014's outcome calls flakiness a "first-class concept"; the AC asks for a
"stability score per scenario over the history window". This slice computes it.

## Decisions

### D1 — Flakiness is the pass↔fail flip rate over the window

The history we already store is a sequence of normalized per-run statuses
(`passed | failed | skipped`). The signal the story names is **status flips**
("scenarios flagged flaky (status flips, retry-passes)"), and the research it
cites is about pass↔fail *transitions* (Google: 84% of pass↔fail transitions are
flaky). So the canonical metric is the **flip rate**:

```
score = flips / transitions          (0 when fewer than 2 pass/fail results)
  transitions = (pass/fail results) - 1
  flips       = adjacent pass/fail pairs whose status differs
```

- `score` is a **flakiness** rate in `[0, 1]`: `0` = never flips (stable),
  `1` = flips on every run (maximally flaky). The AC's "stability score" is its
  inverse (`1 - score`); we expose flakiness because the title, the dashboard
  ("flagged flaky"), and the cap warning are all flakiness-oriented. The inverse
  is one subtraction away for any consumer that wants it.
- **`skipped` results are dropped** before counting. A skip is not a pass/fail
  signal: it should neither register as a flip nor be treated as a stabilising
  pass. The flip rate is computed over the remaining pass/fail subsequence.
- **Flip count is reversal-invariant**, so the metric does not care whether the
  window is stored newest-first (it is) or oldest-first — reversing a sequence
  preserves the number of adjacent differing pairs. We pass `recent` as-is.

### D2 — Classification bands

A raw rate is hard to act on, so the projection also classifies:

| Band      | Condition                                  | Meaning                          |
| --------- | ------------------------------------------ | -------------------------------- |
| `unknown` | fewer than 2 pass/fail results             | not enough history to judge      |
| `stable`  | `flips === 0`                              | every result agreed              |
| `suspect` | `0 < score < FLAKY_SCORE` (default `0.5`)  | flips, but not dominated by them |
| `flaky`   | `score >= FLAKY_SCORE`                     | flips on at least half its runs  |

Thresholds (`MIN_RUNS_FOR_SCORE = 2`, `FLAKY_SCORE = 0.5`) are module constants
documented as tunable; a later slice may promote them to settings alongside the
quarantine cap. `unknown` is kept distinct from `stable` so a single green run is
never mislabelled "proven stable".

### D3 — Pure domain projection + a history-service read model

- **`domain/policies/scenario-flakiness.ts`** (new, pure, no I/O) — owns
  `computeFlakiness(statuses)` and the `ScenarioFlakiness` shape + bands, beside
  `use-case-automation-policy.ts` (which already owns `ScenarioLatestStatus`).
  Unit-testable in isolation (BBV §10), exactly like the roll-up policy.
- **`ScenarioHistoryService.flakiness()`** (new method) — maps every scenario in
  the index through `computeFlakiness(recent.map(status))`, returning
  `Map<scenarioRef, ScenarioFlakiness>`. It reuses the **same** stale-cache /
  rebuild path as `latestStatuses()` (both now share a private `loadIndex()`),
  so a flakiness read queues behind any in-flight record/rebuild and never
  observes a half-rebuilt index — the codex-P2 ordering guarantee US-057
  established applies unchanged.

No NDJSON schema bump: flip scoring needs only the statuses already stored.
US-057 left "retries/error-group fields … for US-058 without a forced bump"; the
**retry-pass** signal (and the Cucumber Messages parser it needs) is a later
slice and will add fields then.

## Refactor folded into this PR

`scenario-history-service.ts` carried a non-fatal `max-lines` warning after the
US-057 merge. Its pure data-model pieces — the NDJSON/index types, the v1 schema
guards, `lineToEntry`, and the `fold` logic — move to a new cohesive
`scenario-history-index.ts`. The service keeps all orchestration and I/O. This
clears the warning and gives the flakiness read model a clean place to read the
`recent` window from.

## Testing (TDD)

- **Projection (pure):** empty / single-run → `unknown`, score 0; all-passed and
  all-failed → `stable`; alternating → `flaky`, score 1; one flip in a long
  stable run → `suspect`, low score; `skipped` dropped (does not flip or
  stabilise); a window that is all-skipped → `unknown`; reversal invariance.
- **Service `flakiness()`:** maps the index `recent` per ref; rebuilds when the
  index is absent/stale (same path as `latestStatuses`); queued behind an
  in-flight rebuild; empty map on a fresh vault.
- **Index module:** the extracted guards/fold keep their existing behaviour
  (covered by the moved service tests; no behaviour change).

## Deferred (rest of US-058, with owners — this story)

- `@quarantine` tag: exclude from KPI like `@wip` but still run it — touches
  `use-case-automation-policy` and the spec/tag model.
- Quarantine note recording **owner + fix-by deadline**.
- Dashboard surfacing: quarantined count, oldest deadline, flaky scenarios.
- Cap warning when quarantined scenarios exceed the configurable cap (default
  5%).
- **Retry-pass** flakiness signal via the Cucumber Messages parser (US-054 feed).
- Guided Tour (ADR-0020) coverage of the quarantine workflow (EPIC-014 DoD).

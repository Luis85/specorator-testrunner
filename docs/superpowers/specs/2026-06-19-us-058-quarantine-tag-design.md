# US-058 Flakiness scoring — Design (slice 2: the `@quarantine` tag)

- **Story:** [[US-058]] Flakiness score & quarantine (EPIC-014, P1, V2.1)
- **Date:** 2026-06-19
- **Status:** Approved (brainstorm) — second slice
- **Builds on:** slice 1 (flakiness scoring projection, shipped) ·
  [[0017-use-case-automation-rollup-with-wip-exclusion]] (the `@wip` precedent) ·
  [[0022-scenario-identity-and-history-store]]

## Scope of this slice

The `@quarantine` **scenario tag**: a flaky scenario the team has consciously
parked. Per EPIC-014 / UC-028 it must be **excluded from the Use Case KPI
roll-up** (so its flapping does not drag the dashboard red) while **still
running** (unlike a skip — a quarantined scenario keeps producing history so its
flakiness can be re-assessed and it can be un-quarantined). This slice delivers
exactly that, plus a visible **quarantined count** on the existing per-Feature
health line, mirroring how `@wip` is already surfaced.

Out of scope here (later slices): the quarantine note recording **owner +
fix-by deadline**, the dashboard tile showing the **oldest deadline**, the **cap
warning** (quarantined > 5% of scenarios), and the **retry-pass** signal via the
Cucumber Messages parser. The owner/deadline storage is a real design fork (tag
parameters vs. a sidecar registry) and is deliberately deferred until its
consumers (the deadline tile + cap warning) are built.

## Decisions

### D1 — `@quarantine` is a scenario-level KPI exclusion

`@wip` (ADR-0017) excludes a whole **Feature** from the roll-up. `@quarantine` is
finer — a single **scenario** (UC-028: "quarantine a flaky Scenario") — so the
exclusion happens inside `featureRunState`, not at the Feature filter:

- A scenario whose tags include `@quarantine` (case-insensitive, matching the
  `@wip` convention) is dropped from its Feature's run-state computation. Its
  latest status — pass or fail — no longer affects whether the Feature (and thus
  the UC) reads passing / failing.
- A Feature whose every scenario is quarantined has no active refs and reads
  `excluded` — **neutral** in the aggregate, dropped before the roll-up decides.
  This is stronger than `not-run`: a `not-run` sibling would drag a passing UC
  down to `implemented`, whereas an all-quarantined Feature must let a passing
  sibling keep the UC `passing` (a reviewer caught this on the first draft). If
  every Feature is excluded, the UC reads `planned` (no KPI-contributing run).
  `excluded` is returned **only** when refs existed and `@quarantine` removed them
  all — a Feature with no refs to begin with (a rowless Scenario Outline, or all
  scenarios degraded to unset refs) never executed and stays `not-run`, so it
  cannot let a passing sibling carry the UC to `passing` (a second reviewer catch).
- `missing-steps` precedence is unchanged: quarantine parks a *flaky runtime*,
  not an *unwritten* scenario, so a quarantined scenario with no steps still
  surfaces the structural problem (it is an authoring issue, not a flake).

### D2 — Outline quarantine: scenario-level and Examples-block-level

A `@quarantine` on a `Scenario Outline` quarantines **all** its example rows
(every row shares the scenario's tags). A `@quarantine` on a single `Examples:`
block quarantines **only that block's rows** — the only way Gherkin scopes a tag
to particular rows, and the natural fit for parking one flaky pickle of an
Outline. So each row's reference entry carries `scenario.tags + block.tags`, and
both the KPI exclusion (`featureRunState`) and the insight count agree on what is
quarantined (a reviewer caught the earlier draft, which counted block-level
quarantine but did not exclude it).

A **feature-level** `@quarantine` parks the whole Feature — equivalent to tagging
every scenario `@quarantine`, so all its refs are inactive and the Feature reads
`excluded`. (The first draft treated feature-level quarantine as out of scope,
but it was advertised in the shared tag picker, so applying it on a Feature was a
silent no-op — a reviewer caught this; making it effective resolves it.) It is
surfaced like `featureIsWip`: a separate `featureIsQuarantined` badge, distinct
from the scenario-level count. `missing-steps` still applies to a feature-level
`@quarantine` Feature (it stays in `active`), because — unlike `@wip` (unfinished
work) — a *flaky-but-done* Feature with undefined steps is contradictory and
worth surfacing.

### D3 — Plumbing: scenario tags on the reference entry

The policy rolls up over `featureScenarioRefs(feature)` (US-056), which flattens
Outline rows and owns the ref-minting logic. To know a ref's quarantine state
without duplicating that logic, `ScenarioRefEntry` gains a `tags: string[]` field
(the scenario's tags; Outline rows inherit them). The policy keeps the *meaning*
of the tag (`isQuarantined`); the value object just exposes the raw tags. The new
field is additive — existing consumers (the identity resolver, rename advisory)
ignore it.

### D4 — Visible signal: quarantined count on the health line

`FeatureHealth` (feature-insight-service) gains `quarantineScenarioCount` and
`featureIsQuarantined` (mirroring `featureIsWip`). Unlike `wipScenarioCount`
(purely informational, so any tagged block counts), the quarantine count implies
a KPI exclusion, so it counts a scenario only when it is **fully** excluded — a
scenario-level tag, or *every* runnable Examples block tagged. A partially-tagged
Outline still has rows in the roll-up, so counting it would contradict the KPI (a
reviewer caught this). The per-Feature
health line renders the count alongside the `@wip` count, e.g.
`3 scenarios (1 @wip, 1 quarantined)`, and the detail view renders a
`@quarantine` badge (tinted with the error colour to distinguish it from the
`@wip` badge) when the Feature itself is quarantined. `@quarantine` is seeded into
the known-tags vocabulary so the Feature Editor's tag picker offers it — now
effective wherever it is applied (scenario, Examples block, or Feature).

This is the "dashboard shows quarantined count" AC at Feature granularity. The
roll-up tile count + oldest-deadline is a later slice once deadline storage
exists.

## Architecture & components

```
domain/value-objects/scenario-reference.ts   (ScenarioRefEntry += tags)
domain/policies/use-case-automation-policy.ts (exclude @quarantine in
                                               featureRunState; QUARANTINE_TAG)
application/services/feature-insight-service.ts (FeatureHealth +=
                                               quarantineScenarioCount; seed tag)
presentation/views/use-case-detail-rows.ts   (health line renders the count)
docs/issues/US-058.md                         (progress)
```

## Testing (TDD)

- **Policy:** a quarantined failing scenario does not make its Feature/UC fail;
  a quarantined scenario is excluded from the all-passed check; an all-quarantined
  Feature is neutral (a passing sibling still passes the UC); a rowless Outline
  stays `not-run`, not excluded; case-insensitive match; Outline rows inherit the
  scenario's quarantine, and a block-level `@quarantine` excludes only that
  block's rows; `missing-steps` still outranks.
- **Reference:** `featureScenarioRefs` carries each entry's tags (plain +
  Outline rows).
- **Insight:** `quarantineScenarioCount` over scenario/Examples-block tags;
  `@quarantine` in `listKnownTags`.
- **Detail rows:** health-line text composes `@wip` + quarantine segments.

## Deferred (rest of US-058)

- Quarantine note with **owner + fix-by deadline** (storage design: tag params
  vs. sidecar registry).
- Dashboard tile: quarantined count across the UC + **oldest deadline**.
- **Cap warning** when quarantined scenarios exceed the cap (default 5%).
- **Retry-pass** flakiness signal via the Cucumber Messages parser.
- Guided Tour (ADR-0020) coverage of the quarantine workflow.

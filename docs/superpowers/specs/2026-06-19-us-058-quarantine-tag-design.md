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
- A Feature whose every scenario is quarantined contributes no run signal →
  `not-run`, exactly as an empty Feature would. Documented, not special-cased.
- `missing-steps` precedence is unchanged: quarantine parks a *flaky runtime*,
  not an *unwritten* scenario, so a quarantined scenario with no steps still
  surfaces the structural problem (it is an authoring issue, not a flake).

### D2 — Outline rows inherit the scenario's quarantine

A `@quarantine` on a `Scenario Outline` quarantines **all** its example rows
(every row shares the scenario's tags). Per-`Examples`-block quarantine is finer
than this slice needs and is deferred. Feature-level `@quarantine` is not a thing
— a whole flaky Feature is `@wip`/triage territory, not quarantine.

### D3 — Plumbing: scenario tags on the reference entry

The policy rolls up over `featureScenarioRefs(feature)` (US-056), which flattens
Outline rows and owns the ref-minting logic. To know a ref's quarantine state
without duplicating that logic, `ScenarioRefEntry` gains a `tags: string[]` field
(the scenario's tags; Outline rows inherit them). The policy keeps the *meaning*
of the tag (`isQuarantined`); the value object just exposes the raw tags. The new
field is additive — existing consumers (the identity resolver, rename advisory)
ignore it.

### D4 — Visible signal: quarantined count on the health line

`FeatureHealth` (feature-insight-service) gains `quarantineScenarioCount`,
mirroring `wipScenarioCount` (scenario-level tag, including a runnable Examples
block). The per-Feature health line renders it alongside the `@wip` count, e.g.
`3 scenarios (1 @wip, 1 quarantined)`. `@quarantine` is seeded into the known-tags
vocabulary so the Feature Editor's tag picker offers it.

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
  a quarantined scenario is excluded from the all-passed check; a Feature whose
  scenarios are all quarantined reads `not-run`; case-insensitive match; Outline
  rows inherit the scenario's quarantine; `missing-steps` still outranks.
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

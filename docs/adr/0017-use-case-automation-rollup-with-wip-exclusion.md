---
type: adr
id: ADR-0017
status: accepted
title: Use Case Automation Status Rolls Up From Features With @wip Exclusion
date: 2026-05-30
related:
  - "[[0012-use-case-to-feature-is-one-to-many]]"
  - "[[0022-scenario-identity-and-history-store]]"
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
  - "[[Event Catalog]]"
---

# Use Case Automation Status Rolls Up From Features With @wip Exclusion

`UseCase.automationStatus` is a derived value computed from the states of the Use Case's Features by `UseCaseAutomationPolicy`. Features tagged `@wip` are excluded from the roll-up so half-built work does not drag the dashboard red. Exclusion granularity is the **Feature**, not the scenario (see Consequences) — a `@wip` tag on a scenario inside an otherwise-unmarked Feature does not exclude it.

## Roll-up rule

| Feature states (excluding `@wip`-tagged Features) | `UC.automationStatus` |
| --- | --- |
| No Features | `not-planned` |
| 1+ Features exist, none ever run | `planned` |
| 1+ Features have undefined Gherkin steps | `missing-steps` |
| All Features have run at least once, all passed | `passing` |
| All Features have run at least once, at least one failed | `failing` |
| Features have run, none failed, some never ran | `implemented` |

## Pass roll-up refinement: run scope + a prior-status floor

> **Superseded by ADR-0022 / US-057 (V2).** The scope-awareness branch and the
> prior-status "floor" described in this section were workarounds for V1's lack of
> per-Feature/per-scenario run history. V2 gives every scenario a real history
> (per-scenario `scenarios.ndjson` + `.testrunner` index), and
> `computeAutomationStatus` now derives each Feature's state from its scenarios'
> *latest* recorded results (latest status per scenario → Feature → UC). The
> policy no longer reads `UseCase.automationStatus` or `lastTestRun`: because each
> scenario retains its own last-known status, a targeted single-Feature/scenario
> rerun updates only the scenarios it touched, so siblings can neither regress nor
> inflate the roll-up — the floor and scope-awareness are unnecessary and removed.
> The base table above still holds, now evaluated per scenario. (An upgraded UC
> with a recorded run but no history yet keeps its persisted status until its next
> run backfills history.) The two sub-sections below are retained as the historical
> V1 rationale.

The base table reads "all Features have run, all passed → `passing`", but the V1 implementation (`UseCaseAutomationPolicy.computeAutomationStatus`) does **not** treat a single passing run as proof that the *whole* Use Case passes. Two refinements, both accepted as the intended behaviour, sit on top of the table for the `passed` case:

1. **Scope-awareness.** A passing run only rolls the whole UC up to `passing` when that run actually exercised every (non-`@wip`) Feature. Concretely, a `passed` last run yields `passing` only when:
   - the run scope is `use-case` or `all` (a UC-wide run), **or**
   - the run has no recorded scope (a legacy summary — treated as covering, for backward compatibility), **or**
   - the UC has exactly one (non-`@wip`) Feature, so any scope covers it.

   A single-Feature-scope run on a *multi-*Feature UC leaves the sibling Features unrun, so it does **not** by itself make the UC `passing`.

2. **Prior-status "floor".** A partial (single-Feature-scope) pass on a multi-Feature UC must not *regress* a UC that already reached `passing` via an earlier UC-wide run (a common targeted rerun). Because V1 keeps no per-Feature pass history, the persisted `UseCase.automationStatus` is used as a floor: if the UC was already `passing`, a partial pass keeps it `passing`; otherwise the UC is reported as `implemented` (exercised, not yet proven green wholesale).

This is why the policy reads the UC's current `automationStatus` as an input in addition to its Features and last run — the floor is the only mechanism, absent per-Feature history, that prevents a targeted single-Feature rerun from silently downgrading a genuinely-green multi-Feature UC. Finer per-Feature run history (which would remove the need for the floor) is deferred to V2.

The other table rows (`not-planned`, `planned`, `missing-steps`, `failing`, and the `implemented` catch-all for queued/running/cancelled) are unaffected by this refinement.

## KPI definitions (used by `dashboard.kpi.updated`)

- `totalUseCases` — every UC in the vault except those with `status = "deprecated"`.
- `specifiedUseCases` — UCs with `status ∈ {specified, ready-for-automation, automated, verified}`.
- `automatedUseCases` — UCs with `automationStatus ∈ {implemented, passing, failing}`.
- `passingUseCases` — UCs with `automationStatus = passing`.
- `failingUseCases` — UCs with `automationStatus = failing`.

Deprecated UCs are excluded from every count. They still exist as notes; they just don't move the dashboard.

## Considered alternatives

- **Strictest, no `@wip` exclusion.** Rejected: stale `@wip` Features drag fully-working UCs into "failing"; users learn to mistrust the dashboard.
- **Latest-wins** — UC takes the status of the most recent run regardless of which Feature it was. Rejected: explicitly loses information across Features.
- **Per-Feature display, no UC roll-up.** Rejected: breaks PRD AC-013 at the UC level; users want UC counts on the dashboard.

## Consequences

- New `UseCaseAutomationPolicy` lives in the domain layer (no I/O, unit-testable in isolation per BBV §10).
- The pass roll-up is **scope-aware and applies a prior-status floor** (see "Pass roll-up refinement" above): the policy takes the UC's current `automationStatus` as an input alongside its Features and last run, so a partial single-Feature rerun cannot regress an already-`passing` multi-Feature UC, and a single-Feature pass cannot mark a multi-Feature UC green on its own. This is the accepted V1 behaviour; per-Feature run history that would supersede the floor is a V2 item.
- `TraceabilityService.refreshDashboard()` calls the policy to compute every KPI count.
- `@wip` exclusion granularity is the **Feature**, not the scenario. A scenario tagged `@wip` inside an otherwise non-`@wip` Feature counts normally. Trade-off favours rule simplicity over precision; users learn to tag at the file level when they want to park work.
- Deprecated UCs disappear from KPIs but remain in the vault; this is intentional so audit history is preserved.

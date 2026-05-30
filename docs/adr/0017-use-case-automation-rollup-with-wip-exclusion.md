---
type: adr
id: ADR-0017
status: accepted
title: Use Case Automation Status Rolls Up From Features With @wip Exclusion
date: 2026-05-30
related:
  - "[[0012-use-case-to-feature-is-one-to-many]]"
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
  - "[[Event Catalog]]"
---

# Use Case Automation Status Rolls Up From Features With @wip Exclusion

`UseCase.automationStatus` is a derived value computed from the states of the Use Case's Features by `UseCaseAutomationPolicy`. Features (or scenarios within a Feature when the Feature itself is unmarked) tagged `@wip` are excluded from the roll-up so half-built work does not drag the dashboard red.

## Roll-up rule

| Feature states (excluding `@wip`-tagged Features) | `UC.automationStatus` |
| --- | --- |
| No Features | `not-planned` |
| 1+ Features exist, none ever run | `planned` |
| 1+ Features have undefined Gherkin steps | `missing-steps` |
| All Features have run at least once, all passed | `passing` |
| All Features have run at least once, at least one failed | `failing` |
| Features have run, none failed, some never ran | `implemented` |

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
- `TraceabilityService.refreshDashboard()` calls the policy to compute every KPI count.
- `@wip` exclusion granularity is the **Feature**, not the scenario. A scenario tagged `@wip` inside an otherwise non-`@wip` Feature counts normally. Trade-off favours rule simplicity over precision; users learn to tag at the file level when they want to park work.
- Deprecated UCs disappear from KPIs but remain in the vault; this is intentional so audit history is preserved.

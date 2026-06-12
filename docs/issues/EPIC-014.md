---
id: EPIC-014
type: epic
title: Scenario Identity, History & Flakiness
status: proposed
priority: P1
stories:
  - "[[US-056]]"
  - "[[US-057]]"
  - "[[US-058]]"
  - "[[US-059]]"
use-cases:
  - "[[UC-028]]"
  - "[[UC-029]]"
---

# EPIC-014 Scenario Identity, History & Flakiness

> Implements the deferred Scenario Reference (CONTEXT.md), replaces the
> ADR-0017 status "floor" with real per-scenario history, and makes
> flakiness a first-class concept. New ADR: scenario identity & history
> store (append-only NDJSON run log under `Test Evidence/` — also resolves
> the Event Catalog §16 V2 candidate).

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P1*.

## Outcome

V1's unit of identity is the Feature; scenarios have no history, so the
dashboard relies on the ADR-0017 prior-status "floor" workaround and
flakiness is invisible. The evidence is stark: ~40% of QA time goes to
maintenance and flakiness, and Google found 84% of pass↔fail transitions
are flaky. This epic gives every scenario a stable identity, a real result
history, a stability score with a managed quarantine workflow, and a triage
view that groups a red run by root cause instead of by row — turning the
dashboard from "latest snapshot with a floor hack" into trustworthy signal.

## Stories

| Story | Title | Priority | Increment |
| --- | --- | --- | --- |
| [[US-056]] | Scenario Reference | P1 | V2.0 |
| [[US-057]] | Per-scenario run history | P1 | V2.0 |
| [[US-058]] | Flakiness score & quarantine | P1 | V2.1 |
| [[US-059]] | Failure triage view | P1 | V2.1 |

## Use cases

- [[UC-028]] — Review and quarantine a flaky Scenario
- [[UC-029]] — Triage a failed run by error group

## Dependencies & sequencing

- Builds directly on the playwright-bdd migration ([[US-051]]/[[US-052]],
  [[EPIC-013]]): identity is stamped into generated specs, and retry results
  ([[US-054]]) feed the flakiness score.
- Pre-V2 groundwork it assumes (§9): output-event ordering (1.3), the shared
  serial queue (1.2 — the history writer is its "third user"), and the
  single `isScenarioOutline` predicate (1.11 — Outline examples key as
  `::row-N`).
- [[US-056]]/[[US-057]] land in V2.0 because the runner migration touches
  the same report pipeline once; flakiness and triage layer on top in V2.1.

## Definition of done

- ADR "Scenario identity & history store" accepted (append-only NDJSON under
  `Test Evidence/`, partitioned per ADR-0016; resolves the Event Catalog §16
  V2 candidate).
- ADR-0017 floor logic removed; Use Case rollups derive from scenario
  history; history is git-mergeable and survives reloads.
- CONTEXT.md "Scenario Reference" entry updated from *deferred* to
  *implemented*; rename-detaches-history behavior documented.
- Dashboard shows flakiness/quarantine metrics; quarantine workflow records
  owner + deadline; all four stories accepted.
- Guided Tour (ADR-0020) extended to cover the triage/quarantine workflow.

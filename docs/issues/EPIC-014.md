---
id: EPIC-014
type: epic
title: Scenario Identity, History & Flakiness
status: proposed
priority: P1
---

# EPIC-014 Scenario Identity, History & Flakiness

> Implements the deferred Scenario Reference (CONTEXT.md), replaces the
> ADR-0017 status "floor" with real per-scenario history, and makes
> flakiness a first-class concept. New ADR: scenario identity & history
> store (append-only NDJSON run log under `Test Evidence/` — also resolves
> the Event Catalog §16 V2 candidate).

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P1*.

## Stories rolled up

- [[US-056]] — Scenario Reference
- [[US-057]] — Per-scenario run history
- [[US-058]] — Flakiness score & quarantine
- [[US-059]] — Failure triage view

## Use cases

- [[UC-028]] — Review and quarantine a flaky Scenario
- [[UC-029]] — Triage a failed run by error group

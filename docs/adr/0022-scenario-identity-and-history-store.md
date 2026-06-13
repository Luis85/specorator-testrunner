---
type: adr
id: ADR-0022
status: accepted
title: Scenario Identity And History Store
date: 2026-06-13
related:
  - "[[0005-use-markdown-evidence]]"
  - "[[0007-runtime-eventbus-not-event-sourcing]]"
  - "[[0016-evidence-partitioned-by-year-month]]"
  - "[[0017-use-case-automation-rollup-with-wip-exclusion]]"
  - "[[2026-06-13-v2-foundational-adrs-design]]"
---

# Scenario Identity And History Store

V2 gives Cucumber scenarios a stable identity and per-scenario run history (EPIC-014), replacing V1's Feature-level identity and the ADR-0017 "floor" workaround. Three things are decided: the identity key, the report format that feeds it, and where history durably lives.

## Identity

The natural key is the **Scenario Reference**: `<featurePath>::<scenarioName>`, with `::row-<index>` for a Scenario Outline example. It is stable across runs but **not** across renames — renaming a scenario mints a new Scenario Reference and drops the prior history once. This activates the concept CONTEXT.md previously held as deferred.

## Report format

The runner emits **Cucumber Messages** (the NDJSON message stream), not just cucumber-JSON. JSON is lossy for the outline-row and retry granularity that per-scenario history and flakiness require. The ReportParser port (proposal §9 2.3) gains a Cucumber Messages implementation alongside the JSON one.

## Durable store: Evidence notes are the single source

The year-month-partitioned **Evidence notes (ADR-0016), enriched by EPIC-015 (US-060 audit-grade evidence stamps) to carry per-scenario results, are the authoritative per-run record.** Scenario history, flakiness scores, quarantine state, Feature-frontmatter rollups, and any NDJSON analytics index are **rebuildable projections over the Evidence notes** — never an independent source of truth.

This **honors ADR-0007** ("events are not persisted; the Markdown is the durable record") rather than amending it. The reserved NDJSON event-log option (ADR-0007 §16) is **not** activated as an authoritative store; any NDJSON history index is a derived cache reconstructable from the Markdown evidence at any time.

## Considered alternatives

- **Activate the reserved NDJSON log as a co-equal authoritative store.** Rejected: a second durable record with a versioned schema to keep consistent with the Markdown, amends ADR-0007, and buys durability not yet needed (the project is in pre-announcement beta).
- **Dedicated structured store (SQLite / single history db).** Rejected: least Obsidian-native, poor git-diff story, breaks the everything-is-Markdown-in-the-vault principle (ADR-0005).
- **Bounded frontmatter rollup as the record (no deep history).** Rejected: lossy — caps the flakiness window and prevents re-derivation after a scoring-rule change.

## Consequences

- **EPIC-014 depends on EPIC-015**: per-scenario evidence stamps (US-060) land before or with per-scenario history (US-057).
- Flakiness scoring (US-058) and the history view (US-057) are projection builders over Evidence notes and can be recomputed wholesale — a scoring change needs no data migration.
- The Feature-frontmatter rollup is a derived, regenerable field, not a hand-migrated one; it participates in the `schemaVersion` story only as a projection.

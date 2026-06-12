---
id: EPIC-019
type: epic
title: Interop & Open Formats
status: proposed
priority: P2-P3
features:
  - "[[FEAT-031]]"
  - "[[FEAT-032]]"
stories:
  - "[[US-079]]"
  - "[[US-094]]"
  - "[[US-095]]"
  - "[[US-096]]"
---

# EPIC-019 Interop & Open Formats

> Be a good citizen of the 2026 toolchain; make leaving (and arriving) easy.

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P2–P3*.

## Outcome

The BDD category's defining trauma is abandonment and lock-in: sponsors
walked away from Cucumber, SpecFlow, and Gauge, and test-management users
literally write tests in ticket descriptions to escape locked-down tools.
"Local-first, plain files, leave anytime" is only credible if the formats
are open both ways. This epic adopts the living standards — Cucumber
Messages (NDJSON) as the primary report format, Allure and JUnit as export
reporters — and (on acceptance) adds bring-your-own-report importers, test
management migration importers, and a headless traceability CLI so the vault
stays a source of truth even outside Obsidian.

## Stories

| Story | Title | Priority | Increment |
| --- | --- | --- | --- |
| [[US-079]] | Cucumber Messages + Allure/JUnit export | P2 | V2.1 |

## Features

- [[FEAT-031]] — Report-Parser Port & Importers *(P3, V2.x — stories
  drafted: [[US-094]] bring-your-own-report import, [[US-095]]
  test-management importers)*
- [[FEAT-032]] — Headless Traceability CLI *(P3, V2.x — story drafted:
  [[US-096]])*

## Dependencies & sequencing

- Pre-V2 groundwork it assumes (§9): the extracted `ReportParser` port
  (2.3) — Messages land beside cucumber JSON without touching the evidence
  pipeline twice, and the same port carries the FEAT-031 importers later.
- [[US-079]] assumes the native runner ([[US-051]], [[EPIC-013]]); cucumber
  JSON import remains the fallback during the transition window.
- The headless CLI ([[US-096]]) shares rule definitions with the
  traceability matrix ([[US-061]]) so in-plugin and CI verdicts can't drift.

## Definition of done

- Report import consumes Messages as primary with cucumber JSON fallback;
  generated CI uploads the chosen report format; Allure setup documented.
- Accepted FEAT-031/032 scope ships behind the `ReportParser` port with
  externally-run reports clearly attributed as such.
- [[US-079]] accepted; interop formats documented in the user manual.

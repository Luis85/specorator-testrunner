---
id: EPIC-013
type: epic
title: Playwright-Native Runner
status: proposed
priority: P1
features:
  - "[[FEAT-029]]"
stories:
  - "[[US-051]]"
  - "[[US-052]]"
  - "[[US-053]]"
  - "[[US-054]]"
  - "[[US-055]]"
  - "[[US-080]]"
  - "[[US-090]]"
  - "[[US-091]]"
  - "[[US-092]]"
use-cases:
  - "[[UC-025]]"
  - "[[UC-026]]"
  - "[[UC-027]]"
---

# EPIC-013 Playwright-Native Runner

> Replace cucumber-js-as-runner with playwright-bdd: Gherkin compiles to
> native `@playwright/test` specs. Revisits ADR-0004/AD-5/AD-6/AD-7; requires
> a new ADR ("Adopt playwright-bdd as execution engine") and a migration path
> for existing `.testrunner` projects (repair regenerates managed files; user
> steps are preserved and adapted with guidance).

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P1, foundation*.

## Outcome

The cucumber-js runner is V1's single biggest technical liability: it
forfeits Playwright's UI mode, trace viewer, fixtures, parallelism,
sharding, retries, and visual assertions, and Playwright upstream closed
Cucumber support as "not planned". Compiling Gherkin to native
`@playwright/test` specs via playwright-bdd (the community standard) removes
that liability in one move and is the foundation roughly half of V2 builds
on — scenario-scoped runs, traces, browser matrices, storageState, sharding,
and the optional check libraries all become native capabilities instead of
bolt-on wiring.

## Stories

| Story | Title | Priority | Increment |
| --- | --- | --- | --- |
| [[US-051]] | Migrate the runner to playwright-bdd | P1 | pre-V2 (§9 Phase 3) |
| [[US-052]] | Typed step definitions | P1 | pre-V2 (§9 Phase 3) |
| [[US-053]] | Run a single scenario | P1 | V2.0 |
| [[US-054]] | Parallel execution & retries | P1 | V2.0 |
| [[US-055]] | Browser matrix | P1 | V2.0 |
| [[US-080]] | Open Playwright UI mode & trace viewer | P1 | V2.0 |

## Features

- [[FEAT-029]] — Optional Check Libraries *(P3, V2.x — stories drafted:
  [[US-090]] visual regression, [[US-091]] accessibility checks, [[US-092]]
  API-setup steps)*

## Use cases

- [[UC-025]] — Run a single Scenario from a Use Case
- [[UC-026]] — Debug a failed Scenario via Playwright trace
- [[UC-027]] — Run a Suite across multiple browsers

## Dependencies & sequencing

- The migration itself (US-051/052) is the **last pre-V2 item** (proposal §9
  Phase 3); it rides on the versioned `.testrunner` manifest + repair-driven
  upgrade framework (§9 item 2.2) and the extracted `ReportParser` port
  (§9 item 2.3).
- [[US-053]] additionally needs the Scenario Reference ([[US-056]],
  [[EPIC-014]]) so scenario-scoped runs and evidence have a stable key.
- Migration risk: playwright-bdd is a single-maintainer (very active)
  project — mitigated because `.feature` files and step logic stay portable
  and the runner is regenerable (§8).

## Definition of done

- ADR "Adopt playwright-bdd as execution engine" accepted (supersedes the
  relevant parts of ADR-0004/AD-5/AD-6/AD-7).
- `Repair installation` migrates a V1 `.testrunner` non-destructively and
  reports what changed; generated spec files are git-ignored and never
  hand-edited.
- Cucumber JSON import keeps working as a fallback during the transition
  window (Messages become primary via [[US-079]]).
- Full unit/integration suite and `e2e-smoke` green on all OSes; the Guided
  Tour (ADR-0020) completes end-to-end against the migrated runner.
- All six stories accepted; docs updated (README disclosure, Getting
  Started, CONTEXT.md terms).

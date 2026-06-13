---
type: adr
id: ADR-0021
status: accepted
title: Adopt playwright-bdd As The Execution Engine
date: 2026-06-13
related:
  - "[[0004-use-playwright-as-browser-automation-engine]]"
  - "[[2026-06-11 V2 Research and Proposal]]"
  - "[[2026-06-13-v2-foundational-adrs-design]]"
---

# Adopt playwright-bdd As The Execution Engine

V2 replaces cucumber-js-as-runner with **playwright-bdd**: Gherkin compiles to native `@playwright/test` tests with typed step definitions, Playwright traces, parallel execution, retries, and sharding. playwright-bdd is the **sole generated runner** in the `.testrunner`. cucumber-JSON import is retained **only through the migration window** (per US-052) and removed once the swap is stable. This is the bridge into V2 feature work (EPIC-013) and supersedes ADR-0004's "Playwright as a library, cucumber-js as the runner."

## Supply-chain posture

playwright-bdd (`vitalets/playwright-bdd`) is effectively a single-maintainer project; Microsoft declined to own Cucumber support ("not planned"); Cucumber itself calls cucumber-js-as-runner the legacy path. For a tool whose value is *defensible, audit-grade* testing, betting the runner on a single-maintainer dependency is the real risk, not the technical merits.

The mitigation is **structural, not a second runner**: nothing in the plugin depends on playwright-bdd directly except the generated `.testrunner` templates. All report ingestion goes through the **ReportParser port** (proposal §9 item 2.3), so a future runner replacement is a new parser implementation plus new templates — not a plugin rewrite.

## Considered alternatives

- **Permanent parser-port insulation with cucumber-JSON kept as a second supported parser forever.** Rejected as the standing posture: the ReportParser port already provides the insulation; keeping a second parser permanently adds maintenance for a hedge the port covers.
- **Dual-runner — ship cucumber-js-as-runner as a selectable, supported generated runner alongside playwright-bdd.** Rejected: doubles the runner surface, CI matrix, and template maintenance, and re-litigates the very migration the bet exists to make.

## Consequences

- Supersedes ADR-0004 (Playwright-as-library + cucumber-js-as-runner); lifts AD-6 (`parallel: 0`, serial execution) and AD-7.
- The generated `.testrunner` gains a playwright-bdd config and typed step stubs (US-051/US-052); the V1 regex step-matching heuristics are subsumed by playwright-bdd's own diagnostics.
- The **ReportParser port (2.3) is a hard dependency**: its first implementation wraps the current cucumber-JSON parser; Cucumber Messages is added per [[0022-scenario-identity-and-history-store]].
- The Phase 3 migration (proposal §9 3.1–3.3) is where this lands in code; it is validated by the `e2e-smoke` gate on POSIX and Windows before V2.0 feature work begins.

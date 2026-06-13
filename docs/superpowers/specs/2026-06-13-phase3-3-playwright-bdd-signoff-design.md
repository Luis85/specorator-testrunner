# Phase 3.3 — playwright-bdd Migration Sign-off (Design)

**Status:** Approved (scope + Guided-Tour validation depth confirmed)
**Proposal item:** §9 Phase 3.3 — *the last gate before V2.0 feature work (§8) begins.*
**Predecessors:** 3.1 spike (ADR-0021 confirmed), 3.2 runner swap + typed steps (PR #44, merged).

## Goal

Close the playwright-bdd migration with a validation sign-off: prove the full
suite and `e2e-smoke` are green on all OSes, prove the **Guided Tour completes
end-to-end against the migrated runner** with an executable test, and bring the
user-facing docs in line with the playwright-bdd runtime.

This is a **validation + docs** increment. The runner swap itself shipped in 3.2;
3.3 adds no runtime behaviour — it adds proof and corrects documentation.

## Scope

### 1. Guided Tour end-to-end validation (executable)

Investigation finding: the Guided Tour needs **no code changes**. The 3.2 swap was
tour-aware — `TOUR_STEPS_SNIPPET` is already in `createBdd` form, the demo fixture
already carries the greeting form, and every tour step predicate keys on a domain
event whose type/payload the swap preserved verbatim (`scope:"demo"`, validation
`tags`, `specification.missingSteps.detected`, `stepdefinition.generated`,
`suite.created`/`suite.executed`/`testrun.completed`). Per-predicate unit tests
(`tests/tour-steps.test.ts`) and template-content assertions
(`tests/runner-templates.test.ts`) already cover every tour↔runner contact point.

The one gap is the absence of a single **executable** proof that the real migrated
runner runs the tour's self-authored `@tour` cycle green. We close it by extending
`scripts/e2e-smoke.mjs` (the real-OS install-and-run smoke, already exercising the
demo + a scoped run + the demo `@smoke` run) with a **`@tour` leg** that uses the
*real* tour artifacts:

- **Author the tour feature.** Write the real `TOUR_GHERKIN_SNIPPET` (the `@tour`
  "Greet the visitor" scenario) into the runner's feature folder.
- **Implement the tour steps.** Write the real `TOUR_STEPS_SNIPPET`
  (`createBdd()` + `{ page }`, binding the three greeting `When`/`Then` steps) to
  `src/steps/tour.steps.ts` in the runner. The scenario's `Given I open the local
  example page` is satisfied by the generated demo `example.steps.ts` (which the
  tour deliberately reuses) — so the two step files coexist exactly as they do in
  a real tour completion.
- **Run the `@tour` suite.** Spawn the base run command with `BDD_TAGS=@tour`
  (the suite-scope shape: the generated config's `defineBddConfig` reads it, so
  `bddgen` generates only the `@tour` scenario; the co-present `@demo @smoke` demo
  is excluded).
- **Assert** the cucumber-JSON report shows **exactly 1 scenario, all steps
  passed** — proving the greeting fixture (`#name`/`#greet`/`#greeting`), the
  reused Given, and the pasted `createBdd` steps all execute against the real
  runner.

Because the leg consumes the actual `TOUR_GHERKIN_SNIPPET`/`TOUR_STEPS_SNIPPET`
constants (not copies), it cannot drift from what the tour shows the user. The
snippets are currently module-private in `tour-steps.ts`; they are exported and
re-exported through `scripts/e2e-smoke-entry.ts` (the bundle entry) so the smoke
run reaches them. A unit test pins that the exported `@tour` snippet still binds
the verbs the gherkin needs (guarding the e2e's premise without a real spawn).

This leg runs in CI on ubuntu + windows (the `e2e-smoke` workflow) and locally,
the same as the demo/scoped/smoke legs.

### 2. User-facing documentation (terminology refresh)

Rewrite the stale cucumber-js references so the docs describe the playwright-bdd
runtime. Inventory (15 references) — exact lines confirmed by investigation:

- **README.md** (3): the architecture diagram's `Cucumber` runner label; "runs
  Playwright + Cucumber-JS"; the download list "(Playwright, Cucumber-JS, …)".
- **CONTEXT.md** (7, glossary — keep it implementation-light): `.testrunner`
  ("Playwright + Cucumber-JS runtime"); _Feature Specification_ ("Cucumber
  `Background`" → Gherkin `Background`); _Test Suite_ / _Tag Expression_ / _@wip
  Tag_ / _Scenario Reference_ ("Cucumber" qualifier on Gherkin-standard concepts);
  _Guided Tour_ ("step definitions" → `createBdd()` steps).
- **docs/Specorator Testrunner.md** (5, the PRD): Technology Stack line; Developer
  persona row; the architecture diagram's `Cucumber` label; FR-005 "Cucumber tag
  expressions"; AC-008 step-definition stubs.

Mapping: `Cucumber-JS`/`cucumber.mjs`/`@cucumber/cucumber` World+hooks →
playwright-bdd (`bddgen` + `@playwright/test`, `createBdd()` + Playwright
fixtures); `npx cucumber-js` → `bddgen && playwright test`. Gherkin-standard terms
(Background, tag expressions, `@wip`) keep their meaning — only the "Cucumber"
qualifier is dropped, since they are Gherkin/BDD constructs playwright-bdd honours.

Out of scope: `docs/architecture/**`, `docs/issues/**`, `docs/adr/**`,
`docs/tech-debt/**`, `docs/proposals/**`, `docs/reviews/**`, `docs/superpowers/**`
— internal/historical records, deliberately left as written.

### 3. Sign-off

- Run the full local gate (lint · format · typecheck · build · coverage ·
  `fallow audit --base origin/main` exit 0) and the full `e2e-smoke` locally; record
  the result.
- Mark proposal §9 item 3.3 delivered; add a CHANGELOG `[Unreleased]` entry noting
  the migration is complete (docs + tour e2e sign-off).

## Non-goals

- No runtime/behaviour changes to the runner, services, or tour (3.2 shipped them).
- No second `ReportParser` (Cucumber Messages, ADR-0022) — deferred to its own step.
- No architecture-doc rewrites (separate concern from the user-facing pass).

## Validation

The increment is itself the validation gate; "done" means: full suite green, the
new `@tour` e2e leg green on ubuntu + windows, `fallow audit` exit 0, and the docs
no longer reference the cucumber-js runtime. Only then does §8 V2.0 feature work
begin.

---
title: US-055 Browser Matrix — Design
date: 2026-06-14
status: approved
epic: EPIC-013
story: US-055
adr: ADR-0025
---

# US-055 Browser Matrix — Design

## Context

Phase 3 migrated the runner to playwright-bdd (US-051/052). The generated
`playwright.config.ts` currently hardcodes a single `chromium` Playwright
project; `RunnerSettings.browserInstallCommand` defaults to
`"npx playwright install chromium"`. EPIC-013 **US-055** + **ADR-0025** lift the
chromium-only constraint (V1 AD-5): chromium stays the default, firefox/webkit
become opt-in. This is the first EPIC-013 V2.0 increment to design — US-053
(single-scenario) is blocked on US-056; US-054/US-055/US-080 are unblocked, and
US-055 is the one fully settled by an accepted ADR.

## Goal

Let the user run the suite across any non-empty subset of
{chromium, firefox, webkit}, with an install flow for the selected browsers and
result counts that stay meaningful when more than one browser runs.

## Scope

**In:**
- A global browser selection in `RunnerSettings`.
- Dynamic Playwright `projects[]` built from the selection (env-passed).
- An install flow that installs the selected browsers.
- Worst-status **collapse** of per-browser results so counts = distinct scenarios.
- Settings UI (three checkboxes + an install button).

**Out (fast-follows, recorded — not this increment):**
- Per-browser result **breakdown** in import/evidence (e.g. "chromium ✓, firefox ✗").
  Needs the Playwright project name in results; if the cucumber-JSON lacks it,
  this depends on US-079 (Cucumber Messages, ADR-0022).
- Per-environment / per-suite browser matrices (the AC's "environments/suites
  declare" wording — deferred to a later increment; global is the YAGNI-first slice).

## Decisions (from the brainstorm)

1. **Granularity: GLOBAL** — `RunnerSettings.browsers`. A browser matrix is a
   runner concern (which Playwright projects to generate), not intrinsically a
   property of a SUT environment or a suite. Per-env/suite is a later refinement.
2. **Wiring: ENV** — `TESTRUNNER_BROWSERS`, consistent with the existing
   `BDD_TAGS`/`BDD_FEATURES` scope env. Toggling browsers needs no config regen.
   (Named `TESTRUNNER_*` not `BDD_*` because it controls Playwright projects,
   not bdd tag/feature filtering.)
3. **Attribution: collapse this increment**; per-browser breakdown deferred.
4. **No forced chromium** — any non-empty subset is valid (firefox-only allowed);
   empty/invalid repairs to `["chromium"]`.

## Design

### 1. Data model — `src/domain/settings/settings.ts`

```ts
export type BrowserName = "chromium" | "firefox" | "webkit";

export interface RunnerSettings {
  // …existing…
  browsers: BrowserName[]; // non-empty; which Playwright projects to run
}
```

- `DEFAULT_SETTINGS.runner.browsers = ["chromium"]`.
- Change `DEFAULT_SETTINGS.runner.browserInstallCommand` from
  `"npx playwright install chromium"` to the browser-agnostic base
  `"npx playwright install"` (the selected browsers are appended at install time,
  see §3).

### 2. Settings repair — `src/application/services/settings-service.ts`

Follow the existing per-field, log-and-repair pattern: if `runner.browsers` is
missing, not an array, empty after filtering, or contains unknown members →
repair to `["chromium"]`. Otherwise filter to valid `BrowserName`s and dedupe
(preserve order). Each repair logs, as the other scalar repairs do.

### 3. Install flow — `src/application/services/runner-installation-service.ts`

`installBrowsers(settings)` today runs the tokenized
`settings.runner.browserInstallCommand`. Change it to append the selected
browsers:

```ts
const argv = [...tokenizeCommand(settings.runner.browserInstallCommand), ...settings.runner.browsers];
// → ["npx","playwright","install","chromium","firefox"]
```

- `CommandSafetyPolicy.validateNpx` already permits `npx playwright install <args…>`
  — **no policy change**. Add a regression test asserting
  `["npx","playwright","install","firefox","webkit"]` is allowed.
- `documentation-content.ts` interpolates `browserInstallCommand`; update those
  two references so the generated docs show the base command plus a note that the
  configured browsers are appended.

### 4. Run wiring — `src/application/services/test-execution-service.ts`

- On every spawn, set scope-env `TESTRUNNER_BROWSERS = settings.runner.browsers.join(",")`.
- Add `TESTRUNNER_BROWSERS` to the cleared baseline (the existing block that sets
  `BDD_FEATURES=""`/`BDD_TAGS=""`) so an ambient shell value never leaks — it is
  set explicitly from settings on every run, for every scope.

### 5. Generated config — `src/infrastructure/runner/templates/runner-templates.ts`

Replace the hardcoded single-project array with a matrix built from the env var:

```ts
const browsers = process.env.TESTRUNNER_BROWSERS?.split(",").map((b) => b.trim()).filter(Boolean) ?? [];
const projectBrowsers = browsers.length > 0 ? browsers : ["chromium"];
// …
projects: projectBrowsers.map((name) => ({ name, use: { browserName: name } })),
```

`featuresRoot`, reporter, screenshot/trace config are unchanged.

### 6. Result collapse — report import path

When N browsers run, the report carries up to N results per scenario (one per
project). Add a pure helper (e.g. `collapseByScenario` in the report-import area):

```ts
collapseByScenario(results: ScenarioResult[]): ScenarioResult[]
```

- Group by scenario reference: `featureUri` + scenario `name` (+ row index when
  present).
- Reduce status to the worst across the group: `failed` ≻ `skipped` ≻ `passed`.
- Keep the longest duration and the first error message in the group.

Apply it after parse, before evidence generation and count derivation, so
`TestRunResult` totals are computed from collapsed results → `total` = distinct
scenarios (not ×N). The helper is a no-op when only one browser runs (or if the
reporter already merges projects — see S1).

### 7. Settings UI — `src/presentation/settings/settings-tab.ts`

Three checkboxes (chromium / firefox / webkit) bound to `runner.browsers`, with
the last-checked one non-removable (enforce non-empty in the UI as well as
repair). An "Install selected browsers" button invokes the install flow (§3).

## Error handling

- Empty/invalid `browsers` → repaired to `["chromium"]` (settings) and defaulted
  in the generated config (§5).
- Unknown name in `TESTRUNNER_BROWSERS` → filtered; falls back to chromium if
  nothing valid remains.
- Browser install failure surfaces through the existing
  `installBrowsers` → `RunnerCommandResult` error path (unchanged).

## Testing strategy

- **settings**: default is `["chromium"]`; repair cases (missing / non-array /
  empty / unknown member / duplicates).
- **config generation**: `projects[]` from `TESTRUNNER_BROWSERS` for 0 / 1 / 3
  browsers and an invalid value (defaults to chromium).
- **run wiring**: spawn env includes `TESTRUNNER_BROWSERS` from settings for each
  scope; the cleared baseline sets it explicitly.
- **install**: argv derivation appends `browsers`; command-safety regression for
  `npx playwright install firefox webkit`.
- **collapse**: N→1 per scenario, worst-status precedence, duration/error
  retention, count recomputation.
- **UI**: covered by the settings-tab integration tests where feasible.

## Open spikes

- **S1**: confirm the shape of playwright-bdd's `cucumberReporter('json')` output
  with two projects — does it emit N elements per scenario or pre-merge? The
  collapse (§6) is correct either way; the spike just confirms whether collapse
  is active or a no-op, and whether the project name is present (which would let
  the deferred per-browser breakdown reuse it). Run a 2-project demo during
  implementation.

## References

- ADR-0025 (default browser matrix), EPIC-013, US-055.
- Touches: `settings.ts`, `settings-service.ts`, `runner-installation-service.ts`,
  `test-execution-service.ts`, `runner-templates.ts`, the report-import path,
  `settings-tab.ts`, `documentation-content.ts`.

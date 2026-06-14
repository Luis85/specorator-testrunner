---
title: US-055 Browser Matrix — Design
date: 2026-06-14
status: implemented
epic: EPIC-013
story: US-055
adr: ADR-0025
resolved: PR #52 (2026-06-14)
---

# US-055 Browser Matrix — Design

> **Implemented (2026-06-14) in PR #52** — all plan tasks landed; gate green
> (1074 tests, typecheck/lint/format, `fallow audit` exit 0). Follow-up: the S1
> spike (confirm playwright-bdd's cucumber-JSON yields a cross-project-stable
> scenario `id` in a real 2-browser run) needs a local multi-browser run; the
> collapse is robust to either outcome and is fixture-tested.

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
- Leave `DEFAULT_SETTINGS.runner.browserInstallCommand` as
  `"npx playwright install chromium"`. §3's install flow strips baked-in
  browser-name tokens before appending the selection, so the default works
  unchanged in every state. (Changing it to a bare `npx playwright install`
  before that strip lands would over-install ALL browsers on init/repair.)

### 2. Settings repair — `src/application/services/settings-service.ts`

Follow the existing per-field, log-and-repair pattern: if `runner.browsers` is
missing, not an array, empty after filtering, or contains unknown members →
repair to `["chromium"]`. Otherwise filter to valid `BrowserName`s and dedupe
(preserve order). Each repair logs, as the other scalar repairs do.

### 3. Install flow — `src/application/services/runner-installation-service.ts`

`installBrowsers(settings)` today runs the tokenized
`settings.runner.browserInstallCommand`, whose **old default baked in
`chromium`**. Build the argv so it is **browser-agnostic by construction** —
strip any baked-in browser-name tokens, then append the selected browsers:

```ts
const BROWSER_NAMES = new Set<string>(["chromium", "firefox", "webkit"]);
const base = tokenizeCommand(settings.runner.browserInstallCommand)
  .filter((tok) => !BROWSER_NAMES.has(tok)); // drop a persisted "chromium"
const argv = [...base, ...settings.runner.browsers];
// "npx playwright install chromium" + ["firefox"] → ["npx","playwright","install","firefox"]
```

**Migration-free, idempotent** — this directly answers the `mergeWithDefaults`
concern: existing Vaults whose persisted `browserInstallCommand` still reads
`npx playwright install chromium` are normalized at use-time, so a firefox-only
selection installs *only* firefox (honoring "no forced chromium") without a
settings migration. User-added flags (e.g. `--with-deps`) survive the filter.
The default `browserInstallCommand` stays `"npx playwright install chromium"`;
the strip makes it browser-agnostic at use-time, so no default change (or
migration) is needed.

- `CommandSafetyPolicy.validateNpx` already permits `npx playwright install <args…>`
  — **no policy change**. Add a regression test asserting
  `["npx","playwright","install","firefox","webkit"]` is allowed.
- `documentation-content.ts` interpolates `browserInstallCommand`; update those
  two references so the generated docs show the base command plus a note that the
  configured browsers are appended.
- **Validation pairs with install:** `EnvironmentValidationService.detectBrowsers`
  currently passes when a `chromium-*` cache entry exists (AD-5 legacy). With the
  matrix it must verify **every selected browser** is cached (a firefox-only
  install validates as installed; a chromium-only cache fails when firefox is
  selected), and the `BROWSER_NOT_INSTALLED` / "Chromium is not installed"
  wording must name the missing/selected browser(s). See Task 5b.

### 4. Run wiring — `src/application/services/test-execution-service.ts`

`TESTRUNNER_BROWSERS` is global (from settings), so set it in `runEnv(settings)`
— the per-run env that already carries `BASE_URL`/auth and is spread into every
spawn (`{ ...runEnv(settings), ...scopeEnv }`). Setting it there means every
scope inherits it, and any ambient `TESTRUNNER_BROWSERS` is always overridden
from settings:

```ts
TESTRUNNER_BROWSERS: settings.runner.browsers.join(","),
```

Not `CLEARED_BDD_SCOPE` — that is a static const with no access to settings
(it exists only to clear the conditionally-set `BDD_FEATURES`/`BDD_TAGS`).

### 5. Generated config — `src/infrastructure/runner/templates/runner-templates.ts`

Replace the hardcoded single-project array with a matrix built from the env var:

```ts
const VALID_BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const requested = (process.env.TESTRUNNER_BROWSERS?.split(",").map((b) => b.trim()) ?? [])
  .filter((b) => VALID_BROWSERS.has(b)); // drop unknown names (e.g. "chrome")
const projectBrowsers = requested.length > 0 ? requested : ["chromium"];
// …
projects: projectBrowsers.map((name) => ({ name, use: { browserName: name } })),
```

`featuresRoot`, reporter, screenshot/trace config are unchanged. Existing Vaults
pick up this new config via a manifest-version bump → repair — see §9.

### 6. Result collapse — report import path

When N browsers run, the report carries up to N results per scenario (one per
project). Collapsing must NOT merge distinct **Scenario Outline rows** — which
can share a scenario `name` — so the parser must carry a **stable per-row
identity** from the raw report into `ScenarioResult`. The current contract
exposes only `featureUri` + `name`; add the cucumber-JSON element `id` (which
encodes `feature;scenario;;<row>`) as `scenarioId?: string` (with `line?: number`
as a fallback discriminator), populated by `CucumberJsonReportParser`. This is
also the row key the deferred per-browser breakdown and ADR-0022's Scenario
Reference will reuse.

```ts
collapseByScenario(results: ScenarioResult[]): ScenarioResult[]
```

- Group key: `featureUri` + `scenarioId` (fallback `line`, then `name` only when
  neither is present — e.g. single-scenario features). Outline rows stay distinct.
- Reduce status to the worst across the group: `failed` ≻ `skipped` ≻ `passed`.
- Keep the longest duration and the worst result's error message in the group.

Apply it after parse, before evidence generation and count derivation, so
`TestRunResult` totals are computed from collapsed results → `total` = distinct
scenario **rows** (not ×N). No-op for a single browser. The group key must be
stable across projects (same row → same `id` in every browser's results — see S1).

### 7. Settings UI — `src/presentation/settings/settings-tab.ts`

Three checkboxes (chromium / firefox / webkit) bound to `runner.browsers`, with
the last-checked one non-removable (enforce non-empty in the UI as well as
repair). An "Install selected browsers" button invokes the install flow (§3).

### 8. Generated CI workflow — `src/application/content/ci-workflow-content.ts`

The generated GitHub Actions workflow runs the standalone runner in CI, so it
must honor the same matrix — otherwise a firefox/webkit selection runs locally
(via `TestExecutionService`) but CI silently installs/runs chromium only (§5
defaults to `["chromium"]` when `TESTRUNNER_BROWSERS` is unset). Drive both from
`settings.runner.browsers` when generating the workflow:

- **Install step:** `npx playwright install --with-deps <selected…>` instead of
  the hard-coded `… chromium` (build the browser list as in §3).
- **Run-tests step env:** add `TESTRUNNER_BROWSERS: <csv>` alongside the existing
  `BASE_URL`/auth env, so the generated `playwright.config.ts` builds the matrix.

The workflow is a snapshot of settings at generation time, so changing `browsers`
later requires regenerating the CI workflow — same as any other runner setting
(call this out in the generated workflow header / docs).

### 9. Runner manifest + generated install scripts — `runner-manifest.ts`, `runner-templates.ts`

Two managed-file changes existing Vaults must pick up:

- **Generated `package.json` scripts + README** (`runner-templates.ts`): the
  `install:browsers` / `install:browsers:ci` scripts hardcode `chromium`. Bake the
  selected browsers instead — `playwright install <selected…>` /
  `playwright install --with-deps <selected…>` — and update the README wording, so
  a standalone Vault that follows the generated scripts installs the right binaries.
- **Manifest version bump** (`runner-manifest.ts`): the generated
  `playwright.config.ts` and these scripts are *managed* files, and
  `EnvironmentValidationService` only flags a runner outdated when its stamped
  `manifestVersion !== TESTRUNNER_MANIFEST_VERSION` (currently `2`). Changing the
  config contract WITHOUT bumping the version leaves existing V2 Vaults stamped at
  the current value — never flagged, never repaired — so their on-disk config
  stays chromium-only and a firefox/webkit selection only sets an env var the
  stale config ignores. **Bump `TESTRUNNER_MANIFEST_VERSION` 2 → 3** so those
  Vaults are flagged outdated and the user's repair regenerates the env-driven
  config + matrix-aware scripts.

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
- **install**: argv strips baked-in browser names then appends `browsers` —
  including the **old-default Vault case** (`"npx playwright install chromium"` +
  firefox-only → installs firefox only, not chromium); `--with-deps` flag
  survives; command-safety regression for `npx playwright install firefox webkit`.
- **collapse**: N→1 per scenario-row, worst-status precedence, duration/error
  retention, count recomputation — including a **Scenario Outline** whose rows
  share a name across multiple browsers (distinct `scenarioId`s are NOT merged).
- **UI**: covered by the settings-tab integration tests where feasible.

## Open spikes

- **S1**: confirm playwright-bdd's `cucumberReporter('json')` shape with two
  projects, using a feature that contains a **Scenario Outline**: (a) does each
  scenario/outline-row element carry a stable `id`/`line`; (b) are outline rows
  DISTINCT (so collapse won't merge them); (c) is that `id` stable **across
  projects** (so the N browser copies of one row group together); and (d) is the
  Playwright project (browser) name present (which would let the deferred
  per-browser breakdown reuse it)? Drives the collapse key (§6). If `id` is NOT
  cross-project-stable, collapse from the raw report before `ScenarioResult` is
  built. Run a 2-project, outline-containing demo during implementation.

## References

- ADR-0025 (default browser matrix), EPIC-013, US-055.
- Touches: `settings.ts`, `settings-service.ts`, `runner-installation-service.ts`,
  `test-execution-service.ts`, `runner-templates.ts`, the report-import path,
  `settings-tab.ts`, `documentation-content.ts`.

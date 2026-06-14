# US-055 Browser Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user run the Playwright-bdd suite across a chosen subset of {chromium, firefox, webkit}, with an install flow and CI that honor the selection, and result counts that stay meaningful across browsers.

**Architecture:** A global `RunnerSettings.browsers` array drives a dynamic Playwright `projects[]` via the `TESTRUNNER_BROWSERS` env var (consistent with `BDD_TAGS`/`BDD_FEATURES`); the install flow and generated CI workflow read the same setting; per-browser results are collapsed to a worst-status verdict per scenario row.

**Tech Stack:** TypeScript, vitest, playwright-bdd, Obsidian plugin (layered domain/application/infrastructure/presentation).

**Spec:** `docs/superpowers/specs/2026-06-14-us-055-browser-matrix-design.md`. **Gate after every task:** `npm test`; final gate adds `npm run typecheck && npm run lint && npm run format:check && npx fallow audit --base origin/main`.

---

## File structure

| File | Change |
| --- | --- |
| `src/domain/settings/settings.ts` | Add `BrowserName` + `RunnerSettings.browsers`; defaults |
| `src/application/services/settings-service.ts` | Repair `runner.browsers` |
| `src/infrastructure/runner/templates/runner-templates.ts` | `projects[]` from `TESTRUNNER_BROWSERS`; matrix-aware install scripts + README |
| `src/application/content/runner-manifest.ts` | Bump `TESTRUNNER_MANIFEST_VERSION` 2→3 (config contract change) |
| `src/application/services/test-execution-service.ts` | Set `TESTRUNNER_BROWSERS` on every spawn |
| `src/application/services/runner-installation-service.ts` | Strip baked-in browser, append selection |
| `src/application/ports/report-parser.ts` | `ScenarioResult.scenarioId?`/`line?` |
| `src/application/services/cucumber-json-report-parser.ts` | Populate id/line; collapse + recount |
| `src/application/services/collapse-scenario-results.ts` (new) | `collapseByScenario` pure helper |
| `src/application/content/ci-workflow-content.ts` | Install + run-env honor `browsers` |
| `src/presentation/settings/settings-tab.ts` | Browser checkboxes + install button |
| `src/application/content/documentation-content.ts` | `browserInstallCommand` reference wording |
| `src/application/services/environment-validation-service.ts` | Validate the selected browsers (not just chromium) |

---

## Task 1: Settings model + defaults

**Files:** Modify `src/domain/settings/settings.ts`; Test `tests/settings-service.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings-service.test.ts — add inside an existing describe or a new one
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";

it("defaults runner.browsers to chromium-only", () => {
  expect(DEFAULT_SETTINGS.runner.browsers).toEqual(["chromium"]);
  expect(DEFAULT_SETTINGS.runner.browserInstallCommand).toBe("npx playwright install chromium");
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/settings-service.test.ts -t "defaults runner.browsers"`
Expected: FAIL (`browsers` is undefined; install command still `… chromium`).

- [ ] **Step 3: Implement**

In `src/domain/settings/settings.ts`, add the type above `RunnerSettings` (line ~23) and the field:

```ts
export type BrowserName = "chromium" | "firefox" | "webkit";
export const BROWSER_NAMES: readonly BrowserName[] = ["chromium", "firefox", "webkit"];
```

```ts
export interface RunnerSettings {
  packageManager: PackageManager;
  nodeExecutable: string;
  installCommand: string;
  ciInstallCommand: string;
  browserInstallCommand: string;
  browsers: BrowserName[]; // non-empty; which Playwright projects to run (US-055)
  defaultRunCommand: string;
  smokeRunCommand: string;
  ciRunCommand: string;
}
```

In `DEFAULT_SETTINGS.runner` (lines ~220-229) add the `browsers` field; **leave
`browserInstallCommand` as `"npx playwright install chromium"`** (Task 5 strips
the browser name before appending the selection, so the default needs no change):

```ts
    browsers: ["chromium"],
```

- [ ] **Step 4: Run it — expect PASS** (`npx vitest run tests/settings-service.test.ts -t "defaults runner.browsers"`)
- [ ] **Step 5: Run `npm run typecheck`** — fix any consumer that constructs a `RunnerSettings` literal (e.g. test fixtures) by adding `browsers: ["chromium"]`.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(settings): add RunnerSettings.browsers (US-055)"`

## Task 2: Repair `runner.browsers`

**Files:** Modify `src/application/services/settings-service.ts`; Test `tests/settings-service.test.ts`.

The load path runs `sanitizeRunnerEnvInputs` (lines ~367-389). Add browser repair there (it already returns a rebuilt `runner`).

- [ ] **Step 1: Write the failing tests**

```ts
it("repairs an empty/invalid runner.browsers to ['chromium']", async () => {
  const { service } = makeService({
    runner: { ...DEFAULT_SETTINGS.runner, browsers: [] },
  });
  const s = await service.load();
  expect(s.runner.browsers).toEqual(["chromium"]);
});

it("filters unknown browsers and dedupes, preserving order", async () => {
  const { service } = makeService({
    runner: { ...DEFAULT_SETTINGS.runner, browsers: ["firefox", "ie", "firefox", "webkit"] },
  });
  const s = await service.load();
  expect(s.runner.browsers).toEqual(["firefox", "webkit"]);
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/settings-service.test.ts -t "runner.browsers"`)

- [ ] **Step 3: Implement** — in `settings-service.ts` add a helper near the other field validators and call it inside `sanitizeRunnerEnvInputs`, mirroring the `nodeExecutable` log+fallback pattern:

```ts
import { BROWSER_NAMES, type BrowserName } from "../../domain/settings/settings";

const repairBrowsers = (raw: unknown): { browsers: BrowserName[]; repaired: boolean } => {
  const valid = new Set<string>(BROWSER_NAMES);
  const seen = new Set<string>();
  const cleaned: BrowserName[] = [];
  if (Array.isArray(raw)) {
    for (const b of raw) {
      if (typeof b === "string" && valid.has(b) && !seen.has(b)) {
        seen.add(b);
        cleaned.push(b as BrowserName);
      }
    }
  }
  if (cleaned.length === 0) return { browsers: ["chromium"], repaired: true };
  return { browsers: cleaned, repaired: cleaned.length !== (Array.isArray(raw) ? raw.length : -1) };
};
```

Inside `sanitizeRunnerEnvInputs`, after the `nodeExecutable` block and before the return, add:

```ts
    const browsers = repairBrowsers(runner.browsers);
    if (browsers.repaired) {
      this.logger.error(
        `Configured "runner.browsers" was invalid; falling back to a valid set.`,
        undefined,
        { value: runner.browsers, fallback: browsers.browsers },
      );
    }
    runner = { ...runner, browsers: browsers.browsers };
```

- [ ] **Step 4: Run — expect PASS**; then `npm test` (whole suite stays green).
- [ ] **Step 5: Commit** — `git commit -am "feat(settings): repair runner.browsers (US-055)"`

## Task 3: Generated `playwright.config.ts` projects from env

**Files:** Modify `src/infrastructure/runner/templates/runner-templates.ts`; Test `tests/runner-templates.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it("config builds projects[] from process.env.TESTRUNNER_BROWSERS", () => {
  const config = configFor(DEFAULT_SETTINGS);
  expect(config).toContain("process.env.TESTRUNNER_BROWSERS");
  // default fallback present
  expect(config).toContain('["chromium"]');
  // does NOT hardcode a single chromium project literal anymore
  expect(config).not.toContain('projects: [{ name: "chromium"');
  // unknown names are filtered out at runtime (valid-set guard)
  expect(config).toContain('new Set(["chromium", "firefox", "webkit"])');
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/runner-templates.test.ts -t "TESTRUNNER_BROWSERS"`)

- [ ] **Step 3: Implement** — in the `PLAYWRIGHT_CONFIG` template (lines ~78-117). This text lives INSIDE the backtick template (literal config source — no `\\n` escaping). First, just before `export default defineConfig({`, add the browser resolution (drops unknown names, falls back to chromium — matches the spec's Error-handling promise):

```ts
// The Test Hub sets TESTRUNNER_BROWSERS (comma-separated) from
// RunnerSettings.browsers; unknown names are dropped and an empty/unset value
// falls back to chromium (US-055, ADR-0025).
const VALID_BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const requestedBrowsers = (process.env.TESTRUNNER_BROWSERS?.split(",").map((b) => b.trim()) ?? [])
  .filter((b) => VALID_BROWSERS.has(b));
const projectBrowsers = requestedBrowsers.length > 0 ? requestedBrowsers : ["chromium"];

export default defineConfig({
```

Then replace the hardcoded projects line:

```ts
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
```

with:

```ts
  projects: projectBrowsers.map((name) => ({ name, use: { browserName: name } })),
```

- [ ] **Step 4: Run — expect PASS**; `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): generate Playwright projects[] from TESTRUNNER_BROWSERS (US-055)"`

## Task 3b: Generated package.json install scripts + README honor the matrix

**Files:** Modify `src/infrastructure/runner/templates/runner-templates.ts`; Test `tests/runner-templates.test.ts`.

The generated `package.json` (lines ~35-40) hardcodes `"install:browsers": "playwright install chromium"` and `"install:browsers:ci": "playwright install --with-deps chromium"`; the README (~216, 225) says "Chromium download". Bake the selected browsers.

- [ ] **Step 1: Write the failing test**

```ts
it("generated package.json install scripts install the selected browsers", () => {
  const pkg = buildRunnerTemplates({
    ...DEFAULT_SETTINGS,
    runner: { ...DEFAULT_SETTINGS.runner, browsers: ["chromium", "firefox"] },
  }).find((t) => t.path === "package.json")?.content ?? "";
  expect(pkg).toContain('"install:browsers": "playwright install chromium firefox"');
  expect(pkg).toContain('"install:browsers:ci": "playwright install --with-deps chromium firefox"');
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/runner-templates.test.ts -t "install scripts install the selected"`)

- [ ] **Step 3: Implement** — in the package.json template (find where its content string is built from `settings`), compute `const browserArgs = settings.runner.browsers.join(" ");` and interpolate it:

```ts
    "install:browsers": `playwright install ${browserArgs}`,
    "install:browsers:ci": `playwright install --with-deps ${browserArgs}`,
```

Update the README template lines (~216, 225) to read "the configured browsers" instead of "Chromium". (If the package.json template currently takes only specific fields rather than full `settings`, thread `settings.runner.browsers` through to it.)

- [ ] **Step 4: Run — expect PASS**; `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): generated install scripts honor the browser matrix (US-055)"`

## Task 3c: Bump the runner manifest version (existing Vaults repair into the new config)

**Files:** Modify `src/application/content/runner-manifest.ts`; Test `tests/environment-validation-service.test.ts`, `tests/runner-manifest.test.ts` (and any test asserting the version).

The generated `playwright.config.ts` + install scripts are *managed* files; `EnvironmentValidationService` (line ~244) flags a runner outdated only when `manifestVersion !== TESTRUNNER_MANIFEST_VERSION`. Without a bump, existing V2 Vaults (stamped `2`) are never flagged → they keep the chromium-only config and ignore the new env var. Bump `2 → 3`.

- [ ] **Step 1: Write the failing test** — in `tests/environment-validation-service.test.ts`, find the existing outdated-manifest case and add one stamping the *previous* version:

```ts
it("flags a runner stamped at the previous manifest version (2) as needing repair", async () => {
  // Arrange a .testrunner whose testrunner-manifest.json is { manifestVersion: 2 },
  // using this file's existing build/fake helper for an installed runner.
  // Assert the validation result reports the runner as outdated / repair-needed,
  // matching the assertion shape the existing outdated-manifest test uses.
});
```

Also add, in `tests/runner-manifest.test.ts` (or wherever the constant/stamp is asserted):

```ts
it("stamps manifest version 3", () => {
  expect(TESTRUNNER_MANIFEST_VERSION).toBe(3);
});
```

- [ ] **Step 2: Run — expect FAIL** (constant is still `2`).

- [ ] **Step 3: Implement** — `src/application/content/runner-manifest.ts` line ~54:

```ts
export const TESTRUNNER_MANIFEST_VERSION = 3;
```

- [ ] **Step 4: Run — expect PASS**; then `npm test` — search the suite for any expectation hardcoding `2` / `manifestVersion: 2` as the *current* version and bump to `3` (a v2 stamp is now the outdated case, not current).

- [ ] **Step 5: Commit** — `git commit -am "feat(runner): bump manifest version for the browser-matrix config change (US-055)"`

## Task 4: Set `TESTRUNNER_BROWSERS` on every spawn

**Files:** Modify `src/application/services/test-execution-service.ts`; Test `tests/test-execution-service.test.ts`.

The baseline `CLEARED_BDD_SCOPE` (line ~208) is spread into every scope env; the final spawn env is `{ ...this.runEnv(settings), ...scopeEnv }` (line ~437). `TESTRUNNER_BROWSERS` is global (from settings), so set it in `runEnv` — that way every scope inherits it without touching each scope branch.

- [ ] **Step 1: Write the failing test** (use the existing `build()` helper; trigger any run and inspect the captured spawn env via `FakeChildProcessRunner`)

```ts
it("passes TESTRUNNER_BROWSERS from settings on every run", async () => {
  const { service, childProcess, settings } = build();
  await settings.save({
    ...(await settings.load()),
    runner: { ...DEFAULT_SETTINGS.runner, browsers: ["chromium", "firefox"] },
  });
  await service.execute({ scope: "demo" });
  expect(childProcess.lastRun?.env?.TESTRUNNER_BROWSERS).toBe("chromium,firefox");
});
```

(Confirm the `FakeChildProcessRunner` exposes the last run's `env`; if the property differs, match the existing assertions in this test file for env — e.g. how `BDD_TAGS` is asserted — and mirror them. Import `DEFAULT_SETTINGS` if not already.)

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/test-execution-service.test.ts -t "TESTRUNNER_BROWSERS"`)

- [ ] **Step 3: Implement** — in `runEnv(settings)` (lines ~621-628), add `TESTRUNNER_BROWSERS` to the returned record:

```ts
return {
  ...(baseUrl ? { BASE_URL: baseUrl } : {}),
  ...authEnv,
  TESTRUNNER_BROWSERS: settings.runner.browsers.join(","),
};
```

(Adapt to the exact current shape of `runEnv`'s return; the point is to add `TESTRUNNER_BROWSERS: settings.runner.browsers.join(",")`. It is global, so it belongs in `runEnv`, not the per-scope branches or `CLEARED_BDD_SCOPE`.)

- [ ] **Step 4: Run — expect PASS**; `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): pass TESTRUNNER_BROWSERS to every run (US-055)"`

## Task 5: Install flow — strip baked-in browser, append selection

**Files:** Modify `src/application/services/runner-installation-service.ts`; Test `tests/runner-installation-service.test.ts`, `tests/command-safety-policy.test.ts`.

`installBrowsers` (lines ~79-86) delegates to `spawnInRunner(settings, settings.runner.browserInstallCommand, …)`, which does `command.trim().split(/\s+/)`. Change `installBrowsers` to build the argv itself (browser-agnostic base + selection) and pass it to a spawn that accepts argv.

- [ ] **Step 1: Write the failing tests**

```ts
// runner-installation-service.test.ts
it("installs only the selected browsers, stripping a baked-in chromium (old Vault)", async () => {
  const { service, childProcess } = build();
  const settings: TestHubSettings = {
    ...DEFAULT_SETTINGS,
    runner: {
      ...DEFAULT_SETTINGS.runner,
      browserInstallCommand: "npx playwright install chromium", // persisted old default
      browsers: ["firefox"],
    },
  };
  await service.installBrowsers(settings);
  expect(childProcess.lastRun?.args).toEqual(["npx", "playwright", "install", "firefox"]);
});

it("preserves flags like --with-deps while swapping browsers", async () => {
  const { service, childProcess } = build();
  const settings: TestHubSettings = {
    ...DEFAULT_SETTINGS,
    runner: { ...DEFAULT_SETTINGS.runner, browserInstallCommand: "npx playwright install --with-deps", browsers: ["chromium", "webkit"] },
  };
  await service.installBrowsers(settings);
  expect(childProcess.lastRun?.args).toEqual(["npx", "playwright", "install", "--with-deps", "chromium", "webkit"]);
});
```

```ts
// command-safety-policy.test.ts — regression
it("allows npx playwright install with multiple browser args", () => {
  const policy = new DefaultCommandSafetyPolicy();
  expect(policy.assertSafe(["npx", "playwright", "install", "firefox", "webkit"]).ok).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL** (the install argv tests fail; the command-safety one should already PASS — keep it as a guard).

- [ ] **Step 3: Implement** — in `runner-installation-service.ts` add the helper + rewrite `installBrowsers` to build argv and call an argv-spawning path. Add a `spawnArgvInRunner(settings, args, code, label)` by extracting from `spawnInRunner` (which already takes a command string and splits it) — simplest: add an overload/sibling that accepts `args: string[]` directly and shares the cwd-resolve + run + error handling:

```ts
import { BROWSER_NAMES } from "../../domain/settings/settings";

installBrowsers(settings: TestHubSettings): Promise<Result<RunnerCommandResult>> {
  const browserSet = new Set<string>(BROWSER_NAMES);
  const base = settings.runner.browserInstallCommand.trim().split(/\s+/).filter((t) => !browserSet.has(t));
  const args = [...base, ...settings.runner.browsers];
  return this.spawnArgvInRunner(settings, args, "BROWSER_NOT_INSTALLED", "browser installation");
}
```

Refactor `spawnInRunner` to delegate: keep `spawnInRunner(settings, command, code, label)` doing `command.trim().split(/\s+/)` then calling the new `spawnArgvInRunner(settings, args, code, label)` which contains the existing cwd-resolve + `this.process.run` + error handling (lines ~99-125 moved verbatim, taking `args` as a param).

- [ ] **Step 4: Run — expect PASS** (all three); `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): install the selected browser matrix, migration-free (US-055)"`

## Task 5b: Environment validation honors the selected browsers

**Files:** Modify `src/application/services/environment-validation-service.ts`; Test `tests/environment-validation-service.test.ts`.

`detectBrowsers(runnerAbs)` (lines ~516-525) returns true when any cache entry starts with `chromium` (AD-5 legacy). With the matrix it must require **every selected browser** to be cached, else a firefox-only install still reports `BROWSER_NOT_INSTALLED` / "Chromium is not installed."

- [ ] **Step 1: Write the failing tests** — in `tests/environment-validation-service.test.ts`, using the file's existing build/fake helpers for the Playwright browser cache (the fake `AbsoluteFileSystem` whose `listAbsolute` returns cache entries) and settings:

```ts
it("validates browsers as installed when every selected browser is cached (firefox-only)", async () => {
  // settings.runner.browsers = ["firefox"]; cache dir lists ["firefox-1234"]
  // → result.browsersInstalled === true
});
it("reports browsers missing when a selected browser is absent (firefox selected, only chromium cached)", async () => {
  // settings.runner.browsers = ["firefox"]; cache dir lists ["chromium-1234"]
  // → result.browsersInstalled === false (and the surfaced message names firefox)
});
```

(Match the file's existing assertion style for `browsersInstalled` and the `BROWSER_NOT_INSTALLED` message; reuse its cache-population helper.)

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/environment-validation-service.test.ts -t "selected browser"`)

- [ ] **Step 3: Implement** — give `detectBrowsers` the selection and require all present:

```ts
private async detectBrowsers(runnerAbs: string, browsers: readonly BrowserName[]): Promise<boolean> {
  const found = new Set<string>();
  for (const candidate of playwrightBrowsersCandidates(this.platform, this.env, runnerAbs)) {
    const entries = await this.absoluteFs.listAbsolute(candidate);
    for (const browser of browsers) {
      if (entries.some((entry) => entry.toLowerCase().startsWith(browser))) found.add(browser);
    }
  }
  return browsers.every((browser) => found.has(browser));
}
```

Update its caller to pass `settings.runner.browsers` (import `BrowserName` from the settings module). Update the `BROWSER_NOT_INSTALLED` message and any "Chromium is not installed" / Chromium-specific settings-row wording to name the selected/missing browser(s) (e.g. interpolate the selection). Keep the AD-5 comment honest (no longer chromium-only).

- [ ] **Step 4: Run — expect PASS**; `npm test`; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -am "feat(validation): validate the selected browser matrix (US-055)"`

## Task 6: `ScenarioResult` carries a row identity

**Files:** Modify `src/application/ports/report-parser.ts`, `src/application/services/cucumber-json-report-parser.ts`; Test `tests/cucumber-json-report-parser.test.ts` + `tests/cucumber-report-fixtures.ts`.

- [ ] **Step 1: Add a fixture + failing test** — in `tests/cucumber-report-fixtures.ts` add a minimal report whose element carries `id` and `line`, then assert the parser surfaces them:

```ts
// cucumber-json-report-parser.test.ts
it("carries the element id and line onto ScenarioResult", () => {
  const report = JSON.stringify([
    { name: "F", uri: "features/UC-1-x.feature", elements: [
      { name: "S", type: "scenario", id: "f;s;;2", line: 7,
        steps: [{ keyword: "Given ", result: { status: "passed", duration: 1_000_000 } }] },
    ] },
  ]);
  const parsed = parser.parse(report, ctx());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.scenarioResults[0].scenarioId).toBe("f;s;;2");
  expect(parsed.value.scenarioResults[0].line).toBe(7);
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/cucumber-json-report-parser.test.ts -t "element id and line"`)

- [ ] **Step 3: Implement** — in `report-parser.ts` (lines 6-14) add two optional fields:

```ts
export interface ScenarioResult {
  feature: string;
  featureUri?: string;
  scenario: string;
  scenarioId?: string; // cucumber-JSON element id (feature;scenario;;<row>) — row identity (US-055)
  line?: number; // feature-file line of the scenario/outline row (fallback discriminator)
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  errorMessage?: string;
}
```

In `cucumber-json-report-parser.ts`: add `id?: string; line?: number;` to the `CucumberScenario` interface (lines 31-37), and in `mapScenario` (the `scenarioResults.push({…})` at ~216) add:

```ts
      ...(typeof scenario.id === "string" ? { scenarioId: scenario.id } : {}),
      ...(typeof scenario.line === "number" ? { line: scenario.line } : {}),
```

- [ ] **Step 4: Run — expect PASS**; `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(report): carry scenario id/line onto ScenarioResult (US-055)"`

## Task 7: `collapseByScenario` helper

**Files:** Create `src/application/services/collapse-scenario-results.ts`; Test `tests/collapse-scenario-results.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { collapseByScenario } from "../src/application/services/collapse-scenario-results";
import type { ScenarioResult } from "../src/application/ports/report-parser";

const r = (over: Partial<ScenarioResult>): ScenarioResult => ({
  feature: "F", featureUri: "features/UC-1.feature", scenario: "S", status: "passed", ...over,
});

describe("collapseByScenario", () => {
  it("collapses N browser results for one scenario to a worst-status verdict", () => {
    const out = collapseByScenario([
      r({ scenarioId: "f;s;;1", status: "passed", durationMs: 10 }),
      r({ scenarioId: "f;s;;1", status: "failed", durationMs: 20, errorMessage: "boom" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("failed");
    expect(out[0].durationMs).toBe(20);
    expect(out[0].errorMessage).toBe("boom");
  });

  it("does NOT merge distinct Scenario Outline rows that share a name", () => {
    const out = collapseByScenario([
      r({ scenario: "Outline", scenarioId: "f;o;;1", status: "passed" }),
      r({ scenario: "Outline", scenarioId: "f;o;;2", status: "failed" }),
      r({ scenario: "Outline", scenarioId: "f;o;;1", status: "passed" }), // 2nd browser, row 1
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.status)).toEqual(["passed", "failed"]);
  });

  it("falls back to line, then name, when no id is present", () => {
    const out = collapseByScenario([
      r({ scenarioId: undefined, line: 7, status: "passed" }),
      r({ scenarioId: undefined, line: 7, status: "skipped" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("skipped");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

- [ ] **Step 3: Implement** — create `src/application/services/collapse-scenario-results.ts`:

```ts
import type { ScenarioResult } from "../ports/report-parser";

const RANK: Record<ScenarioResult["status"], number> = { passed: 0, skipped: 1, failed: 2 };

/**
 * Collapses the N per-browser results of each scenario row to a single
 * worst-status verdict (US-055). Distinct Scenario Outline rows stay separate:
 * the group key is the report's stable per-row id (`scenarioId`), falling back
 * to `line`, then the scenario name. Insertion order is preserved.
 */
export const collapseByScenario = (results: ScenarioResult[]): ScenarioResult[] => {
  const order: string[] = [];
  const byKey = new Map<string, ScenarioResult>();
  for (const result of results) {
    const disc = result.scenarioId ?? (result.line !== undefined ? `L${result.line}` : result.scenario);
    const key = `${result.featureUri ?? ""} ${disc}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...result });
      order.push(key);
      continue;
    }
    existing.durationMs = Math.max(existing.durationMs ?? 0, result.durationMs ?? 0);
    if (RANK[result.status] > RANK[existing.status]) {
      existing.status = result.status;
      existing.errorMessage = result.errorMessage; // adopt the worse result's error
    } else if (existing.errorMessage === undefined) {
      existing.errorMessage = result.errorMessage;
    }
  }
  return order.map((key) => byKey.get(key)!);
};
```

- [ ] **Step 4: Run — expect PASS**; `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(report): add collapseByScenario worst-status helper (US-055)"`

## Task 8: Apply collapse in the parser + recompute counts

**Files:** Modify `src/application/services/cucumber-json-report-parser.ts`; Test `tests/cucumber-json-report-parser.test.ts`.

- [ ] **Step 1: Write the failing test** (two browsers in one report → counts reflect distinct rows)

```ts
it("collapses multi-project results so totals count distinct scenario rows", () => {
  const el = (status: string) => ({ name: "S", type: "scenario", id: "f;s;;1", line: 5,
    steps: [{ keyword: "Given ", result: { status, duration: 1_000_000 } }] });
  const report = JSON.stringify([
    { name: "F", uri: "features/UC-1.feature", elements: [el("passed")] }, // chromium
    { name: "F", uri: "features/UC-1.feature", elements: [el("failed")] }, // firefox
  ]);
  const parsed = parser.parse(report, ctx());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.scenarioResults).toHaveLength(1);
  expect(parsed.value.result).toMatchObject({ failed: 1, passed: 0, total: 1 });
});
```

- [ ] **Step 2: Run — expect FAIL** (currently 2 results / total 2).

- [ ] **Step 3: Implement** — move counting out of `mapScenario` into `parse`, after collapse:
  1. In `mapScenario` (lines ~186-231) remove `result[status] += 1; result.total += 1;` and drop the `result` parameter (and its callers' argument).
  2. In `parse(...)`, after all features are mapped into `scenarioResults`, collapse and recount before returning:

```ts
import { collapseByScenario } from "./collapse-scenario-results";

// …after building scenarioResults & artifacts…
const collapsed = collapseByScenario(scenarioResults);
const result: TestRunResult = { passed: 0, failed: 0, skipped: 0, total: 0 };
for (const sr of collapsed) {
  result[sr.status] += 1;
  result.total += 1;
}
return ok({ result, scenarioResults: collapsed, artifacts });
```

(Adapt to the exact return shape; ensure `TestRunResult` is imported. Keep `artifacts` collection unchanged.)

- [ ] **Step 4: Run — expect PASS**; `npm test` (the existing parser/fixture tests must stay green — single-browser reports collapse to a no-op).
- [ ] **Step 5: Commit** — `git commit -am "feat(report): collapse per-browser results before counting (US-055)"`

## Task 9: CI workflow honors the matrix

**Files:** Modify `src/application/content/ci-workflow-content.ts`; Test the workflow-content test (find it: `tests/ci-workflow-content.test.ts` or the pipeline-generation test).

- [ ] **Step 1: Write the failing test**

```ts
it("CI workflow installs the selected browsers and sets TESTRUNNER_BROWSERS", () => {
  const yaml = ciWorkflowContent({ ...DEFAULT_SETTINGS, runner: { ...DEFAULT_SETTINGS.runner, browsers: ["chromium", "firefox"] } });
  expect(yaml).toContain("npx playwright install --with-deps chromium firefox");
  expect(yaml).toContain("TESTRUNNER_BROWSERS: chromium,firefox");
});
```

(Use the real exported function name — confirm via the file; it builds the YAML string from `settings`.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — in `ci-workflow-content.ts`:
  - Build `const browserList = settings.runner.browsers.join(" ");` near the `ciRunCommand`/`ciInstallCommand` derivations (~line 38-42).
  - Line ~102: change the literal `npx playwright install --with-deps chromium` to interpolate: `npx playwright install --with-deps ${browserList}`.
  - In the run-tests step `env:` block (~104-106), add a line beneath `BASE_URL: …${authEnvLines}`: `\n          TESTRUNNER_BROWSERS: ${settings.runner.browsers.join(",")}` (match the YAML indentation of `BASE_URL`).
  - Update the header doc comment (line ~17) to reflect the dynamic install.

- [ ] **Step 4: Run — expect PASS**; `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(ci): generated workflow honors the browser matrix (US-055)"`

## Task 10: Settings UI — browser checkboxes + install button

**Files:** Modify `src/presentation/settings/settings-tab.ts`; Test via the settings-tab test if one exists (else manual + typecheck).

- [ ] **Step 1: Implement** — in the runner section of `settings-tab.ts`, render three toggles bound to `settings.runner.browsers` (add/remove a `BrowserName`), preventing removal of the last one (keep non-empty). Add an "Install selected browsers" button that calls the runner-installation `installBrowsers` flow (reuse the existing install wiring used by `browserInstallCommand`). Follow the existing `Setting(containerEl).setName(...).addToggle(...)` / `.addButton(...)` patterns already in this file. Persist via the existing settings-save path.

- [ ] **Step 2: Verify** — `npm run typecheck && npm run lint`; if a settings-tab test exists, add an assertion that toggling updates `runner.browsers` and the last toggle cannot be removed. Manually load the plugin settings to confirm (note in PR).
- [ ] **Step 3: Commit** — `git commit -am "feat(settings-ui): browser matrix toggles + install button (US-055)"`

## Task 11: Docs content wording

**Files:** Modify `src/application/content/documentation-content.ts`; Test `tests/documentation-content.test.ts` if present.

- [ ] **Step 1: Implement** — at the two `browserInstallCommand` interpolations (lines ~109, ~242), update the surrounding prose so it reads as the base command with the configured browsers appended (e.g. "Install the configured browsers with `<browserInstallCommand> <browsers…>`."). Keep interpolating `runner.browserInstallCommand`, but add the browsers list where the doc describes what gets installed.
- [ ] **Step 2: Verify** — `npm test` (snapshot/content tests stay green or are updated intentionally).
- [ ] **Step 3: Commit** — `git commit -am "docs(content): describe browser-agnostic install + matrix (US-055)"`

## Task 12: Full gate + spike verification + close-out

- [ ] **Step 1:** Run the full gate:
  `npm run test:coverage && npm run typecheck && npm run lint && npm run format:check && npx fallow audit --base origin/main`
  Expected: all green; audit ✓ (no new findings — watch `runner-templates`/`test-execution-service` complexity stays inherited, not new).
- [ ] **Step 2 (S1 spike):** Locally generate a runner, select chromium+firefox, install, and run the demo; open `reports/cucumber-report.json` and confirm: (a) each scenario/outline-row element has a stable `id`/`line`, (b) outline rows are distinct, (c) the `id` is identical across the two projects (so collapse groups them). If the `id` is NOT cross-project-stable, adjust `collapseByScenario`'s key to collapse from the raw report instead (documented in the spec S1). Record the finding in the PR.
- [ ] **Step 3:** Set the spec front-matter `status: approved` → `implemented`; note the resolving PR (#52).
- [ ] **Step 4:** Commit + push; PR #52 already open. `git commit -am "chore: US-055 close-out (spec status, spike note)" && git push`

---

## Self-review notes
- **Spec coverage:** data model (T1), repair (T2), config projects (T3), generated install scripts (T3b), manifest bump (T3c), run wiring (T4), install incl. old-Vault normalization (T5), validation honors the selection (T5b), row-identity + collapse incl. outline rows (T6-T8), CI wiring (T9), UI (T10), docs (T11), spike + gate (T12). All §1-§9 + testing items covered.
- **Type consistency:** `BrowserName`/`BROWSER_NAMES` defined in `settings.ts` (T1) and reused in T2/T5; `collapseByScenario` signature matches `ScenarioResult` (T6/T7); `TESTRUNNER_BROWSERS` spelled identically in T3 (read) and T4/T9 (write).
- **Risk:** T8 changes the parser's counting locus — existing single-browser fixture tests are the guard (collapse is a no-op for one project). T5 refactors `spawnInRunner`; the existing install tests guard it.

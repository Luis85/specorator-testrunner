# Phase 3.1 Spike Findings — playwright-bdd Runner Swap

**Date:** 2026-06-13
**Gate (proposal §9, item 3.1):** _Spike findings recorded; ADR from 2.4 confirmed or amended._
**Scope chosen:** executable, cucumber-JSON-first (Cucumber Messages / ADR-0022 deferred to its own step).
**Related:** [[0021-adopt-playwright-bdd-as-execution-engine]] · [[0022-scenario-identity-and-history-store]] · proposal §9 Phase 3 (US-051/US-052) · ReportParser port (item 2.3, shipped).

## Verdict

**ADR-0021 is CONFIRMED.** The bet holds empirically: existing Gherkin runs unchanged, playwright-bdd emits a classic cucumber-JSON report that the **shipped** `CucumberJsonReportParser` ingests with **zero parser changes**, and evidence / single-run / cancel are all tractable. Two operational gotchas (not architectural changes) must be carried into the 3.2 implementation — see [Amendments for 3.2](#amendments-for-32).

## Method

A throwaway, executable spike (`/tmp/pwbdd-spike`, repo untouched) stood up a real runner and ran the **actual demo content** the plugin ships (UC-001 "Open Example Page", `@demo @smoke`, over a `file://` fixture):

- `playwright-bdd@9.0.0`, `@playwright/test@1.60.0`, Node 22, Linux, headless Chromium.
- The unmodified V1 `.feature` file; steps re-authored to playwright-bdd's `createBdd()` API.
- The generated cucumber-JSON report was then fed to the **shipped** parser
  (`src/application/services/cucumber-json-report-parser.ts`) to verify ingestion — not eyeballed.

### Independent verification (the load-bearing check)

Running the real `CucumberJsonReportParser` against the spike's generated `reports/cucumber-report.json`:

```
result rollup: { passed: 1, failed: 0, skipped: 0, total: 1 }
feature: "Open Example Page" | scenario: "Complete the local demo page" | status: passed | durationMs: 147
artifacts: 1   (the report-file reference, ADR-0016)
```

`durationMs` 147 = 40 + 88 + 19 ms summed from the report's per-step nanosecond durations — the parser's rollup arithmetic is exercised against real output. **No mapping shim was needed.**

## Findings by risk question

### Q1 — Feature compatibility: PASS (zero changes)
The V1 `.feature` ran verbatim. `@demo @smoke` tags, the `As-a / I-want / So-that` narrative, the `Scenario:` block, and `{string}` parameters all parsed unchanged. Tags surface in the generated test title (which is what makes Playwright's `--grep` tag-filtering work, Q4); the narrative lands in the report's feature `description`.

### Q2 — Report through the existing port: PASS, with one required config flag
playwright-bdd v9 ships `cucumberReporter('json', …)` — a Playwright reporter built from cucumber-js's own `json_formatter` — emitting **classic cucumber-JSON**. Field-by-field it matches the parser's contract: root array of features → `elements` (`type: "scenario"`) → `steps[].result.status` + `result.duration` (**nanoseconds**) → `error_message` on failure → `embeddings[]` with `mime_type` + base64 `data`. Verified by actually parsing it (above).

> **Required:** the json reporter defaults to **`skipAttachments: true`** ("attachments can be large and break some json parsers"), which silently drops **all** embeddings — counts/durations still look fine, but evidence is empty. The config **must** set `skipAttachments: false`. This is the single highest-risk gotcha of the migration.

### Q3 — Evidence on failure: PASS (once `skipAttachments: false`)
Forcing a step failure with `screenshot: only-on-failure` + `trace: retain-on-failure` + `skipAttachments: false`, the report's `embeddings` carried inline base64: the failure screenshot (`image/png`), the trace (`application/zip`), and an error-context (`text/markdown`). The auto-attachments attach to the hidden `After`-hook step — which IS an entry in the scenario's `steps[]`, so the parser's `collectArtifacts` reaches it. Mime mapping through the shipped `attachmentToArtifact`: `image/png → screenshot`, `application/zip → trace`, `text/markdown → ignored`. Bytes are embedded inline in the report (matches ADR-0016's "artifact path references the report file"), so reports can grow large; `skipAttachments` also accepts a media-type allowlist if traces should later be excluded.

### Q4 — Single-run + cancel: PASS, with a cancel caveat
Single-scenario selection works three ways: by name `playwright test -g "<name>"`; by tag `playwright test --grep "@smoke"` (tags are in the title); or at generation time `bddgen --tags "@smoke and not @wip"`. **Cancel caveat:** signalling only the `npx`/CLI wrapper orphans the worker + chrome-headless process tree (the scenario runs to completion). Signalling the whole **process group** (`setsid` + `kill -TERM -$PGID`) reaped everything cleanly (0 lingering processes).

### Q5 — Step authoring model (affects the plugin's step-stub generator)
playwright-bdd has **no Cucumber `World`**. Steps come from `const { Given, When, Then } = createBdd()` and receive Playwright **fixtures** by destructuring the first arg (`{ page }`, also `{ $testInfo }` for evidence attach, `{ $tags }`, `{ $step }`); cucumber-expression params (`{string}`, `{int}`) arrive as **typed trailing args**. The plugin's step-stub generator must change from `Given(text, function () { this.page })` (World/`this`) to `Given(text, async ({ page }, arg) => {})`, emit a `createBdd()` header per steps file, and ensure a `bddgen` step runs before `playwright test`.

## Amendments for 3.2

Neither is an ADR-level decision change; both are implementation constraints the 3.2 spec/plan must encode:

1. **`skipAttachments: false` is mandatory** on `cucumberReporter('json', …)` — the default drops all evidence from the report.
2. **Cancel must signal the runner's process group**, not the `npx`/CLI wrapper — spawn the runner detached (own process group), or spawn `node node_modules/playwright/cli.js test` directly, so cancel reaps the browser children (preserves at-most-one-active-run + cancel, ADR-0018).

## Reusable artifacts (validated)

`playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";
import { defineBddConfig, cucumberReporter } from "playwright-bdd";
const testDir = defineBddConfig({ features: "features/**/*.feature", steps: "steps/**/*.ts" });
export default defineConfig({
  testDir,
  reporter: [
    ["list"],
    cucumberReporter("json", {
      outputFile: "reports/cucumber-report.json",
      skipAttachments: false, // CRITICAL: default true drops all embeddings
    }),
  ],
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

`steps/example.steps.ts`:
```ts
import { expect } from "@playwright/test";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureUrl = pathToFileURL(path.resolve(here, "..", "fixtures", "example.html")).href;
Given("I open the local example page", async ({ page }) => { await page.goto(fixtureUrl); });
When("I click the {string} button", async ({ page }, label: string) => {
  if (label !== "Continue") throw new Error(`Unknown button: ${label}`);
  await page.click("#continue");
});
Then("I should see {string}", async ({ page }, expected: string) => {
  await expect(page.locator("#result")).toHaveText(expected);
});
```

`package.json` scripts: `"test": "bddgen && playwright test"` (a `bddgen` step precedes `playwright test`); devDeps `@playwright/test@^1.60`, `playwright-bdd@^9`.

## What this leaves for 3.2 / 3.3

- **3.2 (US-051/US-052):** swap the generated `.testrunner` templates from cucumber-js to playwright-bdd (config + `createBdd` step stubs + `bddgen` step), change the step-stub **generator** (Q5), wire the json reporter with `skipAttachments: false`, switch run/cancel to process-group signalling, and have **Repair** migrate a V1 `.testrunner` non-destructively (riding the manifest version from item 2.2) with a clear change report. Keep cucumber-JSON import as the fallback through the window (confirmed compatible).
- **3.3:** full unit/integration suite, `e2e-smoke` green on all OSes (Windows parity for the cancel/process-group behaviour is validated here), and the **Guided Tour end-to-end against the migrated runner** (ADR-0020).
- **Deferred (own step):** Cucumber Messages parser (ADR-0022) as a second ReportParser implementation, for the richer identity/history store.

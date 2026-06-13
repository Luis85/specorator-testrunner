# Phase 3.2 — playwright-bdd Runner Swap + Typed Steps (US-051/US-052)

**Date:** 2026-06-13
**Status:** design (approved direction; pending spec review → implementation plan)
**Implements:** US-051 (migrate the runner to playwright-bdd), US-052 (typed step definitions)
**Gate (proposal §9 item 3.2):** _Demo test green; migrated sample vault green._
**Grounded in:** [[2026-06-13-phase3-1-playwright-bdd-spike-findings]] (the executable spike that validated this), [[0021-adopt-playwright-bdd-as-execution-engine]], item 2.2 (manifest version) and item 2.3 (ReportParser port), both shipped.

---

**Goal:** Swap the generated `.testrunner` from cucumber-js to playwright-bdd, generate typed `createBdd()` step stubs, delegate missing-step detection to `bddgen`, and have Repair clean-cut a V1 runner to the new environment — all while the import pipeline keeps reading the cucumber-JSON the new runner emits.

**Architecture:** The plugin already insulates report ingestion behind the `ReportParser` port (item 2.3) and stamps a runner manifest version (item 2.2). 3.2 changes what the plugin _generates_ and _invokes_ — the runner templates, the step-stub generator, the missing-step detector, and the run/cancel mechanics — plus a Repair path that regenerates a V1 runner to V2. The cucumber-JSON _format_ and its parser are unchanged (spike-verified), so nothing downstream of the report moves.

**Tech stack:** `playwright-bdd@^9`, `@playwright/test@^1.60`, Node ≥ 20, TypeScript strict, Result-based error handling.

## 1. Scope and principles

- **Beta clean-cut, no backwards compatibility.** Consistent with the pre-announcement beta principle (Phase 2's reset-not-migrate, credential clean-cut): there is no installed base to protect. A migrated `.testrunner` is _purely_ playwright-bdd. The plugin does not preserve V1 cucumber-js runtime compatibility, run a dual runner, or lovingly port hand-written V1 step files — it regenerates the managed runtime to V2 and tells the user that custom V1 steps must be re-authored against `createBdd`.
- **JSON-first.** playwright-bdd's `cucumberReporter('json', …)` is the report path; the existing parser ingests it unchanged. Cucumber Messages (ADR-0022, the richer identity/history format) is **deferred** to its own later step.
- **One spec, US-051 + US-052 together.** The step-stub generator (US-052) must match the new runtime (US-051), so they are designed and shipped as one increment.

## 2. Runner template swap (`src/infrastructure/runner/templates/runner-templates.ts`)

The validated template set from the spike (see the findings doc for the exact `playwright.config.ts` / steps / `package.json`):

**Removed (V1 cucumber-js artifacts):**

- `cucumber.mjs` (the cucumber-js config)
- `src/support/world.ts` (the Cucumber `World` wrapping Playwright)
- `src/support/hooks.ts` (the cucumber `Before`/`After` browser + screenshot hooks)

**Added / changed:**

- `playwright.config.ts` — `defineBddConfig({ features, steps })` + `defineConfig` with:
  - `cucumberReporter("json", { outputFile: "reports/cucumber-report.json", skipAttachments: false })` — **`skipAttachments: false` is mandatory** (spike: the default silently drops all evidence embeddings).
  - `use: { screenshot: "only-on-failure", trace: "retain-on-failure" }` (evidence now configured here, replacing the cucumber `After` hook).
  - `projects: [{ name: "chromium", use: { browserName: "chromium" } }]` (ADR-0025 default matrix).
- `package.json` — deps: drop `@cucumber/cucumber`, add `playwright-bdd`; keep `@playwright/test` + `playwright`. Scripts: `test` / `test:ci` run `bddgen && playwright test` (writing `reports/cucumber-report.json`); a `bddgen` step precedes every run; `install:browsers` / `install:browsers:ci` unchanged.
- `tsconfig.json` — types for `@playwright/test` / `playwright-bdd` (drop `@cucumber/cucumber`).
- `src/support/paths.ts` — `fixtureUrl` helper is retained (still resolves the `file://` fixture).
- `src/steps/example.steps.ts` + `src/pages/ExamplePage.ts` — regenerated to playwright-bdd form: `const { Given, When, Then } = createBdd();` header, steps receive `{ page }` (and `{ $testInfo }` where evidence attach is wanted), `{string}` params as typed trailing args. The page object is a plain class taking `page` (no Cucumber import).
- `src/fixtures/example.html` — unchanged.
- `README.md` — updated to describe the playwright-bdd runtime (`bddgen && playwright test`, `playwright.config.ts`, traces).
- `testrunner-manifest.json` — **`TESTRUNNER_MANIFEST_VERSION` bumps 1 → 2** (`src/application/content/runner-manifest.ts`). This is the incompatible runtime-shape change item 2.2 was built to detect.

The fresh-install path (Initialization / new vault) simply emits these V2 templates. The migration path (§6) regenerates them over a V1 runner.

## 3. Step-stub generator (US-052) — `src/application/services/step-definition-service.ts`

`Generate step definitions` emits `createBdd()`-style typed stubs:

- One `import { createBdd } from "playwright-bdd";` + `const { Given, When, Then } = createBdd();` header per generated steps file.
- Each stub: `Given("<text>", async ({ page }, <typedParams>) => { /* TODO */ });` where `{string}` → `: string`, `{int}` → `: number`, etc. (cucumber-expression placeholders map 1:1 to typed trailing args).
- **Never overwrites hand-written steps** (append-only, preserving today's behavior). The V1 regex/World-based stub shape is removed.

## 4. Missing-step detection (US-052) — `src/application/services/specification-service.ts` (`detectMissingSteps`)

Replace the V1 regex-scraping heuristic with **`bddgen` diagnostics**:

- Run `bddgen` (child process, via the existing process port) against the feature(s); parse its missing-step output to produce the `missingSteps` result.
- This closes the regex heuristic's documented false-positive gaps (the V1 detector's known weakness).
- **Graceful degradation:** when the runner isn't installed / `bddgen` can't run, return a typed `err`/advisory ("install the runner to detect missing steps") rather than a misleading empty result. Detection now depends on the installed runner — an explicit, documented trade for accuracy.

## 5. Run + cancel — `test-execution-service`

- **Run:** invoke `bddgen` then `playwright test` (the `test` script, or the two steps in sequence). Scoped runs select scenarios via `--grep "@tag"` (tags are in the generated test title) or `-g "<name>"`; suite runs map a tag expression to `--grep` (or `bddgen --tags` at generation).
- **Cancel (spike Q4 amendment):** spawn the runner **detached, in its own process group**, and on cancel signal the **group** (`SIGTERM` to `-PGID`) — _not_ the `npx`/CLI wrapper, which orphans the worker + Chromium tree. Alternatively spawn `node node_modules/playwright/cli.js test` directly. This preserves at-most-one-active-run + clean cancel (ADR-0018).
- **Report:** still `reports/cucumber-report.json` — the import pipeline is untouched.

## 6. Migration = clean cut — `src/application/services/maintenance-service.ts` (`repair`)

A V1 runner is detected today via the manifest version (item 2.2): an absent or `< 2` manifest is a mismatch. On Repair against such a runner:

1. **Regenerate the full managed runtime to V2** — write the new `playwright.config.ts` / `package.json` / `tsconfig.json` / support / README, and **remove the V1-only files** (`cucumber.mjs`, `support/world.ts`, `support/hooks.ts`) so no stale cucumber config lingers (clean cut).
2. **Regenerate the plugin-owned demo** (`example.steps.ts`, `ExamplePage.ts`) to V2 form so the demo passes post-migration (the §9 3.2 gate). _Beta: these are plugin-owned demo content, regenerated wholesale._
3. **Bump the on-disk manifest to v2** and **force the dependency reinstall** (already wired in item 2.2: a manifest mismatch reinstalls deps — needed here because `@cucumber/cucumber` → `playwright-bdd` changes `node_modules`).
4. **Emit a clear change-report** (the existing `RepairResult` + report surface): list regenerated/removed files, the manifest bump, the reinstall, and an explicit note — _"the runner is now playwright-bdd; any custom step files written against the V1 cucumber `World` API must be re-authored as `createBdd()` steps."_ No silent deletion of user step files; they are reported, not rewritten.

`environment-validation-service`'s `VALIDATED_RUNNER_FILES` updates to the V2 set (`playwright.config.ts` replaces `cucumber.mjs`; world/hooks drop out), so validation checks the right files.

## 7. Import pipeline — unchanged

playwright-bdd emits the cucumber-JSON the shipped `CucumberJsonReportParser` already reads (spike-verified end-to-end, incl. evidence embeddings with `skipAttachments: false`). No parser, ReportParser-port, or evidence-model change. The "cucumber-JSON import fallback during the transition window" (US-052) is satisfied for free: the format is identical, so an un-migrated V1 runner's report and a V2 runner's report import the same way.

## 8. Error handling

- All new service surfaces return `Result` (no thrown errors for expected failures, ADR-0019). `bddgen`/`playwright` child-process failures map to typed `err`s surfaced in the Test Console.
- Missing-step detection degrades to a typed advisory when the runner is absent (§4).
- Migration is resilient: a failed dep reinstall or file write surfaces in the change-report without leaving a half-state un-reported.

## 9. Testing strategy

- **Unit:** new template generation (the V2 file set, manifest v2, `skipAttachments: false` present); the `createBdd` stub generator (typed params, header, append-only); `detectMissingSteps` over a faked `bddgen` output (present/missing/runner-absent); the migration path in `maintenance-service` (V1 manifest → V2 regenerate + remove cucumber files + reinstall + change-report); `environment-validation` validated-file set update. Mirrors the Phase 2 test discipline (fakes, Result assertions).
- **Demo-green gate (§9 3.2):** the generated demo runs green under playwright-bdd. The 3.1 spike already proved this locally; the repo's `e2e-smoke` workflow validates it in CI on **ubuntu + windows** (incl. the process-group cancel behavior, whose Windows parity is out of band of the Linux spike).
- **Migrated-sample-vault-green gate:** a V1 sample runner, repaired to V2, runs the demo green.
- Full blocking quality gate (coverage-fed fallow audit, thresholds 93/80/93/93) stays green; any function pulled over cognitive 15 by these edits is decomposed, never suppressed. **Do not touch `gherkin.ts`** (TD-007 suppressions stand until its own playwright-bdd-era replacement).

## 10. Risks / watch-items

- **`skipAttachments: false`** — the single highest-risk gotcha; a test must assert it is present in the generated config so a future template edit can't silently re-drop evidence.
- **Process-group cancel on Windows** — the spike validated Linux; Windows process-tree kill differs (`taskkill /T` semantics). The `e2e-smoke` Windows leg is the gate; the cancel implementation must be cross-platform.
- **Detection now needs the runner installed** — a deliberate accuracy-for-dependency trade (§4); surface it clearly in-product.
- **`bddgen` step ordering** — every run/detect must run `bddgen` before `playwright test`; a stale generated test dir would run old scenarios. The `test` script chains them; ad-hoc invocations must too.

## 11. Out of scope (this increment)

- **Cucumber Messages parser** (ADR-0022) as a second ReportParser implementation + the scenario identity/history store — its own later step.
- **3.3 validation** (full suite, e2e-smoke all-OS sign-off, the Guided Tour end-to-end against the migrated runner, README/Getting-Started/CONTEXT.md doc updates) — the next gate after 3.2.
- Multi-browser matrix beyond Chromium (ADR-0025 keeps Chromium-only default).

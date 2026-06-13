# Phase 3.2 — playwright-bdd Runner Swap + Typed Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the generated `.testrunner` from cucumber-js to playwright-bdd, emit typed `createBdd()` step stubs, delegate missing-step detection to `bddgen`, run/cancel via the process group, and have Repair clean-cut a V1 runner to the new environment — while the unchanged `CucumberJsonReportParser` keeps ingesting the report.

**Architecture:** Report ingestion is already insulated behind the `ReportParser` port (item 2.3) and the runner carries a manifest version (item 2.2). 3.2 changes what the plugin _generates_ (`runner-templates.ts`, `step-definitions.ts`), _detects_ (`specification-service.detectMissingSteps`), _invokes_ (`test-execution-service` + the `ChildProcessRunner` adapter), and _migrates_ (`maintenance-service.repair`). The cucumber-JSON format and its parser do not move (3.1 spike verified end-to-end).

**Tech Stack:** `playwright-bdd@^9`, `@playwright/test@^1.60`, Node ≥ 20, TypeScript strict, Vitest, Result-based error handling.

**Source of truth for validated runtime artifacts:** `docs/superpowers/specs/2026-06-13-phase3-1-playwright-bdd-spike-findings.md` (the executable spike). **Design:** `docs/superpowers/specs/2026-06-13-phase3-2-playwright-bdd-runner-swap-design.md`.

**Global constraints (every task):**

- **Beta clean-cut, no backwards compat** — a migrated `.testrunner` is purely playwright-bdd; do not preserve V1 cucumber runtime, dual-run, or auto-port user step files.
- **JSON-first** — Cucumber Messages / ADR-0022 is OUT of scope. `CucumberJsonReportParser`, the ReportParser port, and the import/evidence pipeline are UNCHANGED.
- **`skipAttachments: false` is mandatory** in the generated `playwright.config.ts` and MUST be test-asserted.
- **Blocking fallow gate** — run `npm run test:coverage` BEFORE `npx fallow audit --base origin/main` (coverage-fed CRAP); audit must exit 0; thresholds 93/80/93/93. If an edit pulls a function over cognitive 15, DECOMPOSE it (never suppress, never demote a rule).
- **Do NOT touch `src/application/content/gherkin.ts`** — its TD-007 complexity suppressions stand until its own later replacement.
- Result-based errors (ADR-0019): no thrown errors for expected failures.
- Tests use the existing fakes (`FakeAbsoluteFileSystem.seed`, `FakeVaultFileSystem`, the fake `ChildProcessRunner`, `silentLogger`, `recordingEventBus`).

---

## Task 1: Manifest v2 + validated-files set

**Files:**

- Modify: `src/application/content/runner-manifest.ts` (version bump + file/dependency lists)
- Test: `tests/runner-templates.test.ts`, `tests/environment-validation-service.test.ts`

The runner's runtime shape changes incompatibly, so the manifest version moves to 2 (this is exactly the signal item 2.2 built: an existing V1 vault's manifest is now `< 2` → the outdated-runner advisory fires and Repair force-reinstalls deps). The file/dependency lists validation asserts against must describe the V2 runner.

- [ ] **Step 1: Update the constant + lists**

In `runner-manifest.ts`:

- `export const TESTRUNNER_MANIFEST_VERSION = 2;` (was `1`).
- `REQUIRED_RUNNER_FILES` — replace `"cucumber.mjs"` with `"playwright.config.ts"` (keep `package.json`, `tsconfig.json`, `README.md`).
- `VALIDATED_RUNNER_FILES` — replace `"cucumber.mjs"` with `"playwright.config.ts"`; REMOVE `"src/support/world.ts"` and `"src/support/hooks.ts"`; keep `"package.json"`, `"tsconfig.json"`, `"src/support/paths.ts"`, `"src/fixtures/example.html"`.
- `REQUIRED_RUNNER_DEPENDENCIES` — replace the cucumber/tsx markers (`"node_modules/@cucumber/cucumber/bin/cucumber.js"`, `"node_modules/tsx"`) with playwright-bdd markers: `"node_modules/playwright-bdd"` and `"node_modules/@playwright/test"`. (Read how `environment-validation-service.ts` probes these markers and confirm a directory marker like `node_modules/playwright-bdd` is probed with `existsAbsolute` the same way `node_modules/tsx` is — it is.)

Update each list's doc-comment to describe the playwright-bdd runtime (and that `bddgen` + `playwright test` are the entry points, not the cucumber CLI).

- [ ] **Step 2: Update the tests for the new sets**

In `tests/runner-templates.test.ts`, the manifest test (added in item 2.2) asserts `{ manifestVersion: 1 }` — change it to `{ manifestVersion: 2 }`. In `tests/environment-validation-service.test.ts`, the fixtures (`markFullyInstalled` / `seedRunnerFiles`) seed `VALIDATED_RUNNER_FILES` and `REQUIRED_RUNNER_DEPENDENCIES` by iterating the exported lists, so they follow automatically — but grep both test files for any hard-coded `"cucumber.mjs"` / `"world.ts"` / `"hooks.ts"` / `"@cucumber/cucumber"` / `"tsx"` string and update it to the V2 equivalent. Run the two suites and fix any that referenced the old names.

- [ ] **Step 3: Gate + commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check && npm run test:coverage && npx fallow audit --base origin/main` (exit 0).

```bash
git add src/application/content/runner-manifest.ts tests/runner-templates.test.ts tests/environment-validation-service.test.ts
git commit -m "feat: bump .testrunner manifest to v2 and validate the playwright-bdd file set (pre-V2 3.2)"
```

---

## Task 2: Swap the runner templates to playwright-bdd

**Files:**

- Modify: `src/infrastructure/runner/templates/runner-templates.ts` (the whole template set + `buildRunnerTemplates`)
- Test: `tests/runner-templates.test.ts`

Replace the cucumber-js template constants with the **spike-validated** playwright-bdd set. The exact, validated bodies are in `docs/superpowers/specs/2026-06-13-phase3-1-playwright-bdd-spike-findings.md` (§ "Reusable artifacts"); adapt them to the plugin's generated layout (`src/steps/**`, `src/pages/**`, `src/support/paths.ts`, `src/fixtures/example.html`, and the configured feature-files path).

- [ ] **Step 1: Write the failing template tests**

In `tests/runner-templates.test.ts`, add (match the file's existing `buildRunnerTemplates(DEFAULT_SETTINGS)` + `files.find(f => f.path === …)` idiom):

```ts
it("generates a playwright.config.ts with the json reporter and skipAttachments:false", () => {
  const files = buildRunnerTemplates(DEFAULT_SETTINGS);
  const config = files.find((f) => f.path === "playwright.config.ts");
  expect(config).toBeDefined();
  // The single highest-risk gotcha: the json reporter's default drops all
  // evidence embeddings; the generated config MUST opt back in.
  expect(config!.content).toContain("skipAttachments: false");
  expect(config!.content).toContain('cucumberReporter("json"');
  expect(config!.content).toContain("reports/cucumber-report.json");
});

it("no longer generates the V1 cucumber-js files", () => {
  const paths = buildRunnerTemplates(DEFAULT_SETTINGS).map((f) => f.path);
  expect(paths).not.toContain("cucumber.mjs");
  expect(paths).not.toContain("src/support/world.ts");
  expect(paths).not.toContain("src/support/hooks.ts");
  expect(paths).toContain("playwright.config.ts");
});

it("package.json runs bddgen before playwright test and depends on playwright-bdd", () => {
  const pkg = buildRunnerTemplates(DEFAULT_SETTINGS).find((f) => f.path === "package.json")!;
  const parsed = JSON.parse(pkg.content) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  expect(parsed.scripts["test:ci"]).toContain("bddgen");
  expect(parsed.scripts["test:ci"]).toContain("playwright test");
  expect(parsed.devDependencies["playwright-bdd"]).toBeDefined();
  expect(parsed.devDependencies["@cucumber/cucumber"]).toBeUndefined();
});

it("the example steps file uses createBdd fixtures, not a Cucumber World", () => {
  const steps = buildRunnerTemplates(DEFAULT_SETTINGS).find((f) =>
    f.path.endsWith("example.steps.ts"),
  )!;
  expect(steps.content).toContain("createBdd");
  expect(steps.content).toContain("{ page }");
  expect(steps.content).not.toContain("@cucumber/cucumber");
  expect(steps.content).not.toContain("TestWorld");
});
```

Run: `npx vitest run tests/runner-templates.test.ts` → FAIL (old templates).

- [ ] **Step 2: Replace the template constants**

In `runner-templates.ts`:

- **Remove** the `WORLD_TS`, `HOOKS_TS`, and `cucumberMjs` constants and their `buildRunnerTemplates` entries.
- **`PACKAGE_JSON`** — scripts: `"test": "bddgen && playwright test"`, `"test:smoke": "bddgen && playwright test --grep @smoke"`, `"test:ci": "bddgen && playwright test"` (the json reporter writes `reports/cucumber-report.json` via the config — no `--format` flag), keep `install:browsers` / `install:browsers:ci`. devDependencies: drop `@cucumber/cucumber` and `tsx`; add `"@playwright/test": "^1.60.0"` and `"playwright-bdd": "^9.0.0"`; keep `playwright`, `@types/node`, `typescript`.
- **`TSCONFIG_JSON`** — keep the Bundler/Preserve shape; `types: ["node"]` is fine (Playwright types come from the package). No `tsx`-specific notes needed.
- **`playwright.config.ts`** — new `const PLAYWRIGHT_CONFIG = (featuresGlob: string) => …`, body per the spike findings doc, with `defineBddConfig({ features: <featuresGlob>, steps: "src/steps/**/*.ts" })`, `cucumberReporter("json", { outputFile: "reports/cucumber-report.json", skipAttachments: false })`, `use: { screenshot: "only-on-failure", trace: "retain-on-failure" }`, `projects: [{ name: "chromium", use: { browserName: "chromium" } }]`. Build the `features` glob exactly as `cucumberMjs` did: `${relativeVaultPath(settings.paths.testRunnerPath, settings.paths.featureFilesPath)}/**/*.feature`, emitted via `JSON.stringify` so a hostile path can't break the literal (carry over that SEC comment).
- **`EXAMPLE_STEPS_TS`** — the createBdd form (spike findings): `import { expect } from "@playwright/test";` + `import { createBdd } from "playwright-bdd";` + `const { Given, When, Then } = createBdd();`, steps taking `{ page }` and typed trailing args, using `fixtureUrl` from `../support/paths`.
- **`EXAMPLE_PAGE_TS`** — a plain class taking a Playwright `Page` (import `type { Page } from "@playwright/test"`), no Cucumber import. Keep the `open`/`continue`/`resultText` methods.
- **`PATHS_TS`** — unchanged (the `fixtureUrl` helper still resolves `src/fixtures/example.html`).
- **`EXAMPLE_HTML`** — unchanged.
- **`README_MD`** — describe the playwright-bdd runtime (`bddgen && playwright test`, `playwright.config.ts`, traces under `test-results/`); drop the "no playwright.config.ts / Cucumber World" wording.
- Update `buildRunnerTemplates`: drop the `cucumber.mjs`/`world.ts`/`hooks.ts` entries; add `{ path: unsafeVaultPath("playwright.config.ts"), content: PLAYWRIGHT_CONFIG(<glob>), overwrite: true }`; keep the manifest entry, `tsconfig.json`, `README.md`, `support/paths.ts`, `fixtures/example.html`, and the `overwrite:false` `pages/ExamplePage.ts` + `steps/example.steps.ts`.
- Update the module-level doc comment (lines 10–28): the runner is now driven by the Playwright Test runner via playwright-bdd; there IS a `playwright.config.ts`.

Run: `npx vitest run tests/runner-templates.test.ts` → PASS.

- [ ] **Step 3: Gate + commit**

Run the full gate (exit 0).

```bash
git add src/infrastructure/runner/templates/runner-templates.ts tests/runner-templates.test.ts
git commit -m "feat: generate a playwright-bdd .testrunner (config, deps, createBdd demo steps) (pre-V2 3.2)"
```

---

## Task 3: createBdd typed step-stub generator (US-052)

**Files:**

- Modify: `src/application/content/step-definitions.ts` (the stub renderer + import header)
- Test: `tests/step-definitions.test.ts`

The generator and its append/dedupe logic stay; only the emitted stub SHAPE changes from Cucumber `Given(text, function (this: TestWorld) {})` to playwright-bdd `Given(text, async ({ page }, arg: string) => {})`, and the import header from `@cucumber/cucumber` + the World to `createBdd()`. `parseStepDefinitions` (the `Given|When|Then(...)` scraper) and `findMissingSteps` are UNCHANGED — they still recognise createBdd step calls, so the generator's non-destructive re-diff keeps working.

- [ ] **Step 1: Update the stub tests**

In `tests/step-definitions.test.ts`, update the stub-shape assertions (and add where missing):

```ts
it("renders a createBdd stub with page fixture and typed params", () => {
  const file = buildStepDefinitionStubFile(['I click the "Continue" button']);
  expect(file).toContain('import { createBdd } from "playwright-bdd";');
  expect(file).toContain("const { Given, When, Then } = createBdd();");
  // quoted literal → a {string} param surfaced as a typed arrow arg
  expect(file).toContain('Given("I click the {string} button", async ({ page }, arg1: string) =>');
  expect(file).not.toContain("@cucumber/cucumber");
  expect(file).not.toContain("TestWorld");
  expect(file).not.toContain("this:");
});

it("appends only the missing createBdd header to a file that already has it", () => {
  const existing =
    'import { createBdd } from "playwright-bdd";\nconst { Given, When, Then } = createBdd();\n\nGiven("x", async ({ page }) => {});\n';
  const block = buildAppendedStubs(existing, ["I do a new thing"]);
  expect(block).not.toContain('import { createBdd }'); // already present — not duplicated
  expect(block).toContain('Given("I do a new thing", async ({ page }) =>');
});
```

Run: FAIL.

- [ ] **Step 2: Update the renderer + header**

In `step-definitions.ts`:

- Replace `STEP_DEFINITION_IMPORT_BINDINGS` / `STEP_DEFINITION_IMPORTS`. The header is now an import line PLUS a destructure line:
  ```ts
  const CREATE_BDD_IMPORT = `import { createBdd } from "playwright-bdd";`;
  const CREATE_BDD_DESTRUCTURE = `const { Given, When, Then } = createBdd();`;
  export const STEP_DEFINITION_IMPORTS = `${CREATE_BDD_IMPORT}\n${CREATE_BDD_DESTRUCTURE}`;
  ```
- `renderStub`: change the signature + body to the arrow/fixture form. `{string}` params become typed `argN: string`:
  ```ts
  const renderStub = (stepText: string): string => {
    const { expression, params } = toStubExpression(stepText);
    const args = params.map((p) => `${p}: string`).join(", ");
    const signature = args ? `{ page }, ${args}` : `{ page }`;
    return [
      `// ${PENDING_MARKER}: implement this step (generated stub for: ${squash(stepText)})`,
      `Given("${escapeDoubleQuoted(expression)}", async (${signature}) => {`,
      `  throw new Error("Pending");`,
      `});`,
    ].join("\n");
  };
  ```
  (Keep `Given` uniform: playwright-bdd, like cucumber-js, matches a step by TEXT regardless of the Given/When/Then decorator, so a `Given`-declared stub still satisfies a When/Then step. Keep this note in the `buildStepDefinitionStubFile` doc comment, updated for playwright-bdd.)
- `buildAppendedStubs`: the dedupe must treat the createBdd header as present when the file already imports `createBdd` AND destructures `Given`. Replace `namedImportLocals`-based logic with a check: append the header only when `existingSource` does not already contain a `createBdd` import. Concretely:
  ```ts
  export const buildAppendedStubs = (existingSource: string, missingSteps: string[]): string => {
    const hasHeader = /from\s*["']playwright-bdd["']/.test(existingSource);
    const blocks = buildStepDefinitionStubBlocks(missingSteps);
    return hasHeader ? `${blocks}\n` : `${STEP_DEFINITION_IMPORTS}\n\n${blocks}\n`;
  };
  ```
  (Remove `STEP_DEFINITION_IMPORT_BINDINGS` and `namedImportLocals` if now unused — run lint to confirm; the alias-import edge case they guarded no longer applies because the bindings come from a `createBdd()` destructure, not named imports.)

Run: `npx vitest run tests/step-definitions.test.ts` → PASS. Also run `tests/step-definition-service.test.ts` (the service wraps this) and fix any fixture asserting the old `this: TestWorld` shape.

- [ ] **Step 3: Gate + commit**

Full gate (exit 0). If removing `namedImportLocals` leaves a now-trivial function flagged, that's fine; if any remaining function trips cognitive 15, decompose.

```bash
git add src/application/content/step-definitions.ts tests/step-definitions.test.ts tests/step-definition-service.test.ts
git commit -m "feat: generate createBdd typed step stubs with Playwright fixtures (pre-V2 3.2, US-052)"
```

---

## Task 4: Missing-step detection via bddgen (US-052)

**Files:**

- Modify: `src/application/services/specification-service.ts` (`detectMissingSteps` + constructor)
- Modify: `src/main.ts` (inject the process runner where `DefaultSpecificationService` is constructed)
- Test: `tests/specification-service.test.ts`, `tests/use-case-service.test.ts` / any construction site

`detectMissingSteps` currently scrapes step files and runs the regex heuristic (`findMissingSteps(collectStepTexts(feature), definitions)`). US-052 delegates to `bddgen`, which reports unimplemented steps with concrete snippets, closing the heuristic's false-positive gaps. This adds a `ChildProcessRunner` dependency and means detection now requires the runner installed.

**Design + anchors (read the surrounding code; match its idioms):**

- Inject `ChildProcessRunner` (port at `src/application/ports/child-process-runner.ts`, `run(request) → Result<{ exitCode, stdout, stderr, durationMs }>`) as a new constructor dependency of `DefaultSpecificationService`. Read how `test-execution-service` builds a `RunCommandRequest` (argv array, `cwd` = the runner abs path, `processId` optional) and mirror it — but resolve `cwd` to the runner folder (it needs the absolute runner path; see how the env-validation/maintenance services resolve `settings.paths.testRunnerPath` against the vault base). If the service has no vault-base resolver, route through the same port the runner execution uses.
- `detectMissingSteps(featurePath)`:
  1. Still `parseFeature` (validate the file is a Feature; keep the existing `VALIDATION_FAILED` err).
  2. Run `bddgen` against the runner (argv: the bddgen CLI; check the spike's `package.json` — `bddgen` is on `node_modules/.bin/bddgen`; spawn via `node node_modules/playwright-bdd/dist/cli.js` or the `.bin` shim, matching how `test-execution-service` invokes the runner CLI without a shell). bddgen prints missing-step snippets to stdout/stderr when steps are undefined.
  3. Parse the missing-step texts from bddgen's output (it emits `Missing step definitions: N` followed by snippet blocks containing the step text). Extract the step texts; restrict to the steps of THIS `featurePath` (bddgen scans all features — filter to the requested feature's step texts via `collectStepTexts(feature)` intersection, so the result stays per-feature as the contract requires).
  4. **Graceful degradation:** if the runner isn't installed / `bddgen` can't run (non-zero exit with a "command not found"/missing-config signature, or the runner folder is absent), return a typed `err` (`appError("RUNNER_NOT_INSTALLED", "Install the runner to detect missing steps.")`) rather than a misleading empty result. The command callers already surface `Result` errors as Notices.
  5. Keep publishing `specification.missingSteps.detected` with the resolved `missingSteps` (unchanged event shape + `detectionEventId` return) on success.

**Tests** (`tests/specification-service.test.ts`, using the fake `ChildProcessRunner`):

- bddgen reports two missing steps for the feature → `detectMissingSteps` returns them (filtered to the feature) and publishes the event.
- bddgen reports none → empty `missingSteps`, event still published.
- runner not installed / bddgen errors → typed `err` (not an empty success).
- The fake `ChildProcessRunner` returns canned stdout matching real bddgen output (capture a sample from the spike dir `/tmp/pwbdd-spike` if still present, else synthesize the documented format) so the parser is exercised against realistic text.

Update `main.ts` and every `DefaultSpecificationService` construction site (grep for `new DefaultSpecificationService(`) to pass the process runner.

- [ ] Write the failing tests → implement → pass → full gate (exit 0; decompose any function over cognitive 15 — the bddgen-output parser is the likely candidate, keep it a small focused helper).

```bash
git commit -m "feat: detect missing steps via bddgen diagnostics instead of the regex heuristic (pre-V2 3.2, US-052)"
```

---

## Task 5: Run + process-group cancel

**Files:**

- Modify: the infrastructure `ChildProcessRunner` adapter (find it: `src/infrastructure/**/*process*`, the `ProcessAdapter`) — spawn detached + group-kill
- Modify: `src/application/services/test-execution-service.ts` (the command it builds, if the script name/args changed)
- Test: the adapter's test + `tests/test-execution-service.test.ts`

The runner is invoked as an `npm run <script>` whose script now chains `bddgen && playwright test`. The spike (Q4) showed that signalling only the wrapper orphans the worker + Chromium tree; cancel must signal the whole **process group**.

**Design + anchors:**

- **Adapter (the real change):** read the current `ProcessAdapter` spawn + `cancel`. Spawn the tracked runner child **detached** (`spawn(..., { detached: true })`, own process group) and on `cancel(processId)` signal the **group**: POSIX `process.kill(-pid, "SIGTERM")`; Windows `taskkill /pid <pid> /T /F` (the `/T` kills the tree — Node can't signal a POSIX-style group on Windows). Gate on `process.platform`. Keep the existing `processId → child` registry and the "untracked when no processId" behaviour. Only the run-execution path (which passes `processId`) needs detaching; `npm install` / browser install stay as-is.
- **test-execution-service:** confirm the command it spawns still resolves to the runner's `npm run test:ci` (or whichever script) — the script body changed in Task 2 but the script NAME is unchanged, so the service likely needs no change beyond any assertion on the old cucumber command string. Grep its tests for `cucumber` / `--format json` and update to the new script if asserted. The scoped-run profile selection (`--profile scoped` for CLI feature paths) is a cucumber concept — for playwright-bdd, scoped runs select scenarios via `--grep`/`-g` instead; update the scoped-run argument construction accordingly (read the `SCOPED_PROFILE_ARG` / scoped-paths logic and replace the cucumber-profile mechanism with playwright `--grep`/feature-path args that playwright-bdd accepts).
- **Report:** still `reports/cucumber-report.json` — import pipeline untouched.

**Tests:**

- Adapter: a cancel after a detached spawn signals the group (assert the fake/seam records a group-signal, e.g. negative pid / `taskkill /T` per platform). Mirror the adapter test's existing spawn/kill seam.
- `test-execution-service`: a scoped run builds `--grep`/feature-path args (not `--profile scoped`); cancel(runId) reaches the adapter cancel with the runId. Keep the at-most-one-run + terminal-event guards (ADR-0018) green.

- [ ] Write failing tests → implement → pass → full gate (exit 0; the cross-platform branch must be covered both ways — fake `process.platform`).

```bash
git commit -m "feat: run bddgen+playwright and cancel via the process group (pre-V2 3.2)"
```

---

## Task 6: V1→V2 clean-cut migration in Repair

**Files:**

- Modify: `src/application/services/maintenance-service.ts` (`repair()`)
- Test: `tests/maintenance-service.test.ts`

Item 2.2 already made `repair()` force a dep reinstall on a manifest mismatch. 3.2 adds the clean-cut: regenerate the managed runtime to V2 (already happens via `createRunner` writing the new templates), DELETE the V1-only files that `createRunner` no longer writes (so no stale cucumber config lingers), and extend the change-report.

**Design + anchors:**

- In `repair()`, after `createRunner` (which writes the V2 managed files incl. the new `playwright.config.ts` and regenerates the demo — note the demo `example.steps.ts`/`ExamplePage.ts` are `overwrite:false`, so confirm whether `createRunner` rewrites them; per the beta clean-cut, the migration MUST bring the demo to V2. If `overwrite:false` preserves the V1 demo steps, the migration explicitly overwrites the plugin-owned demo files to their V2 content so the demo passes post-migration — see the design spec §6 step 2. Read `createRunner`/`TemplateWriter` to see how overwrite is honoured and add an explicit demo-regenerate for the migration path only.)
- **Delete V1-only files:** when the pre-repair manifest was `< 2`/absent (reuse the `manifestMismatch` signal already computed for the reinstall in item 2.2 — but here key specifically on "was a V1 runner"), delete `cucumber.mjs`, `src/support/world.ts`, `src/support/hooks.ts` from the runner via the vault FS (the service holds an optional `VaultFileSystem this.fs`; confirm it exposes a delete and use it; if `this.fs` is undefined in a construction path, guard the deletion). Record the deletions in the change-report.
- **Change-report:** extend `RepairResult` (or the notice the command surfaces) with a migration note when a V1→V2 migration occurred: the runner is now playwright-bdd; custom V1 step files written against the Cucumber `World` no longer run and must be re-authored as `createBdd` steps. Do NOT delete user step files — report only.

**Tests** (`tests/maintenance-service.test.ts`, real `DefaultEnvironmentValidationService` over fakes as today):

- A V1 runner (manifest absent or `{ manifestVersion: 1 }`, plus seeded `cucumber.mjs`/`world.ts`/`hooks.ts`) → `repair()` deletes those three files (assert via the fake FS), regenerates the demo to V2, reinstalls deps (already covered by the 2.2 test — keep green), and the result carries the migration note.
- A healthy V2 runner (manifest `{ manifestVersion: 2 }`) → no deletions, no migration note, no forced reinstall.

- [ ] Write failing tests → implement → pass → full gate (exit 0; if `repair()` trips cognitive 15 with the added branch, extract a `migrateV1Runner()` private helper).

```bash
git commit -m "feat: Repair clean-cuts a V1 .testrunner to playwright-bdd with a change report (pre-V2 3.2, US-051)"
```

---

## Task 7: CHANGELOG + scope note

**Files:**

- Modify: `CHANGELOG.md`

- [ ] Under `## [Unreleased]` → `### Changed`, add:

```markdown
- The generated `.testrunner` now runs Gherkin through **playwright-bdd**
  (`bddgen` + `@playwright/test`) instead of cucumber-js: native traces,
  fixtures, and `createBdd()` typed step stubs. The report stays cucumber-JSON,
  so the import/evidence pipeline is unchanged. `Repair installation`
  clean-cuts a V1 runner to the new environment (regenerates managed files,
  removes the V1 cucumber config, reinstalls deps) and reports that custom V1
  steps must be re-authored as `createBdd` steps (ADR-0021, US-051/US-052).
```

(README disclosure / Getting-Started / CONTEXT.md term updates are **3.3** scope — do not do them here.)

- [ ] `npm run format:check`; commit:

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the playwright-bdd runner swap (pre-V2 3.2)"
```

---

## Task 8: Full gate, push, PR (controller)

- [ ] **Full PR gate locally:** `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npx fallow audit --base origin/main` — all green; coverage ≥ 93/80/93/93; audit exit 0.
- [ ] **Push** the existing branch (it already carries the 3.1 spike-findings and 3.2 spec/plan commits):

```bash
git push -u origin claude/specorator-v2-phase3-spike
```

- [ ] **Open a ready-for-review PR** against `main`. Title: `Phase 3.2: playwright-bdd runner swap + typed steps (US-051/US-052)`. Body: one bullet per task (manifest v2; template swap; createBdd stubs; bddgen detection; process-group run/cancel; V1 clean-cut migration), the spike-findings + design-spec links, the beta clean-cut note (no backwards compat; Cucumber Messages/ADR-0022 deferred), and the gate note (the auto-triggered `e2e-smoke` on ubuntu + windows must be green — it exercises the demo under the new runner and the Windows process-group cancel parity the Linux spike couldn't).
- [ ] **Watch CI:** the blocking `quality` job, the build matrix, and `e2e-smoke` (ubuntu + windows) must all go green.

---

## Phase 3.2 exit criteria (proposal §9)

- [ ] `bddgen` + `playwright test` replaces the cucumber-js invocation; existing `.feature` files run unchanged (US-051)
- [ ] Cucumber-JSON still emitted and imported with no parser change (3.1 spike verified)
- [ ] `Generate step definitions` emits `createBdd()` typed stubs; missing-step detection delegates to `bddgen` (US-052)
- [ ] `Repair installation` clean-cuts a V1 runner to V2 with a change report
- [ ] Demo test green; migrated sample vault green; blocking quality gate + `e2e-smoke` green on the PR

**Deferred:** Cucumber Messages parser (ADR-0022) + scenario identity/history store — its own later step. **Next gate:** 3.3 validation (full suite, all-OS e2e-smoke sign-off, Guided Tour end-to-end against the migrated runner, README/Getting-Started/CONTEXT.md updates).

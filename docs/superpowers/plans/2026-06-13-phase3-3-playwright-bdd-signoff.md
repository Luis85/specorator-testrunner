# Phase 3.3 — playwright-bdd Migration Sign-off Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Execute task-by-task; run the blocking fallow gate (coverage → `fallow audit --base origin/main`, exit 0) before each commit; run `scripts/e2e-smoke.mjs` locally before pushing.

**Goal:** Sign off the playwright-bdd migration — an executable Guided-Tour `@tour` e2e leg, user-facing docs refreshed to the playwright-bdd runtime, full gate green.

**Architecture:** No runtime change. Export the real tour snippets so the e2e smoke runs the actual `@tour` cycle; rewrite stale cucumber-js doc references; record the sign-off.

**Tech Stack:** TypeScript, Vitest, esbuild-bundled `e2e-smoke.mjs`, playwright-bdd runner.

**Spec:** `docs/superpowers/specs/2026-06-13-phase3-3-playwright-bdd-signoff-design.md`

---

### Task 1: Export the real tour snippets (with a binding guard test)

**Files:**
- Modify: `src/domain/onboarding/tour-steps.ts` (export `TOUR_GHERKIN_SNIPPET`, `TOUR_STEPS_SNIPPET`)
- Modify: `scripts/e2e-smoke-entry.ts` (re-export both)
- Test: `tests/tour-steps.test.ts` (premise guard)

- [ ] **Step 1: Failing test** — assert the exported `@tour` snippets are consistent: `TOUR_GHERKIN_SNIPPET` contains `@tour` and the three greeting step texts, and `TOUR_STEPS_SNIPPET` binds `When`/`Then` via `createBdd()` and references `#name`/`#greet`/`#greeting`. (This pins the e2e leg's premise without a real spawn.)

```ts
import { TOUR_GHERKIN_SNIPPET, TOUR_STEPS_SNIPPET } from "../src/domain/onboarding/tour-steps";

describe("exported @tour artifacts (e2e premise)", () => {
  it("the gherkin carries @tour and the greeting steps", () => {
    expect(TOUR_GHERKIN_SNIPPET).toContain("@tour");
    expect(TOUR_GHERKIN_SNIPPET).toContain("I enter \"Ada\" into the name field");
    expect(TOUR_GHERKIN_SNIPPET).toContain("the greeting should say \"Hello, Ada!\"");
  });
  it("the steps snippet binds When/Then via createBdd and drives the fixture", () => {
    expect(TOUR_STEPS_SNIPPET).toContain("createBdd()");
    expect(TOUR_STEPS_SNIPPET).toMatch(/#name|#greet|#greeting/);
  });
});
```

- [ ] **Step 2: Run it** — fails to import (snippets not exported).
- [ ] **Step 3: Implement** — add `export` to both `const TOUR_GHERKIN_SNIPPET`/`const TOUR_STEPS_SNIPPET` in `tour-steps.ts`; add `export { TOUR_GHERKIN_SNIPPET, TOUR_STEPS_SNIPPET } from "../src/domain/onboarding/tour-steps";` to `e2e-smoke-entry.ts`.
- [ ] **Step 4: Run** — green.
- [ ] **Step 5: Gate + commit** — coverage → `fallow audit` exit 0 → commit.

### Task 2: Add the `@tour` e2e leg to `scripts/e2e-smoke.mjs`

**Files:**
- Modify: `scripts/e2e-smoke.mjs` (new leg after the demo `@smoke` leg)

- [ ] **Step 1: Import the snippets** — destructure `TOUR_GHERKIN_SNIPPET`, `TOUR_STEPS_SNIPPET` from the bundled entry alongside the existing `DEMO_*`/`DEFAULT_SETTINGS`/`buildRunnerTemplates`.
- [ ] **Step 2: Author + implement** — after the demo `@smoke` leg, write `TOUR_GHERKIN_SNIPPET` to `<featuresDir>/tour-greet.feature`, and `TOUR_STEPS_SNIPPET` to `<runnerRoot>/src/steps/tour.steps.ts` (alongside the generated `example.steps.ts` that supplies the reused `Given`).
- [ ] **Step 3: Run the `@tour` suite** — `execSync("npm run test 2>&1", { cwd: runnerRoot, env: { ...process.env, BDD_TAGS: "@tour" } })`; on failure, `fail()` with captured output.
- [ ] **Step 4: Assert** — parse `reports/cucumber-report.json`: exactly 1 scenario, every step `passed`; log `E2E smoke @tour run PASSED`.
- [ ] **Step 5: Verify** — `node --check scripts/e2e-smoke.mjs`; run the full `e2e-smoke` locally if the environment allows network install (else rely on CI ubuntu+windows).
- [ ] **Step 6: Commit.**

### Task 3: Refresh user-facing docs (README, CONTEXT.md, PRD)

**Files:**
- Modify: `README.md`, `CONTEXT.md`, `docs/Specorator Testrunner.md`

- [ ] **Step 1: README.md** — architecture-diagram `Cucumber` label → playwright-bdd; "runs Playwright + Cucumber-JS" → "runs Playwright with playwright-bdd (`bddgen` + `@playwright/test`)"; download list "(Playwright, Cucumber-JS, …)" → "(Playwright, playwright-bdd, @playwright/test, …)".
- [ ] **Step 2: CONTEXT.md** (glossary, keep implementation-light) — `.testrunner` runtime line; drop the "Cucumber" qualifier from `Background`, Tag Expression, `@wip`, Scenario Reference (they are Gherkin/BDD-standard); _Guided Tour_ "step definitions" → "`createBdd()` steps".
- [ ] **Step 3: docs/Specorator Testrunner.md** — Technology Stack line; Developer persona row; diagram `Cucumber` label; FR-005 tag-expression wording; AC-008 stub wording.
- [ ] **Step 4: Grep guard** — `grep -rni "cucumber-js\|@cucumber/cucumber\|cucumber\.mjs" README.md CONTEXT.md "docs/Specorator Testrunner.md"` returns nothing (any surviving "Cucumber" is an intentional Gherkin-history mention only).
- [ ] **Step 5: Commit.**

### Task 4: Sign-off (proposal, changelog, full gate)

**Files:**
- Modify: `docs/proposals/2026-06-11 V2 Research and Proposal.md` (§9 item 3.3 → delivered)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Proposal** — mark §9 item 3.3 delivered (migration complete), consistent with how 3.1/3.2 were marked.
- [ ] **Step 2: CHANGELOG** — `[Unreleased]` entry: playwright-bdd migration complete — Guided-Tour `@tour` e2e sign-off + docs refreshed.
- [ ] **Step 3: Full gate** — lint · format · typecheck · build · `test:coverage` (≥ 93/80/93/93) · `fallow audit --base origin/main` exit 0.
- [ ] **Step 4: Commit, push, open PR** — ready-for-review PR to `main`.

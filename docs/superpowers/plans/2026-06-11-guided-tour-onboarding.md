# Guided Tour Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive, event-observed Guided Tour (persistent sidebar checklist) that walks the user through the full V1 loop — ending with a self-authored, passing greeting test.

**Architecture:** A pure step table in `src/domain/onboarding/` defines 10 steps with event-predicate completion rules; an application `GuidedTourService` subscribes to the EventBus, persists progress into a new `onboarding` settings section, and publishes `tour.*` domain events; a presentation `GuidedTourView` (ItemView, right sidebar) renders pure row projections. The fixture page gains a greeting form so the user authors genuinely new steps. Spec: `docs/superpowers/specs/2026-06-11-guided-tour-onboarding-design.md`.

**Tech Stack:** TypeScript (strict), Obsidian plugin API, Vitest, existing in-process EventBus, esbuild.

**Conventions that apply to every task:**

- All commands run from the repo root `/home/user/specorator-testrunner` on branch `claude/interactive-plugin-onboarding-phq47j`.
- `npm run typecheck` must pass after every task; `npm test` after every task with tests.
- ESLint enforces layer boundaries: `domain` may import only `domain`/`shared`; `application` may not import `presentation`/`infrastructure`; `presentation` may import `application`/`domain`/`shared`.
- Existing test helpers live in `tests/fakes.ts` (`FakeDataStore`, `silentLogger`, `recordingEventBus`) and `tests/__stubs__/obsidian.ts`.

---

### Task 1: Tour domain event types

**Files:**
- Modify: `src/domain/events/domain-event.ts`

The four `tour.*` events are compile-time contracts (the `EventPayloads` map type-checks every publisher); no runtime test exists for the other event types either, so this task is verified by typecheck.

- [ ] **Step 1: Add the event types**

In `src/domain/events/domain-event.ts`, extend the `DomainEventType` union — after the `// settings` group's last member `| "settings.reset";`, change it to:

```ts
  | "settings.reset"
  // guided tour
  | "tour.started"
  | "tour.step.completed"
  | "tour.step.skipped"
  | "tour.completed";
```

- [ ] **Step 2: Add the payload contracts**

In the same file, at the end of the `EventPayloads` interface (after the `// settings (§13)` block's `"settings.validated"` entry), add:

```ts
  // guided tour (Event Catalog "Tour Events")
  "tour.started": { tourId: string };
  "tour.step.completed": { tourId: string; stepId: string; via: "event" | "manual" };
  "tour.step.skipped": { tourId: string; stepId: string };
  "tour.completed": { tourId: string };
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/domain/events/domain-event.ts
git commit -m "feat(domain): tour.* domain event types and payload contracts"
```

---

### Task 2: `onboarding` settings section

**Files:**
- Modify: `src/domain/settings/settings.ts`
- Modify: `src/application/services/settings-service.ts`
- Test: `tests/settings-service.test.ts`

Tour progress persists in `data.json` via the existing `SettingsService`, so a UC-024 reset clears it for free. The settings service repairs the section structurally on load (tampered/synced `data.json` must never crash startup — same posture as `repairSutShape`). Semantic filtering of unknown step ids happens later in `GuidedTourService` (Task 4), which owns the step table.

- [ ] **Step 1: Write the failing tests**

Append to `tests/settings-service.test.ts` (reuse the file's existing imports/builder if one exists; otherwise these are self-contained):

```ts
import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { FakeDataStore, recordingEventBus, silentLogger } from "./fakes";

describe("onboarding settings", () => {
  const makeService = (raw: unknown) =>
    new DefaultSettingsService(
      new FakeDataStore(raw),
      new DefaultPathSafetyPolicy(),
      recordingEventBus().bus,
      silentLogger,
    );

  it("defaults the onboarding section when data.json predates the tour", async () => {
    const settings = await makeService(undefined).load();
    expect(settings.onboarding).toEqual({
      tourId: null,
      completedSteps: [],
      skippedSteps: [],
      dismissed: false,
    });
  });

  it("keeps a valid persisted onboarding section", async () => {
    const settings = await makeService({
      onboarding: {
        tourId: "abc",
        completedSteps: ["create-use-case"],
        skippedSteps: ["run-demo"],
        dismissed: true,
      },
    }).load();
    expect(settings.onboarding.tourId).toBe("abc");
    expect(settings.onboarding.completedSteps).toEqual(["create-use-case"]);
    expect(settings.onboarding.skippedSteps).toEqual(["run-demo"]);
    expect(settings.onboarding.dismissed).toBe(true);
  });

  it("repairs a malformed onboarding section to the defaults", async () => {
    const settings = await makeService({
      onboarding: { tourId: 42, completedSteps: "nope", skippedSteps: [7, "x"], dismissed: "yes" },
    }).load();
    expect(settings.onboarding.tourId).toBeNull();
    expect(settings.onboarding.completedSteps).toEqual([]);
    // Non-string entries are dropped; string entries survive structurally.
    expect(settings.onboarding.skippedSteps).toEqual(["x"]);
    expect(settings.onboarding.dismissed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/settings-service.test.ts`
Expected: FAIL — `settings.onboarding` is undefined (type error first: run `npm run typecheck` to see the missing property).

- [ ] **Step 3: Add the domain type and default**

In `src/domain/settings/settings.ts`, after the `LoggingSettings` interface add:

```ts
/**
 * Guided Tour progress (spec 2026-06-11). Persisted with the settings so a
 * UC-024 reset clears it together with everything else. Step ids are stored as
 * plain strings here; the GuidedTourService (which owns the step table)
 * ignores ids it does not know.
 */
export interface OnboardingSettings {
  /** Correlation id of the current tour traversal; null until the tour starts. */
  tourId: string | null;
  completedSteps: string[];
  skippedSteps: string[];
  /** Hides the dashboard CTA only; the Open Guided Tour command always reopens. */
  dismissed: boolean;
}
```

Add to `TestHubSettings`:

```ts
  onboarding: OnboardingSettings;
```

Add to `DEFAULT_SETTINGS` (after the `logging` section):

```ts
  onboarding: {
    tourId: null,
    completedSteps: [],
    skippedSteps: [],
    dismissed: false,
  },
```

- [ ] **Step 4: Merge + repair in the settings service**

In `src/application/services/settings-service.ts`:

1. Import the type: add `OnboardingSettings` to the existing import from `"../../domain/settings/settings"` (it is a type import).
2. Extend `mergeWithDefaults` with one more section:

```ts
    onboarding: { ...DEFAULT_SETTINGS.onboarding, ...data.onboarding },
```

3. Add a pure repair function next to `repairSutShape`'s helpers (module level, below `diffSettings` is fine):

```ts
/**
 * Structural repair for the persisted `onboarding` section (same log-free,
 * never-break-startup posture as the other load screens — this section is
 * self-healing state, not user configuration, so silent fallback is fine):
 * non-string tourId → null; non-array step lists → []; non-string entries
 * dropped; non-boolean dismissed → false. Pure: no I/O.
 */
const repairOnboardingShape = (raw: OnboardingSettings): OnboardingSettings => ({
  tourId: typeof raw.tourId === "string" ? raw.tourId : null,
  completedSteps: stringArray(raw.completedSteps),
  skippedSteps: stringArray(raw.skippedSteps),
  dismissed: raw.dismissed === true,
});

/** Keeps only the string entries of a possibly-tampered array value. */
const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
```

4. Apply it in `load()` — change the body to:

```ts
  async load(): Promise<TestHubSettings> {
    const settings = this.sanitizeRunnerEnvInputs(
      this.sanitizePaths(mergeWithDefaults(await this.store.load())),
    );
    return { ...settings, onboarding: repairOnboardingShape(settings.onboarding) };
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/settings-service.test.ts && npm run typecheck`
Expected: PASS. If other suites construct full `TestHubSettings` literals they will now fail typecheck — fix each by spreading `DEFAULT_SETTINGS` (e.g. `{ ...DEFAULT_SETTINGS, ... }`) or adding `onboarding: { tourId: null, completedSteps: [], skippedSteps: [], dismissed: false }`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (the `diffSettings` section loop picks up `onboarding` generically; no other behavior change).

- [ ] **Step 7: Commit**

```bash
git add src/domain/settings/settings.ts src/application/services/settings-service.ts tests/
git commit -m "feat(settings): persisted onboarding section with load-time structural repair"
```

---

### Task 3: Tour step table (pure domain)

**Files:**
- Create: `src/domain/onboarding/tour-steps.ts`
- Test: `tests/tour-steps.test.ts`

The step table is **pure data + pure predicates**: no I/O, no service references. Predicates treat payloads as `unknown` and must not match malformed shapes. Init-generated artifacts (UC-001, the demo feature, the smoke/regression suites) are excluded via a `TourEventContext` the composition root fills from existing constants.

- [ ] **Step 1: Write the failing tests**

Create `tests/tour-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isTourStepId,
  TOUR_STEPS,
  tourObservedEventTypes,
  type TourEventContext,
  type TourStepId,
} from "../src/domain/onboarding/tour-steps";

const ctx: TourEventContext = {
  demoUseCaseId: "UC-001",
  demoFeatureFileName: "UC-001-open-example-page.feature",
  defaultSuiteIds: ["smoke", "regression"],
};

const step = (id: TourStepId) => {
  const found = TOUR_STEPS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing step ${id}`);
  return found;
};

const eventRule = (id: TourStepId) => {
  const completion = step(id).completion;
  if (completion.kind !== "event") throw new Error(`${id} is not an event step`);
  return completion.rule;
};

const sequenceRules = (id: TourStepId) => {
  const completion = step(id).completion;
  if (completion.kind !== "event-sequence") throw new Error(`${id} is not a sequence step`);
  return completion.rules;
};

describe("TOUR_STEPS table", () => {
  it("defines the ten steps in spec order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "run-demo",
      "create-use-case",
      "generate-feature",
      "author-gherkin",
      "detect-missing-steps",
      "implement-steps",
      "create-suite",
      "run-own-test",
      "review-evidence",
      "generate-ci",
    ]);
  });

  it("marks exactly the spec's skippable steps", () => {
    const skippable = TOUR_STEPS.filter((s) => s.skippable).map((s) => s.id);
    expect(skippable).toEqual([
      "run-demo",
      "detect-missing-steps",
      "implement-steps",
      "review-evidence",
      "generate-ci",
    ]);
  });

  it("collects every observed event type exactly once", () => {
    const types = tourObservedEventTypes();
    expect(new Set(types).size).toBe(types.length);
    expect(types).toContain("usecase.created");
    expect(types).toContain("evidence.generated"); // armedBy counts too
  });

  it("recognizes step ids", () => {
    expect(isTourStepId("create-suite")).toBe(true);
    expect(isTourStepId("not-a-step")).toBe(false);
    expect(isTourStepId(7)).toBe(false);
  });
});

describe("completion predicates", () => {
  it("run-demo matches only a passed run", () => {
    const rule = eventRule("run-demo");
    expect(rule.matches({ status: "passed" }, ctx)).toBe(true);
    expect(rule.matches({ status: "failed" }, ctx)).toBe(false);
    expect(rule.matches(null, ctx)).toBe(false);
  });

  it("create-use-case excludes the shipped demo Use Case", () => {
    const rule = eventRule("create-use-case");
    expect(rule.matches({ useCaseId: "UC-002" }, ctx)).toBe(true);
    expect(rule.matches({ useCaseId: "UC-001" }, ctx)).toBe(false);
    expect(rule.matches({}, ctx)).toBe(false);
  });

  it("author-gherkin requires a valid, non-demo feature", () => {
    const rule = eventRule("author-gherkin");
    expect(
      rule.matches({ featurePath: "Specifications/features/UC-002-greet.feature", valid: true }, ctx),
    ).toBe(true);
    expect(
      rule.matches(
        { featurePath: "Specifications/features/UC-001-open-example-page.feature", valid: true },
        ctx,
      ),
    ).toBe(false);
    expect(
      rule.matches({ featurePath: "Specifications/features/UC-002-greet.feature", valid: false }, ctx),
    ).toBe(false);
  });

  it("detect-missing-steps wants at least one missing step", () => {
    const rule = eventRule("detect-missing-steps");
    expect(rule.matches({ missingSteps: ["When I submit the greeting"] }, ctx)).toBe(true);
    expect(rule.matches({ missingSteps: [] }, ctx)).toBe(false);
  });

  it("implement-steps sequence: generated, then zero missing on the same feature", () => {
    const [generated, zero] = sequenceRules("implement-steps");
    expect(generated.matches({ featurePath: "f.feature", stepFile: "s.ts" }, ctx)).toBe(true);
    expect(generated.capture?.({ featurePath: "f.feature" })).toBe("f.feature");
    expect(zero.matches({ featurePath: "f.feature", missingSteps: [] }, ctx, "f.feature")).toBe(true);
    expect(zero.matches({ featurePath: "other.feature", missingSteps: [] }, ctx, "f.feature")).toBe(
      false,
    );
    expect(zero.matches({ featurePath: "f.feature", missingSteps: ["x"] }, ctx, "f.feature")).toBe(
      false,
    );
  });

  it("create-suite excludes the default suites", () => {
    const rule = eventRule("create-suite");
    expect(rule.matches({ suiteId: "tour" }, ctx)).toBe(true);
    expect(rule.matches({ suiteId: "smoke" }, ctx)).toBe(false);
    expect(rule.matches({ suiteId: "regression" }, ctx)).toBe(false);
  });

  it("run-own-test sequence: non-default suite executed, then that run passes", () => {
    const [executed, passed] = sequenceRules("run-own-test");
    expect(executed.matches({ suiteId: "tour", runId: "RUN-1" }, ctx)).toBe(true);
    expect(executed.matches({ suiteId: "smoke", runId: "RUN-1" }, ctx)).toBe(false);
    expect(executed.capture?.({ suiteId: "tour", runId: "RUN-1" })).toBe("RUN-1");
    expect(passed.matches({ runId: "RUN-1", status: "passed" }, ctx, "RUN-1")).toBe(true);
    expect(passed.matches({ runId: "RUN-2", status: "passed" }, ctx, "RUN-1")).toBe(false);
    expect(passed.matches({ runId: "RUN-1", status: "failed" }, ctx, "RUN-1")).toBe(false);
  });

  it("run-own-test requires create-suite", () => {
    expect(step("run-own-test").requiresCompleted).toEqual(["create-suite"]);
  });

  it("review-evidence is manual and armed by evidence.generated", () => {
    expect(step("review-evidence").completion.kind).toBe("manual");
    const armed = step("review-evidence").armedBy;
    expect(armed?.type).toBe("evidence.generated");
    expect(armed?.matches({ evidencePath: "Test Evidence/x.md" }, ctx)).toBe(true);
  });

  it("generate-ci matches any generated pipeline", () => {
    expect(eventRule("generate-ci").matches({ provider: "github-actions", path: "x" }, ctx)).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tour-steps.test.ts`
Expected: FAIL — module `src/domain/onboarding/tour-steps` not found.

- [ ] **Step 3: Create the step table**

Create `src/domain/onboarding/tour-steps.ts`:

```ts
import type { DomainEventType } from "../events/domain-event";

/**
 * The Guided Tour's step model (spec 2026-06-11): a pure, ordered table of ten
 * steps covering the full V1 loop. Completion is observed from domain events
 * (or, for steps without an event, marked done manually); predicates are pure
 * and must exclude the artifacts initialization itself ships.
 */

/** Ordered ids of the Guided Tour's steps. */
export type TourStepId =
  | "run-demo"
  | "create-use-case"
  | "generate-feature"
  | "author-gherkin"
  | "detect-missing-steps"
  | "implement-steps"
  | "create-suite"
  | "run-own-test"
  | "review-evidence"
  | "generate-ci";

/** Known init-shipped artifacts the predicates exclude (wired in main.ts). */
export interface TourEventContext {
  demoUseCaseId: string; // DEMO_USE_CASE_ID ("UC-001")
  demoFeatureFileName: string; // DEMO_FEATURE_FILE_NAME
  defaultSuiteIds: readonly string[]; // DEFAULT_SUITES ids ("smoke", "regression")
}

/**
 * One observable condition. `matches` is pure and defensive: payloads arrive
 * as `unknown` at subscription time and a malformed shape simply doesn't match.
 * `captured` carries the previous sequence rule's {@link TourEventRule.capture}
 * value (e.g. a runId) so a sequence can correlate its events.
 */
export interface TourEventRule {
  type: DomainEventType;
  matches(payload: unknown, ctx: TourEventContext, captured?: string): boolean;
  /** Value remembered for the NEXT rule of an event-sequence. */
  capture?(payload: unknown): string | undefined;
}

export type TourCompletion =
  | { kind: "event"; rule: TourEventRule }
  /** Each rule must match once, in order (steps 6 and 8). */
  | { kind: "event-sequence"; rules: readonly TourEventRule[] }
  | { kind: "manual" };

/** Ids the view maps to deps callbacks — the tour never re-implements actions. */
export type TourActionId =
  | "run-demo"
  | "open-create-use-case"
  | "open-use-cases"
  | "open-create-suite"
  | "open-suites"
  | "open-latest-evidence"
  | "generate-ci";

export interface TourSnippet {
  title: string;
  language: "gherkin" | "typescript";
  code: string;
}

export interface TourStepDefinition {
  id: TourStepId;
  title: string;
  /** One short paragraph: why this step matters. */
  teach: string;
  action?: { id: TourActionId; label: string };
  snippets?: readonly TourSnippet[];
  completion: TourCompletion;
  skippable: boolean;
  /** Steps that must be DONE before this one's completion may trigger. */
  requiresCompleted?: readonly TourStepId[];
  /** Extra hint rendered while the step is active. */
  hint?: string;
  /** Manual steps: an observed event that "arms" the step (UI hint only). */
  armedBy?: TourEventRule;
}

/** Narrows an unknown payload to a plain record, or null. */
const record = (payload: unknown): Record<string, unknown> | null =>
  typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;

/**
 * The scenario the user authors in step 4. The three greeting steps are NEW —
 * they deliberately do not collide with the shipped `example.steps.ts`
 * patterns (that file is user-owned, `overwrite: false`, and duplicate
 * Cucumber patterns would be ambiguous); only the Given is reused.
 */
export const TOUR_GHERKIN_SNIPPET = `@tour
Feature: Greet the visitor
  Scenario: Greeting shows the entered name
    Given I open the local example page
    When I enter "Ada" into the name field
    And I submit the greeting
    Then the greeting should say "Hello, Ada!"
`;

/** The implementation the user pastes into the generated step scaffold (step 6). */
export const TOUR_STEPS_SNIPPET = `import { Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { TestWorld } from "../support/world";

When("I enter {string} into the name field", async function (this: TestWorld, name: string) {
  if (!this.page) throw new Error("Page not initialized");
  await this.page.fill("#name", name);
});

When("I submit the greeting", async function (this: TestWorld) {
  if (!this.page) throw new Error("Page not initialized");
  await this.page.click("#greet");
});

Then("the greeting should say {string}", async function (this: TestWorld, expected: string) {
  if (!this.page) throw new Error("Page not initialized");
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await this.page.textContent("#greeting")) === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await this.page.textContent("#greeting"), expected);
});
`;

export const TOUR_STEPS: readonly TourStepDefinition[] = [
  {
    id: "run-demo",
    title: "See green first",
    teach:
      "The Initialization Wizard shipped a working demo test (UC-001) that drives a local " +
      "HTML page. Run it once to confirm the runner, browser, and report pipeline work " +
      "before you build your own.",
    action: { id: "run-demo", label: "Run demo test" },
    completion: {
      kind: "event",
      rule: {
        type: "testrun.completed",
        matches: (payload) => record(payload)?.status === "passed",
      },
    },
    skippable: true,
  },
  {
    id: "create-use-case",
    title: "Create your own Use Case",
    teach:
      "A Use Case is a business-facing capability your application must support — the anchor " +
      'every Feature Specification links back to. Create one called "Greet the visitor".',
    action: { id: "open-create-use-case", label: "New Use Case" },
    completion: {
      kind: "event",
      rule: {
        type: "usecase.created",
        matches: (payload, ctx) => {
          const p = record(payload);
          return typeof p?.useCaseId === "string" && p.useCaseId !== ctx.demoUseCaseId;
        },
      },
    },
    skippable: false,
  },
  {
    id: "generate-feature",
    title: "Generate a Feature Specification",
    teach:
      "Each Use Case owns its executable Gherkin Features. Open your Use Case and use " +
      "Generate Feature — the scaffold is written into the features folder and linked back " +
      "automatically.",
    action: { id: "open-use-cases", label: "Open Use Cases" },
    completion: {
      kind: "event",
      rule: {
        type: "specification.linkedToUseCase",
        matches: (payload, ctx) => {
          const p = record(payload);
          return typeof p?.useCaseId === "string" && p.useCaseId !== ctx.demoUseCaseId;
        },
      },
    },
    skippable: false,
  },
  {
    id: "author-gherkin",
    title: "Author the Gherkin",
    teach:
      "Replace the generated scaffold with the scenario below — the demo fixture page has a " +
      "greeting form for exactly this. The @tour tag will power your Test Suite later. " +
      "Then run Validate on the Feature.",
    action: { id: "open-use-cases", label: "Open Use Cases" },
    snippets: [{ title: "Your scenario", language: "gherkin", code: TOUR_GHERKIN_SNIPPET }],
    completion: {
      kind: "event",
      rule: {
        type: "specification.validation.completed",
        matches: (payload, ctx) => {
          const p = record(payload);
          return (
            p?.valid === true &&
            typeof p.featurePath === "string" &&
            !p.featurePath.endsWith(ctx.demoFeatureFileName)
          );
        },
      },
    },
    skippable: false,
  },
  {
    id: "detect-missing-steps",
    title: "Detect missing steps",
    teach:
      "Gherkin lines only run when a step definition implements them. Detect Missing Steps " +
      "compares your Feature against the runner's steps — your three greeting steps are new, " +
      "so it should find them.",
    action: { id: "open-use-cases", label: "Open Use Cases" },
    completion: {
      kind: "event",
      rule: {
        type: "specification.missingSteps.detected",
        matches: (payload) => {
          const p = record(payload);
          return Array.isArray(p?.missingSteps) && p.missingSteps.length > 0;
        },
      },
    },
    skippable: true,
  },
  {
    id: "implement-steps",
    title: "Generate and implement the step definitions",
    teach:
      "Generate Step Definitions writes a TypeScript scaffold for the missing steps into the " +
      "runner's src/steps/ folder. Open that file, replace the stubs with the implementation " +
      "below, then run Detect Missing Steps again — zero missing completes this step.",
    action: { id: "open-use-cases", label: "Open Use Cases" },
    snippets: [
      { title: "Step implementation", language: "typescript", code: TOUR_STEPS_SNIPPET },
    ],
    completion: {
      kind: "event-sequence",
      rules: [
        {
          type: "stepdefinition.generated",
          matches: (payload) => typeof record(payload)?.featurePath === "string",
          capture: (payload) => {
            const value = record(payload)?.featurePath;
            return typeof value === "string" ? value : undefined;
          },
        },
        {
          type: "specification.missingSteps.detected",
          matches: (payload, _ctx, captured) => {
            const p = record(payload);
            return (
              Array.isArray(p?.missingSteps) &&
              p.missingSteps.length === 0 &&
              (captured === undefined || p.featurePath === captured)
            );
          },
        },
      ],
    },
    skippable: true,
    hint:
      "Skipping this leaves your scenario without step implementations — its run will fail " +
      "until the steps exist.",
  },
  {
    id: "create-suite",
    title: "Create a Test Suite",
    teach:
      "Suites select scenarios by Cucumber tag expression, never by explicit list. Create a " +
      'suite named "Tour" with the tag expression @tour — it matches exactly the scenario ' +
      "you authored.",
    action: { id: "open-create-suite", label: "New Test Suite" },
    completion: {
      kind: "event",
      rule: {
        type: "suite.created",
        matches: (payload, ctx) => {
          const p = record(payload);
          return typeof p?.suiteId === "string" && !ctx.defaultSuiteIds.includes(p.suiteId);
        },
      },
    },
    skippable: false,
  },
  {
    id: "run-own-test",
    title: "Run your own test",
    teach:
      "Run the Tour suite and watch the output stream into the Test Console. This is the " +
      "same runner CI uses — green here means green anywhere.",
    action: { id: "open-suites", label: "Open Test Suites" },
    completion: {
      kind: "event-sequence",
      rules: [
        {
          type: "suite.executed",
          matches: (payload, ctx) => {
            const p = record(payload);
            return typeof p?.suiteId === "string" && !ctx.defaultSuiteIds.includes(p.suiteId);
          },
          capture: (payload) => {
            const value = record(payload)?.runId;
            return typeof value === "string" ? value : undefined;
          },
        },
        {
          type: "testrun.completed",
          matches: (payload, _ctx, captured) => {
            const p = record(payload);
            return p?.status === "passed" && (captured === undefined || p.runId === captured);
          },
        },
      ],
    },
    skippable: false,
    requiresCompleted: ["create-suite"],
    hint: "If the run fails with undefined steps, finish the step-definition step above first.",
  },
  {
    id: "review-evidence",
    title: "Review the Evidence",
    teach:
      "Every finished run writes an Evidence note under the evidence folder — the audit " +
      "trail linking results, reports, and screenshots. Open the note for your run, then " +
      "mark this step done.",
    action: { id: "open-latest-evidence", label: "Open latest evidence" },
    completion: { kind: "manual" },
    skippable: true,
    armedBy: {
      type: "evidence.generated",
      matches: (payload) => typeof record(payload)?.evidencePath === "string",
    },
  },
  {
    id: "generate-ci",
    title: "Ship it to CI (optional)",
    teach:
      "The runner project executes without Obsidian. Generate the GitHub Actions workflow so " +
      "every push runs your suite — then Check CI Readiness reports anything still missing.",
    action: { id: "generate-ci", label: "Generate CI workflow" },
    completion: {
      kind: "event",
      rule: { type: "ci.pipeline.generated", matches: () => true },
    },
    skippable: true,
  },
];

/** Every event type any rule (incl. armedBy) observes — the service's subscription set. */
export const tourObservedEventTypes = (): DomainEventType[] => {
  const types = new Set<DomainEventType>();
  for (const step of TOUR_STEPS) {
    if (step.completion.kind === "event") types.add(step.completion.rule.type);
    if (step.completion.kind === "event-sequence") {
      for (const rule of step.completion.rules) types.add(rule.type);
    }
    if (step.armedBy) types.add(step.armedBy.type);
  }
  return [...types];
};

/** True when `value` names a known tour step (drops stale persisted ids). */
export const isTourStepId = (value: unknown): value is TourStepId =>
  typeof value === "string" && TOUR_STEPS.some((step) => step.id === value);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tour-steps.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/onboarding/ tests/tour-steps.test.ts
git commit -m "feat(domain): Guided Tour step table with event-predicate completion rules"
```

---

### Task 4: `GuidedTourService`

**Files:**
- Create: `src/application/services/guided-tour-service.ts`
- Test: `tests/guided-tour-service.test.ts`

The service subscribes to the bus (composition root calls `start()` once, so progress is tracked whether or not the view is open), evaluates the step table, keeps **authoritative in-memory state**, persists best-effort through the SettingsHost (`getSettings`/`updateSettings` — preserving main.ts's optimistic in-memory swap), and publishes `tour.*` events with `correlationId = tourId`. Event handling is serialized (same chain pattern as `DefaultSettingsService.serialize`) so two near-simultaneous completions can't interleave their read-modify-write of settings.

- [ ] **Step 1: Write the failing tests**

Create `tests/guided-tour-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DefaultGuidedTourService } from "../src/application/services/guided-tour-service";
import type { TourEventContext } from "../src/domain/onboarding/tour-steps";
import { DEFAULT_SETTINGS, type TestHubSettings } from "../src/domain/settings/settings";
import { createEvent } from "../src/shared/event-bus/create-event";
import { err, ok } from "../src/shared/result/result";
import { recordingEventBus, silentLogger } from "./fakes";

const ctx: TourEventContext = {
  demoUseCaseId: "UC-001",
  demoFeatureFileName: "UC-001-open-example-page.feature",
  defaultSuiteIds: ["smoke", "regression"],
};

const makeAccess = (failSaves = false) => {
  let settings: TestHubSettings = structuredClone(DEFAULT_SETTINGS);
  return {
    access: {
      getSettings: () => settings,
      updateSettings: async (next: TestHubSettings) => {
        if (failSaves) return err({ code: "SETTINGS_INVALID" as const, message: "boom" });
        settings = next;
        return ok(undefined);
      },
    },
    current: () => settings,
  };
};

const harness = (failSaves = false) => {
  const { bus, events } = recordingEventBus();
  const { access, current } = makeAccess(failSaves);
  const service = new DefaultGuidedTourService(access, bus, silentLogger, ctx);
  service.start();
  return { bus, events, service, current };
};

const status = (service: DefaultGuidedTourService, id: string) =>
  service.getState().steps.find((step) => step.definition.id === id)?.status;

describe("DefaultGuidedTourService", () => {
  it("completes create-use-case on a non-demo usecase.created and persists", async () => {
    const { bus, events, service, current } = harness();
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    expect(status(service, "create-use-case")).toBe("done");
    expect(current().onboarding.completedSteps).toContain("create-use-case");
    const started = events.find((event) => event.type === "tour.started");
    const completed = events.find((event) => event.type === "tour.step.completed");
    expect(started).toBeDefined();
    expect(completed?.correlationId).toBe(current().onboarding.tourId);
    expect((completed?.payload as { via: string }).via).toBe("event");
  });

  it("ignores the shipped demo artifacts", async () => {
    const { bus, service } = harness();
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-001", title: "Demo", path: "d.md" }),
    );
    await bus.publish(
      createEvent("suite.created", {
        suiteId: "smoke",
        name: "Smoke Suite",
        path: "s.md",
        tagExpression: "@smoke",
      }),
    );
    expect(status(service, "create-use-case")).toBe("active");
    expect(status(service, "create-suite")).toBe("pending");
  });

  it("completes implement-steps only after generated THEN zero-missing", async () => {
    const { bus, service } = harness();
    await bus.publish(
      createEvent("specification.missingSteps.detected", {
        featurePath: "f.feature",
        missingSteps: [],
      }),
    );
    expect(status(service, "implement-steps")).not.toBe("done");
    await bus.publish(
      createEvent("stepdefinition.generated", {
        featurePath: "f.feature",
        stepFile: "s.ts",
        generatedSteps: ["a"],
      }),
    );
    await bus.publish(
      createEvent("specification.missingSteps.detected", {
        featurePath: "f.feature",
        missingSteps: [],
      }),
    );
    expect(status(service, "implement-steps")).toBe("done");
  });

  it("gates run-own-test on create-suite being done", async () => {
    const { bus, service } = harness();
    const runOwnSuite = async () => {
      await bus.publish(createEvent("suite.executed", { suiteId: "tour", runId: "RUN-9" }));
      await bus.publish(
        createEvent("testrun.completed", {
          runId: "RUN-9",
          status: "passed",
          durationMs: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
        }),
      );
    };
    await runOwnSuite();
    expect(status(service, "run-own-test")).not.toBe("done");

    await bus.publish(
      createEvent("suite.created", {
        suiteId: "tour",
        name: "Tour",
        path: "t.md",
        tagExpression: "@tour",
      }),
    );
    await runOwnSuite();
    expect(status(service, "run-own-test")).toBe("done");
  });

  it("arms review-evidence on evidence.generated and completes via markDone", async () => {
    const { bus, events, service } = harness();
    expect(service.getState().steps.find((s) => s.definition.id === "review-evidence")?.armed).toBe(
      false,
    );
    await bus.publish(
      createEvent("evidence.generated", {
        runId: "RUN-1",
        evidencePath: "Test Evidence/x.md",
        linkedUseCases: [],
      }),
    );
    expect(service.getState().steps.find((s) => s.definition.id === "review-evidence")?.armed).toBe(
      true,
    );
    const done = await service.markDone("review-evidence");
    expect(done.ok).toBe(true);
    expect(status(service, "review-evidence")).toBe("done");
    const completed = events.filter((event) => event.type === "tour.step.completed");
    expect((completed.at(-1)?.payload as { via: string }).via).toBe("manual");
  });

  it("rejects markDone on an event-completed step and skip on a non-skippable step", async () => {
    const { service } = harness();
    expect((await service.markDone("create-use-case")).ok).toBe(false);
    expect((await service.skip("create-suite")).ok).toBe(false);
  });

  it("skips a skippable step, persists, and publishes tour.step.skipped", async () => {
    const { events, service, current } = harness();
    const skipped = await service.skip("run-demo");
    expect(skipped.ok).toBe(true);
    expect(status(service, "run-demo")).toBe("skipped");
    expect(current().onboarding.skippedSteps).toContain("run-demo");
    expect(events.some((event) => event.type === "tour.step.skipped")).toBe(true);
  });

  it("publishes tour.completed once every step is done or skipped", async () => {
    const { bus, events, service } = harness();
    // Skip the skippable steps, complete the rest through their events.
    for (const id of ["run-demo", "detect-missing-steps", "implement-steps", "review-evidence", "generate-ci"] as const) {
      await service.skip(id);
    }
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    await bus.publish(
      createEvent("specification.linkedToUseCase", {
        useCaseId: "UC-002",
        featurePath: "f.feature",
      }),
    );
    await bus.publish(
      createEvent("specification.validation.completed", {
        featurePath: "f.feature",
        valid: true,
        errors: [],
      }),
    );
    await bus.publish(
      createEvent("suite.created", {
        suiteId: "tour",
        name: "Tour",
        path: "t.md",
        tagExpression: "@tour",
      }),
    );
    await bus.publish(createEvent("suite.executed", { suiteId: "tour", runId: "RUN-1" }));
    await bus.publish(
      createEvent("testrun.completed", {
        runId: "RUN-1",
        status: "passed",
        durationMs: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
      }),
    );
    expect(service.getState().completed).toBe(true);
    expect(events.filter((event) => event.type === "tour.completed")).toHaveLength(1);
  });

  it("keeps progress in memory when persistence fails", async () => {
    const { bus, service, current } = harness(true);
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    expect(status(service, "create-use-case")).toBe("done");
    expect(current().onboarding.completedSteps).toEqual([]);
  });

  it("restart clears progress and mints a new tourId", async () => {
    const { bus, service, current } = harness();
    await bus.publish(
      createEvent("usecase.created", { useCaseId: "UC-002", title: "Greet", path: "x.md" }),
    );
    const firstTourId = current().onboarding.tourId;
    const restarted = await service.restart();
    expect(restarted.ok).toBe(true);
    expect(status(service, "create-use-case")).toBe("active");
    expect(current().onboarding.completedSteps).toEqual([]);
    expect(current().onboarding.tourId).not.toBe(firstTourId);
  });

  it("dismiss persists and is reflected in state", async () => {
    const { service, current } = harness();
    await service.dismiss();
    expect(service.getState().dismissed).toBe(true);
    expect(current().onboarding.dismissed).toBe(true);
  });

  it("initializes from persisted progress, dropping unknown step ids", () => {
    const { bus } = recordingEventBus();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.onboarding.completedSteps = ["create-use-case", "no-such-step"];
    const service = new DefaultGuidedTourService(
      { getSettings: () => settings, updateSettings: async () => ok(undefined) },
      bus,
      silentLogger,
      ctx,
    );
    expect(status(service, "create-use-case")).toBe("done");
    expect(service.getState().steps).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/guided-tour-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/application/services/guided-tour-service.ts`:

```ts
import {
  isTourStepId,
  TOUR_STEPS,
  tourObservedEventTypes,
  type TourEventContext,
  type TourEventRule,
  type TourStepDefinition,
  type TourStepId,
} from "../../domain/onboarding/tour-steps";
import type { DomainEvent } from "../../domain/events/domain-event";
import type { TestHubSettings } from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import { createEvent, newId } from "../../shared/event-bus/create-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

export type TourStepStatus = "pending" | "active" | "done" | "skipped";

export interface TourStepState {
  definition: TourStepDefinition;
  status: TourStepStatus;
  /** Manual steps: whether the armedBy event was observed this session. */
  armed: boolean;
}

export interface TourState {
  steps: TourStepState[];
  /** True when every step is done or skipped. */
  completed: boolean;
  dismissed: boolean;
}

/**
 * Settings access wired in main.ts to the SettingsHost, so tour persistence
 * goes through the same optimistic in-memory swap + save path as every other
 * settings write (a direct SettingsService.save would leave the plugin's
 * in-memory copy stale).
 */
export interface TourSettingsAccess {
  getSettings(): TestHubSettings;
  updateSettings(next: TestHubSettings): Promise<Result<void>>;
}

/** Guided Tour contract (spec 2026-06-11). */
export interface GuidedTourService {
  getState(): TourState;
  /** Completes a `manual` step (e.g. review-evidence). */
  markDone(stepId: TourStepId): Promise<Result<void>>;
  /** Skips a skippable step. */
  skip(stepId: TourStepId): Promise<Result<void>>;
  /** Clears all progress and mints a new tourId. */
  restart(): Promise<Result<void>>;
  /** Hides the dashboard CTA; the command still reopens the view. */
  dismiss(): Promise<Result<void>>;
  /** Subscribes to the bus. Call once from the composition root. */
  start(): void;
  /** Unsubscribes (onunload). */
  stop(): void;
}

export class DefaultGuidedTourService implements GuidedTourService {
  private readonly subscriptions: Unsubscribe[] = [];
  // Authoritative in-memory state, seeded from the persisted settings at
  // construction. Persistence is best-effort: a failed save degrades to
  // session-only progress (spec: error handling) and the next successful save
  // re-persists the full state.
  private readonly completed = new Set<TourStepId>();
  private readonly skipped = new Set<TourStepId>();
  private tourId: string | null = null;
  private dismissed = false;
  // Transient (per-session) sequence/arming state. Losing it on reload only
  // means re-triggering the cheap observable action (e.g. re-run detection).
  private readonly sequenceIndex = new Map<TourStepId, number>();
  private readonly capturedValue = new Map<TourStepId, string | undefined>();
  private readonly armed = new Set<TourStepId>();
  private tourCompletedPublished = false;
  // Serializes event handling + persistence (same pattern as
  // DefaultSettingsService.serialize) so two near-simultaneous completions
  // can't interleave their read-modify-write of the settings object.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: TourSettingsAccess,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly ctx: TourEventContext,
  ) {
    this.seedFromSettings();
  }

  start(): void {
    if (this.subscriptions.length > 0) return; // idempotent
    for (const type of tourObservedEventTypes()) {
      this.subscriptions.push(
        this.eventBus.subscribe(type, (event) => this.enqueue(() => this.handleEvent(event))),
      );
    }
    // A UC-024 reset restores default settings underneath us — resync so the
    // tour visibly starts over (its persisted progress was just cleared).
    this.subscriptions.push(
      this.eventBus.subscribe("settings.reset", () =>
        this.enqueue(async () => this.resetInMemory()),
      ),
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  getState(): TourState {
    let activeAssigned = false;
    const steps = TOUR_STEPS.map((definition) => {
      let status: TourStepStatus;
      if (this.completed.has(definition.id)) status = "done";
      else if (this.skipped.has(definition.id)) status = "skipped";
      else if (!activeAssigned) {
        status = "active";
        activeAssigned = true;
      } else status = "pending";
      return { definition, status, armed: this.armed.has(definition.id) };
    });
    return { steps, completed: this.allSettled(), dismissed: this.dismissed };
  }

  markDone(stepId: TourStepId): Promise<Result<void>> {
    return this.enqueue(async () => {
      const definition = TOUR_STEPS.find((step) => step.id === stepId);
      if (!definition || definition.completion.kind !== "manual") {
        return err(
          appError("VALIDATION_FAILED", `Step "${stepId}" cannot be marked done manually.`),
        );
      }
      if (this.isSettled(stepId)) return ok(undefined);
      await this.completeStep(definition, "manual");
      return ok(undefined);
    });
  }

  skip(stepId: TourStepId): Promise<Result<void>> {
    return this.enqueue(async () => {
      const definition = TOUR_STEPS.find((step) => step.id === stepId);
      if (!definition || !definition.skippable) {
        return err(appError("VALIDATION_FAILED", `Step "${stepId}" cannot be skipped.`));
      }
      if (this.isSettled(stepId)) return ok(undefined);
      this.skipped.add(stepId);
      const tourId = await this.ensureTourStarted();
      await this.persist();
      await this.eventBus.publish(
        createEvent("tour.step.skipped", { tourId, stepId }, { correlationId: tourId }),
      );
      await this.publishCompletedIfSettled();
      return ok(undefined);
    });
  }

  restart(): Promise<Result<void>> {
    return this.enqueue(async () => {
      this.resetInMemory();
      this.tourId = newId();
      await this.persist();
      await this.eventBus.publish(
        createEvent("tour.started", { tourId: this.tourId }, { correlationId: this.tourId }),
      );
      return ok(undefined);
    });
  }

  dismiss(): Promise<Result<void>> {
    return this.enqueue(async () => {
      this.dismissed = true;
      await this.persist();
      return ok(undefined);
    });
  }

  // --- internals -----------------------------------------------------------

  private seedFromSettings(): void {
    const { onboarding } = this.settings.getSettings();
    this.tourId = onboarding.tourId;
    this.dismissed = onboarding.dismissed;
    // Unknown ids (stale data.json from a newer/older plugin) are dropped here;
    // the settings service already guaranteed these are string arrays.
    for (const id of onboarding.completedSteps) if (isTourStepId(id)) this.completed.add(id);
    for (const id of onboarding.skippedSteps) if (isTourStepId(id)) this.skipped.add(id);
    this.tourCompletedPublished = this.allSettled();
  }

  private resetInMemory(): void {
    this.completed.clear();
    this.skipped.clear();
    this.sequenceIndex.clear();
    this.capturedValue.clear();
    this.armed.clear();
    this.tourId = null;
    this.dismissed = false;
    this.tourCompletedPublished = false;
  }

  private isSettled(stepId: TourStepId): boolean {
    return this.completed.has(stepId) || this.skipped.has(stepId);
  }

  private allSettled(): boolean {
    return TOUR_STEPS.every((step) => this.isSettled(step.id));
  }

  private requirementsMet(definition: TourStepDefinition): boolean {
    return (definition.requiresCompleted ?? []).every((id) => this.completed.has(id));
  }

  private async handleEvent(event: DomainEvent): Promise<void> {
    for (const definition of TOUR_STEPS) {
      if (definition.armedBy?.type === event.type && !this.isSettled(definition.id)) {
        if (definition.armedBy.matches(event.payload, this.ctx)) this.armed.add(definition.id);
      }
      if (this.isSettled(definition.id)) continue;
      if (!this.requirementsMet(definition)) continue;

      const { completion } = definition;
      if (completion.kind === "event" && completion.rule.type === event.type) {
        if (completion.rule.matches(event.payload, this.ctx)) {
          await this.completeStep(definition, "event", event);
        }
      } else if (completion.kind === "event-sequence") {
        const index = this.sequenceIndex.get(definition.id) ?? 0;
        const rule: TourEventRule | undefined = completion.rules[index];
        if (rule?.type !== event.type) continue;
        if (!rule.matches(event.payload, this.ctx, this.capturedValue.get(definition.id))) continue;
        if (rule.capture) this.capturedValue.set(definition.id, rule.capture(event.payload));
        if (index + 1 >= completion.rules.length) {
          await this.completeStep(definition, "event", event);
        } else {
          this.sequenceIndex.set(definition.id, index + 1);
        }
      }
    }
  }

  private async completeStep(
    definition: TourStepDefinition,
    via: "event" | "manual",
    cause?: DomainEvent,
  ): Promise<void> {
    this.completed.add(definition.id);
    this.sequenceIndex.delete(definition.id);
    const tourId = await this.ensureTourStarted(cause);
    await this.persist();
    await this.eventBus.publish(
      createEvent(
        "tour.step.completed",
        { tourId, stepId: definition.id, via },
        { correlationId: tourId, causationId: cause?.id },
      ),
    );
    await this.publishCompletedIfSettled();
  }

  /** Mints + announces the tourId on first activity (spec: lazy tour.started). */
  private async ensureTourStarted(cause?: DomainEvent): Promise<string> {
    if (this.tourId !== null) return this.tourId;
    this.tourId = newId();
    await this.eventBus.publish(
      createEvent(
        "tour.started",
        { tourId: this.tourId },
        { correlationId: this.tourId, causationId: cause?.id },
      ),
    );
    return this.tourId;
  }

  private async publishCompletedIfSettled(): Promise<void> {
    if (!this.allSettled() || this.tourCompletedPublished || this.tourId === null) return;
    this.tourCompletedPublished = true;
    await this.eventBus.publish(
      createEvent("tour.completed", { tourId: this.tourId }, { correlationId: this.tourId }),
    );
  }

  /**
   * Best-effort persistence through the SettingsHost. A failed save keeps the
   * in-memory progress for this session (a Notice-level concern for the next
   * save, not a tour blocker) — logged, never thrown.
   */
  private async persist(): Promise<void> {
    const current = this.settings.getSettings();
    const next: TestHubSettings = {
      ...current,
      onboarding: {
        tourId: this.tourId,
        completedSteps: [...this.completed],
        skippedSteps: [...this.skipped],
        dismissed: this.dismissed,
      },
    };
    const saved = await this.settings.updateSettings(next);
    if (!saved.ok) {
      this.logger.warn("Could not persist Guided Tour progress; keeping it in memory.", {
        reason: saved.error.message,
      });
    }
  }

  /** Queues `task` behind every previously queued one (handlers + commands). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.catch((error) =>
      this.logger.error("Guided Tour task failed", error as Error),
    );
    return run;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/guided-tour-service.test.ts && npm run typecheck`
Expected: PASS. Note: `recordingEventBus`'s `InMemoryEventBus` awaits handlers during `publish`, and the handler returns the `enqueue` promise, so the assertions after `await bus.publish(...)` see settled state. If a test still races, check that the handler closure returns (not just calls) `this.enqueue(...)`.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

```bash
git add src/application/services/guided-tour-service.ts tests/guided-tour-service.test.ts
git commit -m "feat(application): event-observed GuidedTourService with tour.* events and persisted progress"
```

---

### Task 5: Fixture greeting form

**Files:**
- Modify: `src/infrastructure/runner/templates/runner-templates.ts`
- Test: `tests/runner-templates.test.ts`

`example.html` is written with `overwrite: true`, so the extension reaches existing installs via **Repair Installation**. The shipped `example.steps.ts` / `ExamplePage.ts` are NOT touched (user-owned, `overwrite: false`).

- [ ] **Step 1: Write the failing test**

Append to `tests/runner-templates.test.ts` (match the file's existing style for locating the fixture template — it builds templates via `buildRunnerTemplates(DEFAULT_SETTINGS)` or similar; reuse that helper):

```ts
it("fixture page carries the Guided Tour greeting form", () => {
  const templates = buildRunnerTemplates(DEFAULT_SETTINGS);
  const fixture = templates.find((t) => t.path === "src/fixtures/example.html");
  expect(fixture).toBeDefined();
  expect(fixture?.overwrite).toBe(true);
  for (const marker of ['id="name"', 'id="greet"', 'id="greeting"', "Hello, "]) {
    expect(fixture?.content).toContain(marker);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/runner-templates.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Extend the fixture**

In `src/infrastructure/runner/templates/runner-templates.ts`, replace the `EXAMPLE_HTML` constant body (keep the existing heading/continue parts) with:

```ts
const EXAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Obsidian E2E Test Hub — Demo</title>
  </head>
  <body>
    <h1>Obsidian E2E Test Hub Demo</h1>
    <button id="continue">Continue</button>
    <div id="result"></div>
    <hr />
    <!-- Guided Tour greeting form: the user's self-authored scenario drives this. -->
    <label for="name">Name</label>
    <input id="name" type="text" />
    <button id="greet">Greet</button>
    <div id="greeting"></div>
    <script>
      document.getElementById("continue").addEventListener("click", () => {
        document.getElementById("result").textContent = "Test completed";
      });
      document.getElementById("greet").addEventListener("click", () => {
        const name = document.getElementById("name").value;
        document.getElementById("greeting").textContent = "Hello, " + name + "!";
      });
    </script>
  </body>
</html>
`;
```

(Plain string concatenation in the fixture script — a `${...}` template placeholder inside this TS template literal would be interpolated at build time.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/runner-templates.test.ts && npm test`
Expected: PASS (if an existing snapshot/content assertion on `EXAMPLE_HTML` fails, update it to the new content).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/runner/templates/runner-templates.ts tests/runner-templates.test.ts
git commit -m "feat(runner): greeting form on the demo fixture for the Guided Tour scenario"
```

---

### Task 6: Tour row projection (pure presentation)

**Files:**
- Create: `src/presentation/views/guided-tour-rows.ts`
- Test: `tests/guided-tour-rows.test.ts`

Pure projection of `TourState` into renderable rows (the `dashboard-rows.ts` pattern): all decisions here, the view stays a thin renderer.

- [ ] **Step 1: Write the failing tests**

Create `tests/guided-tour-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DefaultGuidedTourService } from "../src/application/services/guided-tour-service";
import { projectTour, TOUR_DONE_MESSAGE } from "../src/presentation/views/guided-tour-rows";
import { DEFAULT_SETTINGS, type TestHubSettings } from "../src/domain/settings/settings";
import { ok } from "../src/shared/result/result";
import { recordingEventBus, silentLogger } from "./fakes";

const makeState = (mutate?: (settings: TestHubSettings) => void) => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  mutate?.(settings);
  const service = new DefaultGuidedTourService(
    { getSettings: () => settings, updateSettings: async () => ok(undefined) },
    recordingEventBus().bus,
    silentLogger,
    {
      demoUseCaseId: "UC-001",
      demoFeatureFileName: "UC-001-open-example-page.feature",
      defaultSuiteIds: ["smoke", "regression"],
    },
  );
  return service.getState();
};

describe("projectTour", () => {
  it("expands exactly the active step and counts progress", () => {
    const model = projectTour(makeState((s) => (s.onboarding.completedSteps = ["run-demo"])));
    expect(model.progressLabel).toBe("1 of 10 steps done");
    const expanded = model.rows.filter((row) => row.expanded);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].id).toBe("create-use-case");
    expect(expanded[0].action?.label).toBe("New Use Case");
  });

  it("renders snippets, skip, and mark-done only on the expanded step", () => {
    const completedThroughGherkin = [
      "run-demo",
      "create-use-case",
      "generate-feature",
      "author-gherkin",
      "detect-missing-steps",
    ];
    const model = projectTour(
      makeState((s) => (s.onboarding.completedSteps = completedThroughGherkin)),
    );
    const active = model.rows.find((row) => row.expanded);
    expect(active?.id).toBe("implement-steps");
    expect(active?.snippets.length).toBe(1);
    expect(active?.showSkip).toBe(true);
    expect(active?.showMarkDone).toBe(false);
    const pending = model.rows.find((row) => row.id === "review-evidence");
    expect(pending?.snippets).toEqual([]);
    expect(pending?.showSkip).toBe(false);
  });

  it("shows mark-done on the manual step when active", () => {
    const allButManual = [
      "run-demo",
      "create-use-case",
      "generate-feature",
      "author-gherkin",
      "detect-missing-steps",
      "implement-steps",
      "create-suite",
      "run-own-test",
    ];
    const model = projectTour(makeState((s) => (s.onboarding.completedSteps = allButManual)));
    const active = model.rows.find((row) => row.expanded);
    expect(active?.id).toBe("review-evidence");
    expect(active?.showMarkDone).toBe(true);
  });

  it("reports completion", () => {
    const model = projectTour(
      makeState((s) => {
        s.onboarding.completedSteps = [
          "run-demo",
          "create-use-case",
          "generate-feature",
          "author-gherkin",
          "detect-missing-steps",
          "implement-steps",
          "create-suite",
          "run-own-test",
          "review-evidence",
          "generate-ci",
        ];
      }),
    );
    expect(model.completed).toBe(true);
    expect(TOUR_DONE_MESSAGE.length).toBeGreaterThan(0);
  });

  it("labels every row for assistive tech", () => {
    const model = projectTour(makeState());
    for (const row of model.rows) {
      expect(row.ariaLabel).toContain(`Step ${row.index} of 10`);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/guided-tour-rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the projection**

Create `src/presentation/views/guided-tour-rows.ts`:

```ts
import type {
  TourState,
  TourStepState,
  TourStepStatus,
} from "../../application/services/guided-tour-service";
import type {
  TourActionId,
  TourSnippet,
  TourStepId,
} from "../../domain/onboarding/tour-steps";

/** One rendered tour step. Done/skipped/pending rows collapse to a single line. */
export interface TourStepRow {
  id: TourStepId;
  index: number; // 1-based display position
  title: string;
  teach: string;
  status: TourStepStatus;
  statusIcon: string;
  expanded: boolean;
  action?: { id: TourActionId; label: string; ariaLabel: string };
  snippets: readonly TourSnippet[];
  showSkip: boolean;
  showMarkDone: boolean;
  hint?: string;
  ariaLabel: string;
}

export interface TourViewModel {
  rows: TourStepRow[];
  progressLabel: string;
  completed: boolean;
  dismissed: boolean;
}

/** Shown instead of the checklist hint once every step is done or skipped. */
export const TOUR_DONE_MESSAGE =
  "You built and ran your own test end to end. The User Manual covers everything else.";

const STATUS_ICONS: Record<TourStepStatus, string> = {
  done: "✓",
  skipped: "–",
  active: "→",
  pending: "○",
};

/**
 * Pure projection of the tour state into renderable rows (the dashboard-rows
 * pattern): the active step renders expanded with its action, snippets, and
 * skip/mark-done affordances; everything else is a one-line status row. Keep
 * the view thin: all decisions live here.
 */
export const projectTour = (state: TourState): TourViewModel => {
  const total = state.steps.length;
  const rows = state.steps.map((step, i) => projectStep(step, i + 1, total));
  const done = state.steps.filter((step) => step.status === "done").length;
  return {
    rows,
    progressLabel: `${done} of ${total} steps done`,
    completed: state.completed,
    dismissed: state.dismissed,
  };
};

const projectStep = (step: TourStepState, index: number, total: number): TourStepRow => {
  const { definition } = step;
  const expanded = step.status === "active";
  return {
    id: definition.id,
    index,
    title: definition.title,
    teach: definition.teach,
    status: step.status,
    statusIcon: STATUS_ICONS[step.status],
    expanded,
    action:
      expanded && definition.action
        ? {
            ...definition.action,
            ariaLabel: `Step ${index}: ${definition.action.label}`,
          }
        : undefined,
    snippets: expanded ? (definition.snippets ?? []) : [],
    showSkip: expanded && definition.skippable,
    showMarkDone: expanded && definition.completion.kind === "manual",
    hint: expanded ? hintFor(step) : undefined,
    ariaLabel: `Step ${index} of ${total}: ${definition.title} (${step.status})`,
  };
};

/** The static hint, plus the armed nudge on the manual evidence step. */
const hintFor = (step: TourStepState): string | undefined => {
  if (step.definition.completion.kind === "manual" && step.armed) {
    return "Your latest run wrote an Evidence note — open it, then mark this step done.";
  }
  return step.definition.hint;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/guided-tour-rows.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/guided-tour-rows.ts tests/guided-tour-rows.test.ts
git commit -m "feat(presentation): pure row projection for the Guided Tour view"
```

---

### Task 7: `GuidedTourView` + styles

**Files:**
- Create: `src/presentation/views/guided-tour-view.ts`
- Modify: `styles.css`

An `ItemView` for the **right sidebar** (peer of the Test Console — it must stay visible while the user works in the main area). Subscribes to the `tour.*` events plus `evidence.generated` (arming is in-memory; the view needs a repaint when it flips). Action buttons dispatch to deps callbacks wired in main.ts — no action logic lives here. Views are not unit-tested in this repo (Obsidian DOM); correctness is carried by the projection tests in Task 6.

- [ ] **Step 1: Implement the view**

Create `src/presentation/views/guided-tour-view.ts`:

```ts
import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import type { GuidedTourService } from "../../application/services/guided-tour-service";
import type { TourActionId, TourStepId } from "../../domain/onboarding/tour-steps";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { projectTour, TOUR_DONE_MESSAGE, type TourStepRow } from "./guided-tour-rows";
import { RenderScheduler } from "./render-scheduler";

export const GUIDED_TOUR_VIEW_TYPE = "e2e-test-hub-guided-tour";

/**
 * Callbacks the tour's action buttons dispatch to. Every callback is wired in
 * main.ts to an EXISTING flow (modal, launcher, workspace, command body) — the
 * tour guides, it never re-implements an action (spec 2026-06-11).
 */
export interface GuidedTourViewDeps {
  tour: GuidedTourService;
  eventBus: EventBus;
  runDemo: () => void | Promise<void>;
  openCreateUseCase: () => void;
  openUseCases: () => void | Promise<void>;
  openCreateSuite: () => void;
  openSuites: () => void | Promise<void>;
  openLatestEvidence: () => void;
  generateCiWorkflow: () => Promise<void>;
}

/**
 * The Guided Tour: a right-sidebar checklist over the full V1 loop that
 * auto-advances as the GuidedTourService observes the user's real actions.
 */
export class GuidedTourView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly scheduler = new RenderScheduler(() => this.render());

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: GuidedTourViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return GUIDED_TOUR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Guided Tour";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen(): Promise<void> {
    // tour.* drives progress repaints; evidence.generated flips the manual
    // step's in-memory "armed" hint, which publishes no tour event.
    for (const type of [
      "tour.started",
      "tour.step.completed",
      "tour.step.skipped",
      "tour.completed",
      "evidence.generated",
    ] as const) {
      this.subscriptions.push(this.deps.eventBus.subscribe(type, () => this.scheduler.schedule()));
    }
    await this.scheduler.schedule();
  }

  async onClose(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Guided Tour" });

    const model = projectTour(this.deps.tour.getState());
    container.createDiv({ cls: "e2e-test-hub-tour-progress", text: model.progressLabel });

    if (model.completed) {
      container.createEl("p", { text: TOUR_DONE_MESSAGE });
    } else {
      container.createEl("p", {
        text: "Each step completes by itself when you perform the real action.",
        cls: "e2e-test-hub-tour-hint",
      });
    }

    for (const row of model.rows) this.renderStep(container, row);

    const footer = container.createDiv({ cls: "e2e-test-hub-tour-actions" });
    const restart = footer.createEl("button", {
      text: "Restart tour",
      attr: { "aria-label": "Restart the guided tour from the beginning" },
    });
    restart.addEventListener("click", () => void this.deps.tour.restart());
    if (!model.dismissed && !model.completed) {
      const dismiss = footer.createEl("button", {
        text: "Dismiss",
        attr: { "aria-label": "Hide the guided tour call to action on the dashboard" },
      });
      dismiss.addEventListener("click", () => void this.deps.tour.dismiss());
    }
  }

  private renderStep(container: HTMLElement, row: TourStepRow): void {
    const step = container.createDiv({ cls: "e2e-test-hub-tour-step" });
    step.dataset.status = row.status;
    step.setAttr("aria-label", row.ariaLabel);
    step.createDiv({
      cls: "e2e-test-hub-tour-step-title",
      text: `${row.statusIcon} ${row.index}. ${row.title}`,
    });
    if (!row.expanded) return;

    step.createDiv({ cls: "e2e-test-hub-tour-teach", text: row.teach });
    for (const snippet of row.snippets) {
      const block = step.createDiv({ cls: "e2e-test-hub-tour-snippet" });
      block.createDiv({ cls: "e2e-test-hub-tour-step-title", text: snippet.title });
      block.createEl("pre").createEl("code", { text: snippet.code });
      const copy = block.createEl("button", {
        text: "Copy",
        attr: { "aria-label": `Copy the ${snippet.title} snippet` },
      });
      copy.addEventListener("click", () => {
        void navigator.clipboard
          .writeText(snippet.code)
          .then(() => new Notice("Copied to clipboard."))
          .catch(() => new Notice("Could not copy — select the snippet text manually.", 10000));
      });
    }
    if (row.hint) step.createDiv({ cls: "e2e-test-hub-tour-hint", text: row.hint });

    const actions = step.createDiv({ cls: "e2e-test-hub-tour-actions" });
    if (row.action) {
      const button = actions.createEl("button", {
        text: row.action.label,
        cls: "mod-cta",
        attr: { "aria-label": row.action.ariaLabel },
      });
      const actionId = row.action.id;
      button.addEventListener("click", () => this.dispatch(actionId));
    }
    if (row.showMarkDone) {
      const done = actions.createEl("button", {
        text: "Mark done",
        attr: { "aria-label": `Mark step ${row.index} done` },
      });
      done.addEventListener("click", () => void this.deps.tour.markDone(row.id as TourStepId));
    }
    if (row.showSkip) {
      const skip = actions.createEl("button", {
        text: "Skip",
        attr: { "aria-label": `Skip step ${row.index}` },
      });
      skip.addEventListener("click", () => void this.deps.tour.skip(row.id as TourStepId));
    }
  }

  private dispatch(id: TourActionId): void {
    switch (id) {
      case "run-demo":
        void this.deps.runDemo();
        break;
      case "open-create-use-case":
        this.deps.openCreateUseCase();
        break;
      case "open-use-cases":
        void this.deps.openUseCases();
        break;
      case "open-create-suite":
        this.deps.openCreateSuite();
        break;
      case "open-suites":
        void this.deps.openSuites();
        break;
      case "open-latest-evidence":
        this.deps.openLatestEvidence();
        break;
      case "generate-ci":
        void this.deps.generateCiWorkflow();
        break;
    }
  }
}
```

(If `row.id as TourStepId` is flagged redundant by ESLint because `TourStepRow.id` is already `TourStepId`, drop the cast.)

- [ ] **Step 2: Add the styles**

Append to `styles.css` (matching the file's `var(--…, fallback)` idiom):

```css
/* Guided Tour (spec 2026-06-11) */
.e2e-test-hub-tour-progress {
  color: var(--text-muted);
  margin-bottom: var(--size-4-2, 8px);
}
.e2e-test-hub-tour-step {
  padding: var(--size-4-2, 8px);
  border-left: 2px solid var(--background-modifier-border);
  margin-bottom: var(--size-4-1, 4px);
}
.e2e-test-hub-tour-step[data-status="active"] {
  border-left-color: var(--interactive-accent);
  background: var(--background-secondary);
}
.e2e-test-hub-tour-step[data-status="done"] {
  opacity: 0.7;
}
.e2e-test-hub-tour-step[data-status="skipped"] {
  opacity: 0.5;
}
.e2e-test-hub-tour-step-title {
  font-weight: 600;
}
.e2e-test-hub-tour-teach {
  margin: var(--size-4-1, 4px) 0;
}
.e2e-test-hub-tour-snippet pre {
  overflow-x: auto;
  padding: var(--size-4-2, 8px);
  background: var(--background-primary-alt);
  user-select: text;
}
.e2e-test-hub-tour-hint {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller, 12px);
}
.e2e-test-hub-tour-actions {
  display: flex;
  gap: var(--size-4-2, 8px);
  margin-top: var(--size-4-1, 4px);
}
.e2e-test-hub-tour-cta {
  margin: var(--size-4-2, 8px) 0;
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass (the view is not wired yet; unused-export lint should not fire for exported symbols).

- [ ] **Step 4: Commit**

```bash
git add src/presentation/views/guided-tour-view.ts styles.css
git commit -m "feat(presentation): Guided Tour sidebar view"
```

---

### Task 8: Wiring — composition root, command, wizard CTA, dashboard CTA

**Files:**
- Modify: `src/main.ts`
- Modify: `src/presentation/commands/register-commands.ts`
- Modify: `src/presentation/views/initialization-wizard-modal.ts`
- Modify: `src/presentation/views/dashboard-view.ts`

- [ ] **Step 1: registerCommands — new command + returned helper**

In `src/presentation/commands/register-commands.ts`:

1. Import the view type: `import { GUIDED_TOUR_VIEW_TYPE } from "../views/guided-tour-view";`
2. Add the exported helpers contract above `registerCommands`:

```ts
/**
 * Command bodies the composition root re-uses for view buttons (the Guided
 * Tour's CI step runs the SAME body as the "Generate CI workflow" command, so
 * the logic stays defined once).
 */
export interface RegisteredCommandHelpers {
  generateCiWorkflow(overwriteExisting?: boolean): Promise<void>;
}
```

3. Change the signature to `export function registerCommands(plugin: Plugin, deps: TestHubCommandDeps): RegisteredCommandHelpers {` and add at the very end of the function body:

```ts
  plugin.addCommand({
    id: "open-guided-tour",
    name: "Open Guided Tour",
    callback: () => void deps.workspace.openView(GUIDED_TOUR_VIEW_TYPE, "sidebar"),
  });

  return { generateCiWorkflow };
```

(`generateCiWorkflow` is the existing `const` defined inside the function near line 289.)

- [ ] **Step 2: Initialization wizard success CTA**

In `src/presentation/views/initialization-wizard-modal.ts`:

1. Add to `InitializationWizardDeps`:

```ts
  /** Opens the Guided Tour view (spec 2026-06-11); wired in main.ts. */
  openGuidedTour?: () => void;
```

2. In `renderSuccess`, change the summary paragraph to mention the tour when available:

```ts
    const summary = `Test Hub ready: ${result.createdFolders.length} folders and ${result.createdFiles.length} files created.`;
    contentEl.createEl("p", {
      text: this.deps.openGuidedTour
        ? `${summary} Take the guided tour to build and run your first test yourself.`
        : result.documentationGenerated
          ? `${summary} Open Getting Started for a walkthrough.`
          : summary,
    });
```

3. Still in `renderSuccess`, before the existing "Open Getting Started" button, add the tour CTA and demote Getting Started from CTA when the tour button exists:

```ts
    const actions = new Setting(contentEl);
    if (this.deps.openGuidedTour) {
      actions.addButton((button) =>
        button
          .setButtonText("Start guided tour")
          .setCta()
          .onClick(() => {
            this.deps.openGuidedTour?.();
            this.close();
          }),
      );
    }
    if (result.documentationGenerated) {
      const gettingStarted = joinVaultPath(settings.paths.documentationPath, "Getting Started.md");
      actions.addButton((button) => {
        button.setButtonText("Open Getting Started").onClick(async () => {
          await openOrNotice(this.deps.workspace, gettingStarted);
          this.close();
        });
        if (!this.deps.openGuidedTour) button.setCta();
      });
    }
```

(This replaces the existing `const actions = new Setting(contentEl); if (result.documentationGenerated) { … }` block; the trailing Close button stays.)

- [ ] **Step 3: Dashboard CTA**

In `src/presentation/views/dashboard-view.ts`:

1. Add to `DashboardViewDeps`:

```ts
  // Guided Tour CTA (spec 2026-06-11): shown while the tour is neither
  // completed nor dismissed; opens the sidebar tour view.
  tourVisible: () => boolean;
  openGuidedTour: () => void;
```

2. Add a render method (next to `renderQuickActions`):

```ts
  /** "Continue the guided tour" banner, hidden once completed or dismissed. */
  private renderTourCta(container: HTMLElement): void {
    if (!this.deps.tourVisible()) return;
    const banner = container.createDiv({ cls: "e2e-test-hub-tour-cta" });
    const button = banner.createEl("button", {
      text: "Continue the guided tour",
      cls: "mod-cta",
      attr: { "aria-label": "Continue the guided tour" },
    });
    button.addEventListener("click", () => this.deps.openGuidedTour());
  }
```

3. Call it right after the existing `this.renderQuickActions(container);` call (around line 206): add `this.renderTourCta(container);`.
4. In `onOpen()`, alongside the view's existing eventBus subscriptions, add repaint triggers so the CTA disappears live:

```ts
    this.subscriptions.push(
      this.deps.eventBus.subscribe("tour.completed", () => this.scheduler.schedule()),
    );
```

(Adapt the exact subscription-array/scheduler names to the file's existing pattern — it mirrors `EvidenceExplorerView.onOpen`.)

- [ ] **Step 4: Composition root**

In `src/main.ts`:

1. Imports:

```ts
import {
  DefaultGuidedTourService,
  type GuidedTourService,
} from "./application/services/guided-tour-service";
import { DEMO_FEATURE_FILE_NAME, DEMO_USE_CASE_ID } from "./application/content/demo-content";
import { DEFAULT_SUITES } from "./application/content/default-suites";
import { GUIDED_TOUR_VIEW_TYPE, GuidedTourView } from "./presentation/views/guided-tour-view";
```

Also extend the existing `registerCommands` import line's module to import `type RegisteredCommandHelpers`.

2. Fields (next to the other service fields):

```ts
  private guidedTourService!: GuidedTourService;
  private commandHelpers!: RegisteredCommandHelpers;
```

3. Construction — after `this.postRunCoordinator.start();` add:

```ts
    // Guided Tour (spec 2026-06-11): observes the user's real actions on the
    // bus and advances the onboarding checklist whether or not the view is
    // open. Persistence goes through the SettingsHost so the in-memory
    // settings copy stays current (optimistic swap in updateSettings).
    this.guidedTourService = new DefaultGuidedTourService(
      {
        getSettings: () => this.hubSettings,
        updateSettings: (next) => this.updateSettings(next),
      },
      eventBus,
      this.logger,
      {
        demoUseCaseId: DEMO_USE_CASE_ID,
        demoFeatureFileName: DEMO_FEATURE_FILE_NAME,
        defaultSuiteIds: DEFAULT_SUITES.map((suite) => suite.id),
      },
    );
    this.guidedTourService.start();
```

4. View registration (next to the other `registerView` calls):

```ts
    this.registerView(
      GUIDED_TOUR_VIEW_TYPE,
      (leaf) =>
        new GuidedTourView(leaf, {
          tour: this.guidedTourService,
          eventBus,
          runDemo: () => this.runLauncher.launch({ scope: "demo", target: "demo" }),
          openCreateUseCase: () => this.openCreateUseCase(),
          openUseCases: () => void this.workspaceAdapter.openView(USE_CASE_VIEW_TYPE),
          openCreateSuite: () => this.openCreateSuite(),
          openSuites: () => void this.workspaceAdapter.openView(SUITE_VIEW_TYPE),
          openLatestEvidence: () => this.openLatestEvidence(),
          // Lazy: commandHelpers is assigned by registerCommands() below,
          // before any view can open.
          generateCiWorkflow: () => this.commandHelpers.generateCiWorkflow(),
        }),
    );
```

5. Dashboard deps — add to the `new DashboardView(leaf, { … })` object:

```ts
          tourVisible: () => {
            const state = this.guidedTourService.getState();
            return !state.completed && !state.dismissed;
          },
          openGuidedTour: () =>
            void this.workspaceAdapter.openView(GUIDED_TOUR_VIEW_TYPE, "sidebar"),
```

6. Capture the command helpers — change `registerCommands(this, { … });` to `this.commandHelpers = registerCommands(this, { … });`.
7. Wizard deps — in `openWizard()`, add to the modal's deps object:

```ts
      openGuidedTour: () =>
        void this.workspaceAdapter.openView(GUIDED_TOUR_VIEW_TYPE, "sidebar"),
```

8. Helper method (next to `openEvidenceNote`):

```ts
  // Guided Tour step 9: open the most recent Evidence note, or say why not.
  private openLatestEvidence(): void {
    const path = this.postRunCoordinator.lastEvidence();
    if (path === null) {
      new Notice("No Evidence note yet — run a test first.");
      return;
    }
    void this.openEvidenceNote(path);
  }
```

(Check `PostRunCoordinator.lastEvidence()`'s actual return type — the Test Console wiring `lastEvidence: () => this.postRunCoordinator.lastEvidence()` shows it exists; if it returns `VaultPath | null` this compiles as-is, if it returns `undefined` adjust the null check.)

9. Teardown — in `onunload()`, after `this.postRunCoordinator?.stop();` add:

```ts
    this.guidedTourService?.stop();
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/presentation/
git commit -m "feat: wire the Guided Tour — view, command, wizard CTA, dashboard CTA"
```

---

### Task 9: Generated documentation mentions the tour

**Files:**
- Modify: `src/application/content/documentation-content.ts`
- Test: `tests/documentation-generation-service.test.ts` (or `tests/feature-content.test.ts` style — wherever doc content is asserted; if none asserts this content, add to `tests/documentation-generation-service.test.ts`)

- [ ] **Step 1: Write the failing test**

Append to `tests/documentation-generation-service.test.ts` (reuse the file's existing service/builder setup; the assertion target is the pure builder, so a minimal standalone test also works):

```ts
import { buildDocumentation } from "../src/application/content/documentation-content";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";

it("Getting Started and the index point at the Guided Tour", () => {
  const docs = buildDocumentation(DEFAULT_SETTINGS);
  const gettingStarted = docs.find((doc) => doc.type === "getting-started");
  const index = docs.find((doc) => doc.type === "index");
  expect(gettingStarted?.content).toContain("Open Guided Tour");
  expect(index?.content).toContain("Open Guided Tour");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/documentation-generation-service.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Update the builders**

In `src/application/content/documentation-content.ts`:

1. `buildGettingStartedDoc` — after the "## Your first test" section (before "## Next steps"), insert:

```
## Build your own (Guided Tour)

Run the **Open Guided Tour** command (or click **Start guided tour** right
after initialization). The tour is a sidebar checklist that walks you through
authoring your own Use Case, Feature, step definitions, Test Suite, run, and
Evidence — each step completes by itself when you perform the real action,
and you finish with a test you built yourself.
```

2. `buildIndexDoc` — after the "## The workflow at a glance" numbered list, add:

```
New here? Run the **Open Guided Tour** command — it walks you through this
whole loop, learning by doing.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/documentation-generation-service.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/content/documentation-content.ts tests/
git commit -m "docs(generated): Getting Started and index point at the Guided Tour"
```

---

### Task 10: Repository documentation

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/architecture/Event Catalog.md`
- Create: `docs/adr/0020-event-observed-guided-tour.md`
- Modify: `README.md`

- [ ] **Step 1: CONTEXT.md glossary**

In `CONTEXT.md` under `### Process`, after the **Initialization Wizard** entry, add:

```markdown
**Guided Tour**:
The event-observed onboarding checklist: a persistent sidebar view that walks a user through the full V1 loop (Use Case → Feature → Gherkin → step definitions → Suite → Run → Evidence → CI) by observing domain events as the user performs each real action. Distinct from the Initialization Wizard — the wizard scaffolds, the tour teaches. Completing it leaves the user with a self-authored test (the `@tour` greeting scenario against the extended fixture).
_Avoid_: Tutorial, walkthrough, onboarding wizard.
```

Also extend the **Correlation ID** entry's example sentence to:

```markdown
A constant identifier shared by all events in one logical flow. For a Test Run, `correlationId = runId`; for the Initialization Wizard, the wizard invocation id; for the Guided Tour, the `tourId`.
```

- [ ] **Step 2: Event Catalog**

In `docs/architecture/Event Catalog.md`:

1. After the Settings events section (§13), insert a new section (renumber or suffix consistently with the document's existing numbering — read the surrounding sections first):

```markdown
## Tour Events

Published by the `GuidedTourService` as the user progresses through the Guided Tour (spec 2026-06-11). `correlationId = tourId` for the whole traversal; `causationId` on `tour.step.completed` is the id of the triggering domain event when `via = "event"`.

### `tour.started`

​```ts
{ tourId: string; }
​```

### `tour.step.completed`

​```ts
{
  tourId: string;
  stepId: string;       // TourStepId, e.g. "create-use-case"
  via: "event" | "manual";
}
​```

### `tour.step.skipped`

​```ts
{ tourId: string; stepId: string; }
​```

### `tour.completed`

​```ts
{ tourId: string; }
​```
```

(Remove the zero-width separators before the backticks — they exist only so this plan's own code fence survives.)

2. In the correlation-rules section (§19), add a row/bullet: **Guided Tour** — `correlationId = tourId` (minted on the first completed/skipped step or on restart).

- [ ] **Step 3: ADR-0020**

Create `docs/adr/0020-event-observed-guided-tour.md`:

```markdown
---
type: adr
id: ADR-0020
status: accepted
title: Event-observed Guided Tour for Onboarding
date: 2026-06-11
related:
  - "[[Obsidian E2E Test Hub]]"
  - "[[Solution Design]]"
  - "[[0009-provide-out-of-the-box-demo-test]]"
---

# Event-observed Guided Tour for Onboarding

Onboarding gains a **Guided Tour**: a persistent right-sidebar checklist over the full V1 loop (Use Case → Feature → Gherkin → step definitions → Suite → Run → Evidence → CI). The user performs each step in the real UI; a `GuidedTourService` observes the existing domain events on the EventBus, auto-advances the checklist, persists progress in the settings (`onboarding` section, so a UC-024 reset clears it), and publishes `tour.started` / `tour.step.completed` / `tour.step.skipped` / `tour.completed` with `correlationId = tourId`. The demo fixture gains a greeting form so the user's self-authored scenario exercises genuinely new behavior, including a real missing-steps → generate → implement cycle.

ADR-0009 is unchanged: the shipped UC-001 demo remains the five-minute smoke check and the tour's step 1; the tour has the user build a *second* test beside it.

## Considered alternatives

- Extend the Initialization Wizard into a multi-page tutorial modal. Rejected: modals block the workspace, so the user cannot perform the actions while being guided — the opposite of learning by doing.
- A generated interactive Markdown checklist note. Rejected: Markdown cannot observe actions; the checklist would go stale the moment the user does anything.
- Track progress via service-internal callbacks without domain events. Rejected: tour progress is a domain fact like any other; publishing `tour.*` events keeps the views bus-driven (consistent with every other surface) and the Event Catalog complete.
- Have the tour replace the generated demo content (user builds UC-001 themselves). Rejected: weakens ADR-0009's "green within five minutes" promise; the worked example and the self-built test serve different needs.
```

- [ ] **Step 4: README**

In `README.md`, in the "Working from the UI" bullet list, add after the **Dashboard** bullet:

```markdown
- **Guided Tour.** A right-sidebar checklist that teaches the full loop by
  doing: each step explains why it matters, offers the real action button and
  copy-paste snippets, and completes by itself (via domain events) when the
  user performs the action — ending with a self-authored greeting test run
  green. Reachable via **Open Guided Tour**, the wizard's success screen, and
  a dashboard call to action.
```

- [ ] **Step 5: Verify and commit**

Run: `npm run lint` (markdown is unlinted, but catch accidental code edits) — then:

```bash
git add CONTEXT.md README.md docs/adr/0020-event-observed-guided-tour.md "docs/architecture/Event Catalog.md"
git commit -m "docs: Guided Tour glossary entry, ADR-0020, tour events in the catalog"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
Expected: all pass. If `format:check` fails, run `npm run format` and amend the relevant commit (or add a `style:` commit).

- [ ] **Step 2: Coverage gate**

Run: `npm run test:coverage`
Expected: ≥ 80% per NFR-002. The new pure modules (tour-steps, rows, service) are fully covered by Tasks 3/4/6; the view follows the repo's existing coverage scoping for presentation views.

- [ ] **Step 3: Push**

```bash
git push -u origin claude/interactive-plugin-onboarding-phq47j
```

Then open a PR for the branch if none exists.

---

## Self-review notes (already applied)

- Spec coverage: steps table (T3), fixture (T5), service + events (T1/T4), settings persistence (T2), view/rows (T6/T7), entry points (T8), generated docs (T9), CONTEXT/ADR/catalog/README (T10).
- Type consistency: `TourSettingsAccess` is the constructor's first param everywhere; `tourObservedEventTypes()` / `isTourStepId` named identically in Tasks 3 and 4; `GUIDED_TOUR_VIEW_TYPE` shared by Tasks 7 and 8.
- Known judgment calls an executor may exercise: exact insertion anchors inside `dashboard-view.ts`/`register-commands.ts` (follow the cited surrounding code), and updating any pre-existing assertions that pin `EXAMPLE_HTML` or documentation text verbatim.

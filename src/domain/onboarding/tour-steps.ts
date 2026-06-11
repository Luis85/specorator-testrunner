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
        // Requiring @tour (not just valid) closes the loophole Codex flagged
        // on PR #31: the generated scaffold validates clean, but only the
        // AUTHORED scenario carries the @tour tag this step teaches.
        matches: (payload, ctx) => {
          const p = record(payload);
          return (
            p?.valid === true &&
            typeof p.featurePath === "string" &&
            !p.featurePath.endsWith(ctx.demoFeatureFileName) &&
            Array.isArray(p.tags) &&
            p.tags.includes("@tour")
          );
        },
      },
    },
    skippable: false,
    hint: "This step completes when validation sees a valid Feature tagged @tour.",
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
      "below, then run Detect Missing Steps again. Zero missing completes this step — that " +
      "means every step is now defined; your run in the later step proves the implementation.",
    action: { id: "open-use-cases", label: "Open Use Cases" },
    snippets: [{ title: "Step implementation", language: "typescript", code: TOUR_STEPS_SNIPPET }],
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
          // No captured-undefined wildcard: the previous rule guarantees the
          // featurePath capture, so the zero-missing detection must be for
          // exactly the feature whose steps were generated.
          matches: (payload, _ctx, captured) => {
            const p = record(payload);
            return (
              Array.isArray(p?.missingSteps) &&
              p.missingSteps.length === 0 &&
              captured !== undefined &&
              p.featurePath === captured
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
          // runId must be a string HERE: it is the capture the next rule keys
          // on, and a malformed payload that advanced the sequence without a
          // captured id would otherwise let any later passed run complete the
          // step (PR #31 Codex review).
          matches: (payload, ctx) => {
            const p = record(payload);
            return (
              typeof p?.suiteId === "string" &&
              typeof p.runId === "string" &&
              !ctx.defaultSuiteIds.includes(p.suiteId)
            );
          },
          capture: (payload) => {
            const value = record(payload)?.runId;
            return typeof value === "string" ? value : undefined;
          },
        },
        {
          type: "testrun.completed",
          // No captured-undefined wildcard: the previous rule guarantees the
          // capture, so a missing id must stall the sequence, never widen it.
          matches: (payload, _ctx, captured) => {
            const p = record(payload);
            return p?.status === "passed" && captured !== undefined && p.runId === captured;
          },
        },
      ],
    },
    skippable: false,
    requiresCompleted: ["create-suite"],
    hint:
      "If the run fails with pending or undefined steps, finish the step-definition step " +
      "above — generated stubs stay 'Pending' until you paste the implementation.",
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

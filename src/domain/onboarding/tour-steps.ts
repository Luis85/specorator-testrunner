import type { DomainEventType } from "../events/domain-event";
import {
  captureFeaturePath,
  captureRunId,
  captureSuiteId,
  failedAttemptTerminals,
  isCapturedRunPassed,
  isTourFeatureValidation,
  isTourSuiteCreation,
  record,
  tourFeatureValidated,
  type TourCompletion,
  type TourEventRule,
} from "./tour-event-rules";

// Re-exported so the service, views, and tests keep importing the tour
// vocabulary from this module (the step table's established public surface)
// even though the rule predicates now live in ./tour-event-rules.
export type { TourCompletion, TourEventContext, TourEventRule } from "./tour-event-rules";

/**
 * The Guided Tour's step model (spec 2026-06-11): a pure, ordered table of ten
 * steps covering the full V1 loop. Completion is observed from domain events
 * (or, for steps without an event, marked done manually); the rule predicates
 * that do the observing live in {@link tour-event-rules}.
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

/** Ids the view maps to deps callbacks — the tour never re-implements actions. */
export type TourActionId =
  | "run-demo"
  | "open-create-use-case"
  | "open-use-cases"
  | "open-pending-steps"
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

/**
 * The scenario the user authors in step 4. The three greeting steps are NEW —
 * they deliberately do not collide with the shipped `example.steps.ts`
 * patterns (that file is user-owned, `overwrite: false`, and duplicate
 * step-definition patterns would be ambiguous); only the Given is reused.
 */
export const TOUR_GHERKIN_SNIPPET = `@tour
Feature: Greet the visitor
  Scenario: Greeting shows the entered name
    Given I open the local example page
    When I enter "Ada" into the name field
    And I submit the greeting
    Then the greeting should say "Hello, Ada!"
`;

/**
 * The implementation the user pastes into the generated step scaffold (step 6).
 * playwright-bdd form (`createBdd()` + the Playwright `{ page }` fixture) so it
 * loads in the V2 runner — the V1 `@cucumber/cucumber` + `World` snippet would
 * fail `bddgen`/typecheck (those packages/files are absent in a V2 runner).
 */
export const TOUR_STEPS_SNIPPET = `import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

When("I enter {string} into the name field", async ({ page }, name: string) => {
  await page.fill("#name", name);
});

When("I submit the greeting", async ({ page }) => {
  await page.click("#greet");
});

Then("the greeting should say {string}", async ({ page }, expected: string) => {
  await expect(page.locator("#greeting")).toHaveText(expected);
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
      // Correlated to the DEMO run (PR #31 Codex review): a demo request
      // surfaces on the bus as target "demo" (the internal demo scope maps to
      // "suite"), the started event that follows carries the runId, and only
      // THAT run's passing completes the step — an arbitrary green run does
      // not. ADR-0018 (single active run) keeps the request→started pairing
      // unambiguous.
      kind: "event-sequence",
      rules: [
        {
          type: "testrun.requested",
          // scope (not target) is the discriminator: a user suite whose id
          // slugifies to "demo" publishes scope "suite" (PR #31 Codex review).
          matches: (payload) => record(payload)?.scope === "demo",
        },
        {
          type: "testrun.started",
          matches: (payload) => typeof record(payload)?.runId === "string",
          capture: captureRunId,
        },
        {
          type: "testrun.completed",
          matches: isCapturedRunPassed,
        },
      ],
      // A red/errored/cancelled demo attempt re-arms the whole sequence so the
      // user can simply click Run demo test again.
      resetOn: failedAttemptTerminals,
      retryFrom: 0,
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
        matches: isTourFeatureValidation,
      },
    },
    skippable: false,
    // Scenario CONTENT is not observable from events (only tags travel on the
    // validation event), so the hint sets the expectation; the step-8 run is
    // the honest arbiter that a real scenario was authored (PR #31 review).
    hint:
      "This step completes when validation sees a valid Feature tagged @tour. Make sure you " +
      "replaced the scaffold's scenario — the later steps only go green against a real one.",
  },
  {
    id: "detect-missing-steps",
    title: "Detect missing steps",
    teach:
      "Gherkin lines only run when a step definition implements them. Open Pending Steps, find " +
      "your @tour Feature, and click Verify — bddgen compares it against the runner's steps; " +
      "your three greeting steps are new, so it should find them missing.",
    action: { id: "open-pending-steps", label: "Open pending steps" },
    completion: {
      // Anchored on the @tour Feature's validation (PR #31 Codex review):
      // detecting missing steps on some OTHER feature file must not advance
      // the tour past the step it teaches.
      kind: "event-sequence",
      rules: [
        tourFeatureValidated,
        {
          type: "specification.missingSteps.detected",
          matches: (payload, _ctx, captured) => {
            const p = record(payload);
            return (
              Array.isArray(p?.missingSteps) &&
              p.missingSteps.length > 0 &&
              captured !== undefined &&
              p.featurePath === captured
            );
          },
        },
      ],
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
    action: { id: "open-pending-steps", label: "Open pending steps" },
    snippets: [{ title: "Step implementation", language: "typescript", code: TOUR_STEPS_SNIPPET }],
    completion: {
      // Anchored on the @tour Feature's validation, then ITS stub generation,
      // then ITS zero-missing detection — generation/detection on another
      // feature file cannot advance the tour (PR #31 Codex review).
      kind: "event-sequence",
      rules: [
        tourFeatureValidated,
        {
          type: "stepdefinition.generated",
          matches: (payload, _ctx, captured) => {
            const p = record(payload);
            return (
              typeof p?.featurePath === "string" &&
              captured !== undefined &&
              p.featurePath === captured
            );
          },
          // Re-capture the same path so the final rule keys on it too.
          capture: captureFeaturePath,
        },
        {
          type: "specification.missingSteps.detected",
          // No captured-undefined wildcard: the previous rules guarantee the
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
      "Suites select scenarios by tag expression, never by explicit list. Create a " +
      'suite named "Tour" with the tag expression @tour — it matches exactly the scenario ' +
      "you authored.",
    action: { id: "open-create-suite", label: "New Test Suite" },
    completion: {
      kind: "event",
      rule: {
        type: "suite.created",
        // The Tag Expression must SELECT the authored scenario (PR #31 Codex
        // review): any other custom suite — including `not @tour` — would not
        // run it, so the next step's run could never execute it.
        matches: isTourSuiteCreation,
      },
    },
    skippable: false,
    hint: "This step completes when you create a suite whose tag expression selects @tour.",
  },
  {
    id: "run-own-test",
    title: "Run your own test",
    teach:
      "Run the Tour suite and watch the output stream into the Test Console. This is the " +
      "same runner CI uses — green here means green anywhere.",
    action: { id: "open-suites", label: "Open Test Suites" },
    completion: {
      // Three correlated rules (PR #31 Codex review): the @tour suite's
      // creation captures its suiteId, only THAT suite's execution captures
      // the runId, and only THAT run's passing completes the step — running
      // an unrelated custom suite cannot satisfy "run your own test".
      kind: "event-sequence",
      rules: [
        {
          type: "suite.created",
          matches: isTourSuiteCreation,
          capture: captureSuiteId,
        },
        {
          type: "suite.executed",
          // runId must be a string HERE: it is the capture the next rule keys
          // on, and advancing without it would let any later passed run
          // complete the step.
          matches: (payload, _ctx, captured) => {
            const p = record(payload);
            return (
              typeof p?.suiteId === "string" &&
              typeof p.runId === "string" &&
              captured !== undefined &&
              p.suiteId === captured
            );
          },
          capture: captureRunId,
        },
        {
          type: "testrun.completed",
          // No captured-undefined wildcard: the previous rule guarantees the
          // capture, so a missing id must stall the sequence, never widen it.
          matches: isCapturedRunPassed,
        },
      ],
      // A failed attempt rolls back to AFTER suite.created (which cannot
      // re-fire — duplicate suite ids are rejected): the user fixes their
      // steps and just re-runs the Tour suite (the hint's documented path).
      resetOn: failedAttemptTerminals,
      retryFrom: 1,
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

/** Every event type any rule (incl. armedBy and resets) observes — the service's subscription set. */
export const tourObservedEventTypes = (): DomainEventType[] => {
  const types = new Set<DomainEventType>();
  for (const step of TOUR_STEPS) {
    if (step.completion.kind === "event") types.add(step.completion.rule.type);
    if (step.completion.kind === "event-sequence") {
      for (const rule of step.completion.rules) types.add(rule.type);
      for (const rule of step.completion.resetOn ?? []) types.add(rule.type);
    }
    if (step.armedBy) types.add(step.armedBy.type);
  }
  return [...types];
};

/** True when `value` names a known tour step (drops stale persisted ids). */
export const isTourStepId = (value: unknown): value is TourStepId =>
  typeof value === "string" && TOUR_STEPS.some((step) => step.id === value);

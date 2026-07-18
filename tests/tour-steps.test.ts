import { describe, expect, it } from "vitest";
import {
  isTourStepId,
  TOUR_GHERKIN_SNIPPET,
  TOUR_STEPS,
  TOUR_STEPS_SNIPPET,
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

  it("routes BOTH the detect and implement steps to the Pending Steps flow (Task 8 merged the row's Detect/Generate buttons into Steps, so neither can route to a removed action)", () => {
    expect(step("detect-missing-steps").action).toEqual({
      id: "open-pending-steps",
      label: "Open pending steps",
    });
    expect(step("implement-steps").action).toEqual({
      id: "open-pending-steps",
      label: "Open pending steps",
    });
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
  it("run-demo sequence: demo requested, run started, THAT run passes", () => {
    const [requested, started, passed] = sequenceRules("run-demo");
    // Only the demo request anchors the sequence — an arbitrary green run
    // must not settle the step, and a user suite whose id slugifies to "demo"
    // publishes scope "suite", not "demo" (PR #31 Codex review).
    expect(requested.matches({ scope: "demo", target: "demo" }, ctx)).toBe(true);
    expect(requested.matches({ scope: "suite", target: "demo" }, ctx)).toBe(false);
    expect(requested.matches({ scope: "suite", target: "smoke" }, ctx)).toBe(false);
    expect(requested.matches({ scope: "all", target: "all" }, ctx)).toBe(false);
    expect(started.matches({ runId: "RUN-1", command: "npm run test" }, ctx)).toBe(true);
    expect(started.matches({ command: "npm run test" }, ctx)).toBe(false);
    expect(started.capture?.({ runId: "RUN-1" })).toBe("RUN-1");
    expect(passed.matches({ runId: "RUN-1", status: "passed" }, ctx, "RUN-1")).toBe(true);
    expect(passed.matches({ runId: "RUN-2", status: "passed" }, ctx, "RUN-1")).toBe(false);
    expect(passed.matches({ runId: "RUN-1", status: "failed" }, ctx, "RUN-1")).toBe(false);
    expect(passed.matches({ runId: "RUN-1", status: "passed" }, ctx, undefined)).toBe(false);
  });

  it("run-correlated sequences reset on failed-attempt terminals", () => {
    for (const id of ["run-demo", "run-own-test"] as const) {
      const completion = step(id).completion;
      if (completion.kind !== "event-sequence") throw new Error(`${id} is not a sequence step`);
      const resets = completion.resetOn ?? [];
      expect(resets.map((rule) => rule.type)).toEqual([
        "testrun.completed",
        "testrun.failed",
        "testrun.cancelled",
      ]);
      const [completedReset, failedReset, cancelledReset] = resets;
      // A FAILED terminal of the tracked run resets; a passed one never does.
      expect(completedReset.matches({ runId: "RUN-1", status: "failed" }, ctx, "RUN-1")).toBe(true);
      expect(completedReset.matches({ runId: "RUN-1", status: "passed" }, ctx, "RUN-1")).toBe(
        false,
      );
      expect(completedReset.matches({ runId: "RUN-2", status: "failed" }, ctx, "RUN-1")).toBe(
        false,
      );
      expect(failedReset.matches({ runId: "RUN-1", reason: "boom" }, ctx, "RUN-1")).toBe(true);
      expect(cancelledReset.matches({ runId: "RUN-1" }, ctx, "RUN-1")).toBe(true);
      // Before a runId is captured, any terminal re-arms (ADR-0018: only one
      // run can be in flight, so it belongs to the tracked attempt).
      expect(failedReset.matches({ runId: "RUN-9", reason: "boom" }, ctx, undefined)).toBe(true);
    }
    expect(step("run-demo").completion.kind === "event-sequence").toBe(true);
  });

  it("create-use-case excludes the shipped demo Use Case", () => {
    const rule = eventRule("create-use-case");
    expect(rule.matches({ useCaseId: "UC-002" }, ctx)).toBe(true);
    expect(rule.matches({ useCaseId: "UC-001" }, ctx)).toBe(false);
    expect(rule.matches({}, ctx)).toBe(false);
  });

  it("author-gherkin requires a valid, non-demo feature tagged @tour", () => {
    const rule = eventRule("author-gherkin");
    expect(
      rule.matches(
        {
          featurePath: "Specifications/features/UC-002-greet.feature",
          valid: true,
          tags: ["@tour"],
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      rule.matches(
        {
          featurePath: "Specifications/features/UC-001-open-example-page.feature",
          valid: true,
          tags: ["@tour"],
        },
        ctx,
      ),
    ).toBe(false);
    expect(
      rule.matches(
        {
          featurePath: "Specifications/features/UC-002-greet.feature",
          valid: false,
          tags: ["@tour"],
        },
        ctx,
      ),
    ).toBe(false);
    // The unedited scaffold validates clean but carries no @tour tag — it must
    // NOT complete the authoring step (PR #31 Codex review).
    expect(
      rule.matches(
        { featurePath: "Specifications/features/UC-002-greet.feature", valid: true, tags: [] },
        ctx,
      ),
    ).toBe(false);
    expect(
      rule.matches(
        { featurePath: "Specifications/features/UC-002-greet.feature", valid: true },
        ctx,
      ),
    ).toBe(false);
  });

  it("detect-missing-steps sequence: the @tour feature validated, then ITS missing steps", () => {
    const [validated, missing] = sequenceRules("detect-missing-steps");
    expect(validated.matches({ featurePath: "f.feature", valid: true, tags: ["@tour"] }, ctx)).toBe(
      true,
    );
    expect(validated.capture?.({ featurePath: "f.feature" })).toBe("f.feature");
    expect(
      missing.matches(
        { featurePath: "f.feature", missingSteps: ["When I submit the greeting"] },
        ctx,
        "f.feature",
      ),
    ).toBe(true);
    expect(missing.matches({ featurePath: "f.feature", missingSteps: [] }, ctx, "f.feature")).toBe(
      false,
    );
    // A detection on some OTHER feature file must not advance the tour
    // (PR #31 Codex review), and a missing capture must stall, never widen.
    expect(
      missing.matches({ featurePath: "other.feature", missingSteps: ["x"] }, ctx, "f.feature"),
    ).toBe(false);
    expect(missing.matches({ featurePath: "f.feature", missingSteps: ["x"] }, ctx, undefined)).toBe(
      false,
    );
  });

  it("implement-steps sequence: @tour validated, ITS stubs generated, then ITS zero missing", () => {
    const [validated, generated, zero] = sequenceRules("implement-steps");
    expect(validated.matches({ featurePath: "f.feature", valid: true, tags: ["@tour"] }, ctx)).toBe(
      true,
    );
    expect(
      generated.matches({ featurePath: "f.feature", stepFile: "s.ts" }, ctx, "f.feature"),
    ).toBe(true);
    expect(
      generated.matches({ featurePath: "other.feature", stepFile: "s.ts" }, ctx, "f.feature"),
    ).toBe(false);
    expect(generated.matches({ featurePath: "f.feature", stepFile: "s.ts" }, ctx, undefined)).toBe(
      false,
    );
    expect(generated.capture?.({ featurePath: "f.feature" })).toBe("f.feature");
    expect(zero.matches({ featurePath: "f.feature", missingSteps: [] }, ctx, "f.feature")).toBe(
      true,
    );
    expect(zero.matches({ featurePath: "other.feature", missingSteps: [] }, ctx, "f.feature")).toBe(
      false,
    );
    expect(zero.matches({ featurePath: "f.feature", missingSteps: ["x"] }, ctx, "f.feature")).toBe(
      false,
    );
    // Without a capture the sequence must stall, never widen to any feature.
    expect(zero.matches({ featurePath: "f.feature", missingSteps: [] }, ctx, undefined)).toBe(
      false,
    );
  });

  it("create-suite wants a non-default suite whose tag expression SELECTS @tour", () => {
    const rule = eventRule("create-suite");
    expect(rule.matches({ suiteId: "tour", tagExpression: "@tour" }, ctx)).toBe(true);
    expect(rule.matches({ suiteId: "tour", tagExpression: "@tour and not @wip" }, ctx)).toBe(true);
    expect(rule.matches({ suiteId: "tour", tagExpression: "@smoke or @tour" }, ctx)).toBe(true);
    expect(rule.matches({ suiteId: "smoke", tagExpression: "@tour" }, ctx)).toBe(false);
    expect(rule.matches({ suiteId: "regression", tagExpression: "@tour" }, ctx)).toBe(false);
    // A custom suite that does NOT select the authored scenario must not
    // complete the step (PR #31 Codex review) — including tag prefixes, a
    // NEGATED @tour (token present, scenario excluded), and malformed input.
    expect(rule.matches({ suiteId: "nightly", tagExpression: "@regression" }, ctx)).toBe(false);
    expect(rule.matches({ suiteId: "tour", tagExpression: "@tournament" }, ctx)).toBe(false);
    expect(rule.matches({ suiteId: "tour", tagExpression: "not @tour" }, ctx)).toBe(false);
    expect(rule.matches({ suiteId: "tour", tagExpression: "@smoke and not @tour" }, ctx)).toBe(
      false,
    );
    expect(rule.matches({ suiteId: "tour", tagExpression: "@tour and" }, ctx)).toBe(false);
    expect(rule.matches({ suiteId: "tour" }, ctx)).toBe(false);
  });

  it("run-own-test sequence: @tour suite created, THAT suite executed, THAT run passes", () => {
    const [created, executed, passed] = sequenceRules("run-own-test");
    // Rule 1: the @tour suite's creation, capturing its id.
    expect(created.matches({ suiteId: "tour", tagExpression: "@tour" }, ctx)).toBe(true);
    expect(created.matches({ suiteId: "smoke", tagExpression: "@tour" }, ctx)).toBe(false);
    expect(created.matches({ suiteId: "nightly", tagExpression: "@regression" }, ctx)).toBe(false);
    expect(created.matches({ suiteId: "tour", tagExpression: "not @tour" }, ctx)).toBe(false);
    expect(created.capture?.({ suiteId: "tour", tagExpression: "@tour" })).toBe("tour");
    // Rule 2: only THAT suite's execution counts (PR #31 Codex review), and it
    // must carry the runId the final rule keys on.
    expect(executed.matches({ suiteId: "tour", runId: "RUN-1" }, ctx, "tour")).toBe(true);
    expect(executed.matches({ suiteId: "nightly", runId: "RUN-1" }, ctx, "tour")).toBe(false);
    expect(executed.matches({ suiteId: "tour" }, ctx, "tour")).toBe(false);
    expect(executed.matches({ suiteId: "tour", runId: 7 }, ctx, "tour")).toBe(false);
    expect(executed.matches({ suiteId: "tour", runId: "RUN-1" }, ctx, undefined)).toBe(false);
    expect(executed.capture?.({ suiteId: "tour", runId: "RUN-1" })).toBe("RUN-1");
    // Rule 3: only THAT run's passing completes the step.
    expect(passed.matches({ runId: "RUN-1", status: "passed" }, ctx, "RUN-1")).toBe(true);
    expect(passed.matches({ runId: "RUN-2", status: "passed" }, ctx, "RUN-1")).toBe(false);
    expect(passed.matches({ runId: "RUN-1", status: "failed" }, ctx, "RUN-1")).toBe(false);
    // Without a capture the rules must stall, never widen.
    expect(passed.matches({ runId: "RUN-1", status: "passed" }, ctx, undefined)).toBe(false);
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

// The e2e-smoke `@tour` leg consumes these exact constants to prove the tour's
// self-authored cycle runs green against the real runner. These guards pin the
// leg's premise (the gherkin and the createBdd snippet line up) without a spawn.
describe("exported @tour artifacts (e2e premise)", () => {
  it("the gherkin carries @tour and the greeting steps", () => {
    expect(TOUR_GHERKIN_SNIPPET).toContain("@tour");
    expect(TOUR_GHERKIN_SNIPPET).toContain('I enter "Ada" into the name field');
    expect(TOUR_GHERKIN_SNIPPET).toContain('the greeting should say "Hello, Ada!"');
  });

  it("the steps snippet binds When/Then via createBdd and drives the fixture", () => {
    expect(TOUR_STEPS_SNIPPET).toContain("createBdd()");
    expect(TOUR_STEPS_SNIPPET).toMatch(/#name|#greet|#greeting/);
  });
});

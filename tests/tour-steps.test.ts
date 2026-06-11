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
      rule.matches(
        { featurePath: "Specifications/features/UC-002-greet.feature", valid: true },
        ctx,
      ),
    ).toBe(true);
    expect(
      rule.matches(
        { featurePath: "Specifications/features/UC-001-open-example-page.feature", valid: true },
        ctx,
      ),
    ).toBe(false);
    expect(
      rule.matches(
        { featurePath: "Specifications/features/UC-002-greet.feature", valid: false },
        ctx,
      ),
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
    expect(zero.matches({ featurePath: "f.feature", missingSteps: [] }, ctx, "f.feature")).toBe(
      true,
    );
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

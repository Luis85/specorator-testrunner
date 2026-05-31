import { describe, expect, it } from "vitest";
import { computeAutomationStatus } from "../src/domain/policies/use-case-automation-policy";
import type { FeatureSpecification } from "../src/domain/entities/specification";
import type { ExecutionScope, TestRunStatus } from "../src/domain/entities/test-run";
import type { UseCase } from "../src/domain/entities/use-case";

const useCase = (over: Partial<UseCase> = {}): UseCase => ({
  id: "UC-001",
  title: "Demo",
  status: "specified",
  automationStatus: "not-planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: "Use Cases/UC-001 Demo.md",
  ...over,
});

const lastRun = (status: TestRunStatus, scope?: ExecutionScope): UseCase["lastTestRun"] => ({
  runId: "RUN-1",
  status,
  date: "2026-06-01T10:00:00Z",
  scope,
});

const feature = (over: Partial<FeatureSpecification> = {}): FeatureSpecification => ({
  path: "Specifications/features/UC-001.feature",
  useCaseId: "UC-001",
  featureName: "Demo",
  tags: [],
  scenarios: [{ name: "S1", tags: [], steps: [{ keyword: "Given", text: "x" }] }],
  ...over,
});

describe("computeAutomationStatus (ADR-0017 roll-up)", () => {
  it("not-planned when no Features exist", () => {
    expect(computeAutomationStatus(useCase(), [])).toBe("not-planned");
  });

  it("planned when Features exist but the UC has never run", () => {
    expect(computeAutomationStatus(useCase(), [feature()])).toBe("planned");
  });

  it("missing-steps when a Feature has a scenario with no steps", () => {
    const incomplete = feature({ scenarios: [{ name: "S1", tags: [], steps: [] }] });
    expect(computeAutomationStatus(useCase({ lastTestRun: lastRun("passed") }), [incomplete])).toBe(
      "missing-steps",
    );
  });

  it("missing-steps when a Feature declares no scenarios", () => {
    expect(computeAutomationStatus(useCase(), [feature({ scenarios: [] })])).toBe("missing-steps");
  });

  it("passing when the UC has run and the last result passed", () => {
    expect(computeAutomationStatus(useCase({ lastTestRun: lastRun("passed") }), [feature()])).toBe(
      "passing",
    );
  });

  it("stays implemented when only one of several Features was run (ADR-0017, no latest-wins)", () => {
    const f1 = feature({ path: "Specifications/features/UC-001-a.feature" });
    const f2 = feature({ path: "Specifications/features/UC-001-b.feature" });
    // A single feature-scope passing run does not make the whole multi-Feature UC passing.
    expect(
      computeAutomationStatus(useCase({ lastTestRun: lastRun("passed", "feature") }), [f1, f2]),
    ).toBe("implemented");
  });

  it("does not regress an already-passing multi-Feature UC on a single-Feature rerun", () => {
    const f1 = feature({ path: "Specifications/features/UC-001-a.feature" });
    const f2 = feature({ path: "Specifications/features/UC-001-b.feature" });
    // The UC already reached "passing" (e.g. via an earlier UC-wide run); a
    // later successful feature-scope rerun must not drop it back to implemented.
    expect(
      computeAutomationStatus(
        useCase({ automationStatus: "passing", lastTestRun: lastRun("passed", "feature") }),
        [f1, f2],
      ),
    ).toBe("passing");
  });

  it("passing for a multi-Feature UC when a UC-wide run passed", () => {
    const f1 = feature({ path: "Specifications/features/UC-001-a.feature" });
    const f2 = feature({ path: "Specifications/features/UC-001-b.feature" });
    expect(
      computeAutomationStatus(useCase({ lastTestRun: lastRun("passed", "use-case") }), [f1, f2]),
    ).toBe("passing");
  });

  it("failing when the last run failed", () => {
    expect(computeAutomationStatus(useCase({ lastTestRun: lastRun("failed") }), [feature()])).toBe(
      "failing",
    );
  });

  it("failing when the last run errored", () => {
    expect(computeAutomationStatus(useCase({ lastTestRun: lastRun("errored") }), [feature()])).toBe(
      "failing",
    );
  });

  it("implemented when the UC has run but the last result was not a clean pass/fail", () => {
    expect(
      computeAutomationStatus(useCase({ lastTestRun: lastRun("cancelled") }), [feature()]),
    ).toBe("implemented");
  });

  describe("@wip exclusion (Feature granularity)", () => {
    it("excludes a @wip Feature so a lone @wip Feature counts as no Features", () => {
      const wip = feature({ tags: ["@wip"] });
      expect(computeAutomationStatus(useCase(), [wip])).toBe("not-planned");
    });

    it("ignores undefined steps inside a @wip Feature", () => {
      const wipIncomplete = feature({ tags: ["@wip"], scenarios: [] });
      const good = feature({ path: "Specifications/features/UC-001b.feature" });
      // Only the non-@wip Feature counts; it is complete but never run.
      expect(computeAutomationStatus(useCase(), [wipIncomplete, good])).toBe("planned");
    });

    it("matches @wip case-insensitively", () => {
      const wip = feature({ tags: ["@WIP"] });
      expect(computeAutomationStatus(useCase(), [wip])).toBe("not-planned");
    });
  });
});

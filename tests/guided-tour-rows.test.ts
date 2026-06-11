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

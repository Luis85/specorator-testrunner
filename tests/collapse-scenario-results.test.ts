import { describe, expect, it } from "vitest";
import { collapseByScenario } from "../src/application/services/collapse-scenario-results";
import type { ScenarioResult } from "../src/application/ports/report-parser";

const r = (over: Partial<ScenarioResult>): ScenarioResult => ({
  feature: "F",
  featureUri: "features/UC-1.feature",
  scenario: "S",
  status: "passed",
  ...over,
});

describe("collapseByScenario", () => {
  it("collapses N browser results for one scenario to a worst-status verdict", () => {
    const out = collapseByScenario([
      r({ scenarioId: "f;s;;1", status: "passed", durationMs: 10 }),
      r({ scenarioId: "f;s;;1", status: "failed", durationMs: 20, errorMessage: "boom" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("failed");
    expect(out[0].durationMs).toBe(20);
    expect(out[0].errorMessage).toBe("boom");
  });

  it("does NOT merge distinct Scenario Outline rows that share a name", () => {
    const out = collapseByScenario([
      r({ scenario: "Outline", scenarioId: "f;o;;1", status: "passed" }),
      r({ scenario: "Outline", scenarioId: "f;o;;2", status: "failed" }),
      r({ scenario: "Outline", scenarioId: "f;o;;1", status: "passed" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.status)).toEqual(["passed", "failed"]);
  });

  it("falls back to line, then name, when no id is present", () => {
    const out = collapseByScenario([
      r({ scenarioId: undefined, line: 7, status: "passed" }),
      r({ scenarioId: undefined, line: 7, status: "skipped" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("skipped");
  });
});

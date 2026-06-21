import { describe, expect, it } from "vitest";
import type { AutomationStatus, UseCase } from "../src/domain/entities/use-case";
import {
  LOOP_RAIL_STAGES,
  loopCapabilitiesFor,
  projectLoopRail,
  type LoopRailStage,
} from "../src/presentation/views/loop-rail-rows";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const useCase = (over: Partial<UseCase> = {}): UseCase => ({
  id: "UC-001",
  title: "Open Example",
  status: "specified",
  automationStatus: "not-planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: vp("Use Cases/UC-001 Open Example.md"),
  ...over,
});

const stateOf = (uc: UseCase, stage: LoopRailStage): string => {
  const node = projectLoopRail(uc).nodes.find((n) => n.stage === stage);
  if (!node) throw new Error(`no node ${stage}`);
  return node.state;
};

describe("loopCapabilitiesFor", () => {
  it("derives no capabilities for a bare Use Case", () => {
    expect(loopCapabilitiesFor(useCase())).toEqual({
      hasFeature: false,
      stepsDefined: false,
      inSuite: false,
      hasRun: false,
    });
  });

  it("reports a Feature once a feature file exists", () => {
    const caps = loopCapabilitiesFor(
      useCase({ featureFiles: [vp("Features/UC-001-happy.feature")] }),
    );
    expect(caps.hasFeature).toBe(true);
  });

  it("treats missing-steps automation as steps-not-defined even with a Feature", () => {
    const caps = loopCapabilitiesFor(
      useCase({
        featureFiles: [vp("Features/UC-001-happy.feature")],
        automationStatus: "missing-steps",
      }),
    );
    expect(caps.stepsDefined).toBe(false);
  });

  it.each<AutomationStatus>(["implemented", "passing", "failing"])(
    "treats %s automation as steps-defined when a Feature exists",
    (automationStatus) => {
      const caps = loopCapabilitiesFor(
        useCase({ featureFiles: [vp("Features/UC-001-happy.feature")], automationStatus }),
      );
      expect(caps.stepsDefined).toBe(true);
    },
  );

  it("does not report steps-defined without a Feature, even if status moved on", () => {
    // A defensive guard: status alone can't imply steps when there's no Feature.
    const caps = loopCapabilitiesFor(useCase({ automationStatus: "passing" }));
    expect(caps.stepsDefined).toBe(false);
  });

  it("reports membership when the Use Case is in a Suite", () => {
    expect(loopCapabilitiesFor(useCase({ suites: ["SUITE-smoke"] })).inSuite).toBe(true);
  });

  it("reports a run from a recorded last run", () => {
    const caps = loopCapabilitiesFor(
      useCase({
        lastTestRun: { runId: "RUN-1", status: "passed", date: "2026-06-21" },
      }),
    );
    expect(caps.hasRun).toBe(true);
  });

  it("reports a run from recorded evidence", () => {
    expect(loopCapabilitiesFor(useCase({ evidence: [vp("Test Evidence/UC-001.md")] })).hasRun).toBe(
      true,
    );
  });
});

describe("projectLoopRail", () => {
  it("renders the five glossary nodes in pipeline order", () => {
    const rail = projectLoopRail(useCase());
    expect(rail.nodes.map((n) => n.stage)).toEqual([...LOOP_RAIL_STAGES]);
    expect(rail.nodes.map((n) => n.label)).toEqual([
      "Use Case",
      "Feature",
      "Steps",
      "Suite",
      "Run",
    ]);
  });

  it("marks the Use Case done and Feature the current next step for a bare UC", () => {
    const rail = projectLoopRail(useCase());
    expect(stateOf(useCase(), "use-case")).toBe("done");
    expect(rail.currentStage).toBe("feature");
    expect(rail.currentAction).toBe("generate-feature");
    const feature = rail.nodes.find((n) => n.stage === "feature");
    expect(feature?.state).toBe("current");
    expect(feature?.actionLabel).toBe("Generate feature");
  });

  it("only the current node carries an action; later nodes are todo with no action", () => {
    const rail = projectLoopRail(useCase());
    const withAction = rail.nodes.filter((n) => n.action !== null);
    expect(withAction).toHaveLength(1);
    expect(withAction[0]?.stage).toBe("feature");
    const later = rail.nodes.filter((n) => n.state === "todo");
    expect(later.map((n) => n.stage)).toEqual(["steps", "suite", "run"]);
    expect(later.every((n) => n.action === null && n.actionLabel === "")).toBe(true);
  });

  it("advances current to Steps once a Feature exists", () => {
    const uc = useCase({ featureFiles: [vp("Features/UC-001-happy.feature")] });
    const rail = projectLoopRail(uc);
    expect(stateOf(uc, "feature")).toBe("done");
    expect(rail.currentStage).toBe("steps");
    expect(rail.currentAction).toBe("generate-steps");
    expect(rail.nodes.find((n) => n.stage === "steps")?.actionLabel).toBe(
      "Generate step definitions",
    );
  });

  it("advances current to Suite once steps are defined", () => {
    const uc = useCase({
      featureFiles: [vp("Features/UC-001-happy.feature")],
      automationStatus: "implemented",
    });
    const rail = projectLoopRail(uc);
    expect(rail.currentStage).toBe("suite");
    expect(rail.currentAction).toBe("create-suite");
  });

  it("advances current to Run once the Use Case is in a Suite", () => {
    const uc = useCase({
      featureFiles: [vp("Features/UC-001-happy.feature")],
      automationStatus: "implemented",
      suites: ["SUITE-smoke"],
    });
    const rail = projectLoopRail(uc);
    expect(rail.currentStage).toBe("run");
    expect(rail.currentAction).toBe("run");
    expect(rail.nodes.find((n) => n.stage === "run")?.actionLabel).toBe("Run");
  });

  it("closes the loop (no current, no action) once everything is done", () => {
    const uc = useCase({
      featureFiles: [vp("Features/UC-001-happy.feature")],
      automationStatus: "passing",
      suites: ["SUITE-smoke"],
      lastTestRun: { runId: "RUN-1", status: "passed", date: "2026-06-21" },
    });
    const rail = projectLoopRail(uc);
    expect(rail.currentStage).toBeNull();
    expect(rail.currentAction).toBeNull();
    expect(rail.nodes.every((n) => n.state === "done")).toBe(true);
    expect(rail.nodes.every((n) => n.action === null)).toBe(true);
  });

  it("current is the FIRST not-done stage; each node still reflects its own true capability", () => {
    // Already in a Suite (a later stage) but no Feature yet. `current` is the
    // first gap (Feature), but the Suite node reads `done` because the rail tells
    // the truth about each capability the artifact actually has — it never lies
    // a satisfied stage back to todo just because an earlier one is missing.
    const uc = useCase({ suites: ["SUITE-smoke"] });
    const rail = projectLoopRail(uc);
    expect(rail.currentStage).toBe("feature");
    expect(rail.currentAction).toBe("generate-feature");
    expect(rail.nodes.find((n) => n.stage === "suite")?.state).toBe("done");
    // …and only the current node carries an action (the satisfied Suite does not).
    expect(rail.nodes.find((n) => n.stage === "suite")?.action).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { AutomationStatus, UseCase } from "../src/domain/entities/use-case";
import {
  LOOP_RAIL_STAGES,
  loopCapabilitiesFor,
  projectLoopRail,
  type LoopRail,
  type LoopRailStage,
} from "../src/presentation/views/loop-rail-rows";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

/** A recorded passing run, shared by the loop-closing cases. */
const PASSED_RUN = { runId: "RUN-1", status: "passed", date: "2026-06-21" } as const;

/** Asserts the rail has advanced past every required stage (no next action). */
const expectLoopClosed = (rail: LoopRail): void => {
  expect(rail.currentStage).toBeNull();
  expect(rail.currentAction).toBeNull();
};

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
      // Only the RUN-exercised statuses prove the step definitions exist — a
      // Feature can't have recorded a result without its steps in place.
      const caps = loopCapabilitiesFor(
        useCase({ featureFiles: [vp("Features/UC-001-happy.feature")], automationStatus }),
      );
      expect(caps.stepsDefined).toBe(true);
    },
  );

  it("treats `planned` automation as steps-NOT-defined even with a Feature", () => {
    // `planned` ("has Gherkin steps, not yet run") can't distinguish a freshly
    // generated Feature (no stubs) from stubs-generated-but-unrun, so the rail
    // takes the conservative reading and keeps the Generate-steps CTA visible.
    const caps = loopCapabilitiesFor(
      useCase({
        featureFiles: [vp("Features/UC-001-happy.feature")],
        automationStatus: "planned",
      }),
    );
    expect(caps.stepsDefined).toBe(false);
  });

  it("does not report steps-defined without a Feature, even if status moved on", () => {
    // A defensive guard: status alone can't imply steps when there's no Feature.
    const caps = loopCapabilitiesFor(useCase({ automationStatus: "passing" }));
    expect(caps.stepsDefined).toBe(false);
  });

  it("reports membership when the Use Case is in a Suite", () => {
    expect(loopCapabilitiesFor(useCase({ suites: ["SUITE-smoke"] })).inSuite).toBe(true);
  });

  it("reports a run from a recorded last run", () => {
    const caps = loopCapabilitiesFor(useCase({ lastTestRun: PASSED_RUN }));
    expect(caps.hasRun).toBe(true);
  });

  it("reports a run from recorded evidence", () => {
    expect(loopCapabilitiesFor(useCase({ evidence: [vp("Test Evidence/UC-001.md")] })).hasRun).toBe(
      true,
    );
  });

  it("derives feature presence from the supplied count, not the entity's featureFiles", () => {
    // The detail view passes the filename-derived Feature count (ADR-0012) so the
    // rail agrees with the Feature list. A Feature on disk whose forward-link write
    // failed is missing from `featureFiles` yet still counts (Codex review).
    const caps = loopCapabilitiesFor(useCase({ featureFiles: [] }), 1);
    expect(caps.hasFeature).toBe(true);
  });

  it("an explicit zero count overrides a stale featureFiles entry", () => {
    // Defensive inverse: the supplied count is authoritative. If the listing finds
    // no Feature for this UC, a stale `featureFiles` link must not fake one.
    const caps = loopCapabilitiesFor(
      useCase({ featureFiles: [vp("Features/UC-001-happy.feature")] }),
      0,
    );
    expect(caps.hasFeature).toBe(false);
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

  it("advances current to Run once steps are defined — Suite is optional and never blocks", () => {
    // Steps defined but NOT in any Suite (suite membership is by tag and not
    // reflected on the entity). The rail must skip the optional Suite node and
    // make Run the next step, not strand the user on "Create suite".
    const uc = useCase({
      featureFiles: [vp("Features/UC-001-happy.feature")],
      automationStatus: "implemented",
    });
    const rail = projectLoopRail(uc);
    expect(rail.currentStage).toBe("run");
    expect(rail.currentAction).toBe("run");
    expect(rail.nodes.find((n) => n.stage === "run")?.actionLabel).toBe("Run");
    // The optional Suite node is never `current` and never carries an action.
    const suite = rail.nodes.find((n) => n.stage === "suite");
    expect(suite?.state).not.toBe("current");
    expect(suite?.action).toBeNull();
  });

  it("keeps Steps current at `planned` — status can't prove the stubs exist yet", () => {
    // `planned` is reached the instant Generate Feature writes scenarios, before
    // any step-definition stub exists; the rail keeps offering Generate steps
    // rather than Run against undefined steps (it advances once a run records).
    const uc = useCase({
      featureFiles: [vp("Features/UC-001-happy.feature")],
      automationStatus: "planned",
    });
    const rail = projectLoopRail(uc);
    expect(rail.currentStage).toBe("steps");
    expect(rail.currentAction).toBe("generate-steps");
  });

  it("marks the Suite node done when the Use Case lists a suite (informational)", () => {
    const uc = useCase({
      featureFiles: [vp("Features/UC-001-happy.feature")],
      automationStatus: "implemented",
      suites: ["SUITE-smoke"],
    });
    const rail = projectLoopRail(uc);
    expect(rail.nodes.find((n) => n.stage === "suite")?.state).toBe("done");
    expect(rail.currentStage).toBe("run"); // still Run; suite never gates it
  });

  it("closes the loop (no current, no action) once everything is done", () => {
    const rail = projectLoopRail(
      useCase({
        featureFiles: [vp("Features/UC-001-happy.feature")],
        automationStatus: "passing",
        suites: ["SUITE-smoke"],
        lastTestRun: PASSED_RUN,
      }),
    );
    expectLoopClosed(rail);
    expect(rail.nodes.every((n) => n.state === "done")).toBe(true);
    expect(rail.nodes.every((n) => n.action === null)).toBe(true);
  });

  it("closes the required loop even without a Suite (Suite is optional)", () => {
    // no `suites` — membership is by tag and not reflected on the entity
    const rail = projectLoopRail(
      useCase({
        featureFiles: [vp("Features/UC-001-happy.feature")],
        automationStatus: "passing",
        lastTestRun: PASSED_RUN,
      }),
    );
    expectLoopClosed(rail);
    // The optional Suite node reads not-done but never reopens the loop.
    expect(rail.nodes.find((n) => n.stage === "suite")?.state).toBe("todo");
  });

  it("advances off Feature when the supplied count is positive despite empty featureFiles", () => {
    // The rail threads the filename-derived count: a UC with a Feature on disk but
    // no forward link still shows Feature done and Steps as the next step.
    const uc = useCase({ featureFiles: [], automationStatus: "missing-steps" });
    const rail = projectLoopRail(uc, 1);
    expect(stateOf(uc, "feature")).not.toBe("done"); // entity-only projection still reads no Feature
    expect(rail.nodes.find((n) => n.stage === "feature")?.state).toBe("done");
    expect(rail.currentStage).toBe("steps");
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

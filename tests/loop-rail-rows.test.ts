import { describe, expect, it } from "vitest";
import type { UseCase } from "../src/domain/entities/use-case";
import {
  LOOP_RAIL_STAGES,
  loopCapabilitiesFor,
  projectLoopRail,
  type LoopRail,
  type LoopRailFacts,
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

/**
 * The two facts the detail view supplies (the entity can't give them reliably):
 * how many Features the filename listing found, and whether their step definitions
 * all exist. Both default to the "nothing yet" floor.
 */
const facts = (over: Partial<LoopRailFacts> = {}): LoopRailFacts => ({
  featureCount: 0,
  stepsDefined: false,
  ...over,
});

/** A UC that owns one Feature whose step definitions are all written. */
const STEPS_READY: LoopRailFacts = { featureCount: 1, stepsDefined: true };

const stateOf = (uc: UseCase, f: LoopRailFacts, stage: LoopRailStage): string => {
  const node = projectLoopRail(uc, f).nodes.find((n) => n.stage === stage);
  if (!node) throw new Error(`no node ${stage}`);
  return node.state;
};

describe("loopCapabilitiesFor", () => {
  it("derives no capabilities for a bare Use Case with no facts", () => {
    expect(loopCapabilitiesFor(useCase(), facts())).toEqual({
      hasFeature: false,
      stepsDefined: false,
      inSuite: false,
      hasRun: false,
    });
  });

  it("reports a Feature once the listing found one", () => {
    expect(loopCapabilitiesFor(useCase(), facts({ featureCount: 1 })).hasFeature).toBe(true);
  });

  it("reports steps-defined only when a Feature exists AND the fact is set", () => {
    expect(
      loopCapabilitiesFor(useCase(), facts({ featureCount: 1, stepsDefined: true })).stepsDefined,
    ).toBe(true);
  });

  it("never reports steps-defined without a Feature, even if the fact is set", () => {
    // Defensive guard: a steps-defined signal with no Feature can't be trusted.
    expect(
      loopCapabilitiesFor(useCase(), facts({ featureCount: 0, stepsDefined: true })).stepsDefined,
    ).toBe(false);
  });

  it("treats steps as NOT defined when the coverage fact is false", () => {
    expect(
      loopCapabilitiesFor(useCase(), facts({ featureCount: 1, stepsDefined: false })).stepsDefined,
    ).toBe(false);
  });

  it("reports membership when the Use Case is in a Suite", () => {
    expect(loopCapabilitiesFor(useCase({ suites: ["SUITE-smoke"] }), facts()).inSuite).toBe(true);
  });

  it("reports a run from a recorded last run", () => {
    expect(loopCapabilitiesFor(useCase({ lastTestRun: PASSED_RUN }), facts()).hasRun).toBe(true);
  });

  it("reports a run from recorded evidence", () => {
    expect(
      loopCapabilitiesFor(useCase({ evidence: [vp("Test Evidence/UC-001.md")] }), facts()).hasRun,
    ).toBe(true);
  });
});

describe("projectLoopRail", () => {
  it("renders the five glossary nodes in pipeline order", () => {
    const rail = projectLoopRail(useCase(), facts());
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
    const rail = projectLoopRail(useCase(), facts());
    expect(stateOf(useCase(), facts(), "use-case")).toBe("done");
    expect(rail.currentStage).toBe("feature");
    expect(rail.currentAction).toBe("generate-feature");
    const feature = rail.nodes.find((n) => n.stage === "feature");
    expect(feature?.state).toBe("current");
    expect(feature?.actionLabel).toBe("Generate feature");
  });

  it("only the current node carries an action; later nodes are todo with no action", () => {
    const rail = projectLoopRail(useCase(), facts());
    const withAction = rail.nodes.filter((n) => n.action !== null);
    expect(withAction).toHaveLength(1);
    expect(withAction[0]?.stage).toBe("feature");
    const later = rail.nodes.filter((n) => n.state === "todo");
    expect(later.map((n) => n.stage)).toEqual(["steps", "suite", "run"]);
    expect(later.every((n) => n.action === null && n.actionLabel === "")).toBe(true);
  });

  it("advances current to Steps once a Feature exists but its steps aren't defined", () => {
    const uc = useCase();
    const f = facts({ featureCount: 1, stepsDefined: false });
    const rail = projectLoopRail(uc, f);
    expect(stateOf(uc, f, "feature")).toBe("done");
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
    const rail = projectLoopRail(useCase(), STEPS_READY);
    expect(rail.currentStage).toBe("run");
    expect(rail.currentAction).toBe("run");
    expect(rail.nodes.find((n) => n.stage === "run")?.actionLabel).toBe("Run");
    const suite = rail.nodes.find((n) => n.stage === "suite");
    expect(suite?.state).not.toBe("current");
    expect(suite?.action).toBeNull();
  });

  it("keeps Steps current while step definitions are missing, even with a recorded run", () => {
    // A run can be recorded against undefined steps (it imports as failed), so a
    // recorded run does NOT prove the stubs exist. The rail offers Generate steps
    // as the recovery action even though the Run node reads done.
    const uc = useCase({ lastTestRun: { runId: "RUN-2", status: "failed", date: "2026-06-21" } });
    const f = facts({ featureCount: 1, stepsDefined: false });
    const rail = projectLoopRail(uc, f);
    expect(rail.currentStage).toBe("steps");
    expect(rail.currentAction).toBe("generate-steps");
    expect(rail.nodes.find((n) => n.stage === "run")?.state).toBe("done");
  });

  it("marks the Suite node done when the Use Case lists a suite (informational)", () => {
    const rail = projectLoopRail(useCase({ suites: ["SUITE-smoke"] }), STEPS_READY);
    expect(rail.nodes.find((n) => n.stage === "suite")?.state).toBe("done");
    expect(rail.currentStage).toBe("run"); // still Run; suite never gates it
  });

  it("closes the loop (no current, no action) once everything is done", () => {
    const rail = projectLoopRail(
      useCase({ suites: ["SUITE-smoke"], lastTestRun: PASSED_RUN }),
      STEPS_READY,
    );
    expectLoopClosed(rail);
    expect(rail.nodes.every((n) => n.state === "done")).toBe(true);
    expect(rail.nodes.every((n) => n.action === null)).toBe(true);
  });

  it("closes the required loop even without a Suite (Suite is optional)", () => {
    // no `suites` — membership is by tag and not reflected on the entity
    const rail = projectLoopRail(useCase({ lastTestRun: PASSED_RUN }), STEPS_READY);
    expectLoopClosed(rail);
    // The optional Suite node reads not-done but never reopens the loop.
    expect(rail.nodes.find((n) => n.stage === "suite")?.state).toBe("todo");
  });

  it("current is the FIRST not-done stage; each node still reflects its own true capability", () => {
    // Already in a Suite (a later stage) but no Feature yet. `current` is the first
    // gap (Feature), but the Suite node reads `done` because the rail tells the
    // truth about each capability the artifact actually has.
    const uc = useCase({ suites: ["SUITE-smoke"] });
    const rail = projectLoopRail(uc, facts());
    expect(rail.currentStage).toBe("feature");
    expect(rail.currentAction).toBe("generate-feature");
    expect(rail.nodes.find((n) => n.stage === "suite")?.state).toBe("done");
    expect(rail.nodes.find((n) => n.stage === "suite")?.action).toBeNull();
  });
});

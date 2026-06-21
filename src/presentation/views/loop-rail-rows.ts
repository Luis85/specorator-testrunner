import type { AutomationStatus, UseCase } from "../../domain/entities/use-case";

/**
 * The loop rail (WS-C1, 03-§3.1 / R1): the forward-momentum spine that turns the
 * authoring loop's "create → dead-end → go find the next thing" into a guided
 * pipeline. It is a pure projection of one Use Case's current capabilities to an
 * ordered five-node model — Use Case · Feature · Steps · Suite · Run — so the
 * view stays a thin render over a unit-tested logic core (ADR-0029).
 *
 * The brand `--spec-accent` highlights only the CURRENT node's live button
 * (chrome), never a run/automation status colour (03-§3.7 token discipline).
 */

/** The five ordered stages of the authoring loop, left to right. */
export const LOOP_RAIL_STAGES = ["use-case", "feature", "steps", "suite", "run"] as const;

/** One stage of the loop. */
export type LoopRailStage = (typeof LOOP_RAIL_STAGES)[number];

/**
 * A node's state in the spine:
 * - `done` — the artifact already has this capability;
 * - `current` — the next actionable step (gets the live `--spec-accent` button);
 * - `todo` — a later step, not yet reachable.
 */
export type LoopNodeState = "done" | "current" | "todo";

/**
 * The action the `current` node offers — a discriminated union the view maps to
 * an existing service/command call (no run/generate logic is reinvented here):
 * - `generate-feature` → open the generate-Feature flow;
 * - `generate-steps` → generate step definitions for the Use Case's Feature(s);
 * - `create-suite` → open the create-Suite flow;
 * - `run` → launch a Use Case-scoped run.
 *
 * The terminal `run` node, once done, offers no further action (the loop closes
 * with Evidence, which is reachable from the run surfaces).
 */
export type LoopRailAction = "generate-feature" | "generate-steps" | "create-suite" | "run" | null;

/** One node of the rendered spine. */
export interface LoopRailNode {
  stage: LoopRailStage;
  /** The node's short label (glossary-correct). */
  label: string;
  state: LoopNodeState;
  /** The action this node offers; non-null only on the `current` node. */
  action: LoopRailAction;
  /** The CTA text for the `current` node's live button (empty otherwise). */
  actionLabel: string;
}

/** The whole rail: the ordered nodes plus the resolved next action (if any). */
export interface LoopRail {
  nodes: LoopRailNode[];
  /** The current node's stage, or null when every stage is done. */
  currentStage: LoopRailStage | null;
  /** The current node's action, or null when every stage is done. */
  currentAction: LoopRailAction;
}

const NODE_LABEL: Record<LoopRailStage, string> = {
  "use-case": "Use Case",
  feature: "Feature",
  steps: "Steps",
  suite: "Suite",
  run: "Run",
};

const ACTION_LABEL: Record<Exclude<LoopRailAction, null>, string> = {
  "generate-feature": "Generate feature",
  "generate-steps": "Generate step definitions",
  "create-suite": "Create suite",
  run: "Run",
};

/** The action a given (current) stage offers. The Use Case node is always done. */
const STAGE_ACTION: Record<LoopRailStage, LoopRailAction> = {
  "use-case": null,
  feature: "generate-feature",
  steps: "generate-steps",
  suite: "create-suite",
  run: "run",
};

/**
 * Automation statuses that prove the Use Case's step definitions exist: once a
 * Feature's steps are implemented (or have run), the automation roll-up leaves
 * `missing-steps` behind. `not-planned`/`planned`/`missing-steps` mean steps are
 * still undefined (US-057, ADR-0017).
 */
const STEPS_DEFINED_STATUSES: ReadonlySet<AutomationStatus> = new Set<AutomationStatus>([
  "implemented",
  "passing",
  "failing",
]);

/**
 * The Use Case's current loop capabilities, derived from the entity alone (no
 * I/O): does it have ≥1 Feature, are its steps defined, is it in a Suite, has it
 * run? A separate input shape so the projection is trivially unit-testable and
 * the view passes exactly what it already holds.
 */
export interface LoopCapabilities {
  hasFeature: boolean;
  stepsDefined: boolean;
  inSuite: boolean;
  hasRun: boolean;
}

/**
 * Derives the loop capabilities from a Use Case. Steps are "defined" only when
 * the Use Case actually has a Feature AND its automation status has moved past
 * `missing-steps`; a run counts when there is a recorded last run or evidence
 * (the loop's last hop). Pure.
 */
export const loopCapabilitiesFor = (useCase: UseCase): LoopCapabilities => {
  const hasFeature = useCase.featureFiles.length > 0;
  return {
    hasFeature,
    stepsDefined: hasFeature && STEPS_DEFINED_STATUSES.has(useCase.automationStatus),
    inSuite: useCase.suites.length > 0,
    hasRun: useCase.lastTestRun !== undefined || useCase.evidence.length > 0,
  };
};

/** Whether a given stage's capability is satisfied. The Use Case always exists. */
const stageDone = (stage: LoopRailStage, caps: LoopCapabilities): boolean => {
  switch (stage) {
    case "use-case":
      return true;
    case "feature":
      return caps.hasFeature;
    case "steps":
      return caps.stepsDefined;
    case "suite":
      return caps.inSuite;
    case "run":
      return caps.hasRun;
  }
};

/**
 * The loop rail for a Use Case: the ordered five-node spine with each node marked
 * `done` / `current` / `todo`, and the `current` node carrying the next action.
 *
 * `current` is the FIRST not-done stage (the next obvious step); every later
 * stage is `todo`. A fully-complete loop has no current node and no action — the
 * spine reads all-done. Pure: derives entirely from the Use Case entity.
 */
export const projectLoopRail = (useCase: UseCase): LoopRail => {
  const caps = loopCapabilitiesFor(useCase);
  const doneByStage = LOOP_RAIL_STAGES.map((stage) => stageDone(stage, caps));
  const currentIndex = doneByStage.findIndex((done) => !done);

  const nodes: LoopRailNode[] = LOOP_RAIL_STAGES.map((stage, index) => {
    const isCurrent = index === currentIndex;
    const state: LoopNodeState = doneByStage[index] ? "done" : isCurrent ? "current" : "todo";
    const action = isCurrent ? STAGE_ACTION[stage] : null;
    return {
      stage,
      label: NODE_LABEL[stage],
      state,
      action,
      actionLabel: action ? ACTION_LABEL[action] : "",
    };
  });

  const currentStage = currentIndex === -1 ? null : LOOP_RAIL_STAGES[currentIndex];
  const currentAction = currentStage ? STAGE_ACTION[currentStage] : null;
  return { nodes, currentStage, currentAction };
};

/** The DOM class the rail strip carries (styles.css `.spec-loop-rail`). */
const LOOP_RAIL_CLASS = "spec-loop-rail";

/**
 * The single thin DOM writer for the loop rail — the projection above stays pure
 * and unit-tested; this writes its model into a connected `spec-*` strip and
 * wires the CURRENT node's live `--spec-accent` button to `onAction` (the view
 * maps each {@link LoopRailAction} to an existing service/command — no
 * run/generate logic is reinvented here). Node state drives `data-state`; the
 * current node's button is the only interactive element, keeping the brand
 * accent on chrome, never on a status (03-§3.7).
 *
 * Replaces the container's content so an event-driven re-render rebuilds cleanly.
 */
export const renderLoopRail = (
  container: HTMLElement,
  rail: LoopRail,
  onAction: (action: Exclude<LoopRailAction, null>) => void,
): void => {
  container.empty();
  container.addClass(LOOP_RAIL_CLASS);
  const strip = container.createDiv({
    cls: "spec-loop-rail-strip",
    attr: { role: "list", "aria-label": "Authoring loop progress" },
  });

  rail.nodes.forEach((node, index) => {
    if (index > 0) {
      // A connector segment between nodes draws the spine; it carries the LEFT
      // node's state so a completed run of the spine reads as one solid line.
      const connector = strip.createDiv({ cls: "spec-loop-rail-connector" });
      connector.dataset.state = rail.nodes[index - 1].state;
    }
    const nodeEl = strip.createDiv({
      cls: "spec-loop-rail-node",
      attr: { role: "listitem" },
    });
    nodeEl.dataset.state = node.state;
    nodeEl.dataset.stage = node.stage;

    nodeEl.createSpan({ cls: "spec-loop-rail-label", text: node.label });

    if (node.action !== null) {
      const action = node.action;
      nodeEl
        .createEl("button", {
          cls: "spec-loop-rail-action",
          text: node.actionLabel,
          attr: { "aria-label": `${node.actionLabel} — the next step for this Use Case` },
        })
        .addEventListener("click", () => onAction(action));
    }
  });
};

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LoopRailBar from "../../src/presentation/vue/use-case-detail/LoopRailBar.vue";
import type { LoopRail } from "../../src/presentation/views/loop-rail-rows";

const rail: LoopRail = {
  currentStage: "feature",
  currentAction: "generate-feature",
  nodes: [
    { stage: "use-case", label: "Use Case", state: "done", action: null, actionLabel: "" },
    {
      stage: "feature",
      label: "Feature",
      state: "current",
      action: "generate-feature",
      actionLabel: "Generate feature",
    },
    { stage: "steps", label: "Steps", state: "todo", action: null, actionLabel: "" },
    { stage: "suite", label: "Suite", state: "todo", action: null, actionLabel: "" },
    { stage: "run", label: "Run", state: "todo", action: null, actionLabel: "" },
  ],
};

describe("LoopRailBar", () => {
  it("renders the five nodes with connectors carrying the left node's state", () => {
    const w = mount(LoopRailBar, { props: { rail } });
    const nodes = w.findAll(".spec-loop-rail-node");
    expect(nodes).toHaveLength(5);
    expect(nodes.map((n) => n.attributes("data-state"))).toEqual([
      "done",
      "current",
      "todo",
      "todo",
      "todo",
    ]);
    const connectors = w.findAll(".spec-loop-rail-connector");
    expect(connectors).toHaveLength(4);
    // The first connector carries the left (use-case, done) node's state.
    expect(connectors[0].attributes("data-state")).toBe("done");
  });

  it("shows the action button only on the current node and emits on click", async () => {
    const w = mount(LoopRailBar, { props: { rail } });
    const buttons = w.findAll(".spec-loop-rail-action");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].text()).toBe("Generate feature");
    await buttons[0].trigger("click");
    expect(w.emitted("action")).toEqual([["generate-feature"]]);
  });
});

import { describe, expect, it } from "vitest";

import {
  type ConfirmActionConfig,
  initialDirective,
  onClick,
  onDisarm,
} from "../src/presentation/views/confirm-action-state";

const benign: ConfirmActionConfig = {
  idleLabel: "Remove environment",
  armedLabel: "Remove — click again to confirm",
  destructiveWhenIdle: false,
};

const alwaysDangerous: ConfirmActionConfig = {
  idleLabel: "Reset",
  armedLabel: "Reset — click again to confirm",
  destructiveWhenIdle: true,
};

describe("initialDirective()", () => {
  it("rests on the idle label, never executing, never timing", () => {
    expect(initialDirective(benign)).toEqual({
      label: "Remove environment",
      destructive: false,
      execute: false,
      startDisarmTimer: false,
    });
  });

  it("is destructive at rest when the action is always dangerous", () => {
    expect(initialDirective(alwaysDangerous).destructive).toBe(true);
  });
});

describe("onClick()", () => {
  it("arms (not executes) on the first click and starts the disarm timer", () => {
    const { phase, directive } = onClick("idle", benign);
    expect(phase).toBe("armed");
    expect(directive).toEqual({
      label: "Remove — click again to confirm",
      destructive: true,
      execute: false,
      startDisarmTimer: true,
    });
  });

  it("styles destructive on arm even when benign at rest", () => {
    expect(onClick("idle", benign).directive.destructive).toBe(true);
  });

  it("executes on the second click and returns to idle", () => {
    const { phase, directive } = onClick("armed", benign);
    expect(phase).toBe("idle");
    expect(directive.execute).toBe(true);
    expect(directive.label).toBe("Remove environment");
    expect(directive.startDisarmTimer).toBe(false);
  });

  it("keeps the destructive style after executing an always-dangerous action", () => {
    expect(onClick("armed", alwaysDangerous).directive.destructive).toBe(true);
  });

  it("drops the destructive style after executing a benign-at-rest action", () => {
    expect(onClick("armed", benign).directive.destructive).toBe(false);
  });

  it("is a pure round-trip: idle → armed → idle returns the resting directive", () => {
    const armed = onClick("idle", benign);
    const back = onClick(armed.phase, benign);
    expect(back.phase).toBe("idle");
    expect(back.directive.label).toBe(initialDirective(benign).label);
  });
});

describe("onDisarm()", () => {
  it("returns to idle with the resting directive (no execute)", () => {
    const { phase, directive } = onDisarm(benign);
    expect(phase).toBe("idle");
    expect(directive).toEqual(initialDirective(benign));
    expect(directive.execute).toBe(false);
  });

  it("preserves the always-dangerous resting style when disarming", () => {
    expect(onDisarm(alwaysDangerous).directive.destructive).toBe(true);
  });
});

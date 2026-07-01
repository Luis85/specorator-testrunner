import { describe, expect, it, vi } from "vitest";
import { PersistedLeafState } from "../../src/presentation/vue/persisted-leaf-state";

describe("PersistedLeafState", () => {
  it("returns the initial value without saving", () => {
    const save = vi.fn();
    const state = new PersistedLeafState("overview", save);
    expect(state.get()).toBe("overview");
    expect(save).not.toHaveBeenCalled();
  });

  it("set() stores a new value and requests a layout save", () => {
    const save = vi.fn();
    const state = new PersistedLeafState("overview", save);
    state.set("build");
    expect(state.get()).toBe("build");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("set() is a no-op (no redundant save) when the value is unchanged", () => {
    const save = vi.fn();
    const state = new PersistedLeafState("overview", save);
    state.set("overview");
    expect(save).not.toHaveBeenCalled();
  });

  it("restore() updates the value WITHOUT saving and reports the change", () => {
    const save = vi.fn();
    const state = new PersistedLeafState("overview", save);
    expect(state.restore("review")).toBe(true);
    expect(state.get()).toBe("review");
    expect(save).not.toHaveBeenCalled();
  });

  it("restore() reports no change (and doesn't save) for the same value", () => {
    const save = vi.fn();
    const state = new PersistedLeafState("overview", save);
    expect(state.restore("overview")).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

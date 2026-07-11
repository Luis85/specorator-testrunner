// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmButton from "../../src/presentation/vue/ConfirmButton.vue";
import type { ConfirmActionConfig } from "../../src/presentation/views/confirm-action-state";

const config = (over: Partial<ConfirmActionConfig> = {}): ConfirmActionConfig => ({
  idleLabel: "Delete",
  armedLabel: "Delete — click again to confirm",
  idleAriaLabel: "Delete PRD PRD-003",
  armedAriaLabel: "Delete PRD PRD-003 — click again to confirm",
  destructiveWhenIdle: false,
  ...over,
});

const mountBtn = (props: Record<string, unknown> = {}) =>
  mount(ConfirmButton, {
    props: { config: config(), buttonClass: "e2e-test-hub-link-button", ...props },
  });

// Mount and arm (the first click) — the shared prelude of the armed-state tests.
async function armed(props: Record<string, unknown> = {}): Promise<ReturnType<typeof mountBtn>> {
  const w = mountBtn(props);
  await w.get("button").trigger("click");
  return w;
}

// Assert the button is back at its resting (idle) directive.
const expectIdle = (w: ReturnType<typeof mountBtn>): void => {
  const btn = w.get("button");
  expect(btn.text()).toBe("Delete");
  expect(btn.classes()).not.toContain("mod-warning");
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ConfirmButton", () => {
  it("renders the idle directive (label, aria, no warning) at rest", () => {
    const w = mountBtn();
    const btn = w.get("button");
    expect(btn.text()).toBe("Delete");
    expect(btn.attributes("aria-label")).toBe("Delete PRD PRD-003");
    expect(btn.classes()).toContain("e2e-test-hub-link-button");
    expect(btn.classes()).not.toContain("mod-warning");
  });

  it("styles destructive from the start when destructiveWhenIdle", () => {
    const w = mountBtn({ config: config({ destructiveWhenIdle: true }) });
    expect(w.get("button").classes()).toContain("mod-warning");
  });

  it("arms on the first click without confirming", async () => {
    const w = await armed();
    const btn = w.get("button");
    expect(btn.text()).toBe("Delete — click again to confirm");
    expect(btn.attributes("aria-label")).toBe("Delete PRD PRD-003 — click again to confirm");
    expect(btn.classes()).toContain("mod-warning");
    expect(w.emitted("confirm")).toBeUndefined();
  });

  it("confirms on the second click and returns to idle", async () => {
    const w = await armed();
    await w.get("button").trigger("click");
    expect(w.emitted("confirm")).toHaveLength(1);
    expectIdle(w);
  });

  it("disarms on blur when disarmOnBlur is set", async () => {
    const w = await armed({ disarmOnBlur: true });
    expect(w.get("button").classes()).toContain("mod-warning");
    await w.get("button").trigger("blur");
    expectIdle(w);
  });

  it("does NOT disarm on blur by default", async () => {
    const w = await armed();
    await w.get("button").trigger("blur");
    expect(w.get("button").classes()).toContain("mod-warning");
  });

  it("auto-disarms after the disarm window elapses", async () => {
    vi.useFakeTimers();
    const w = await armed({ disarmMs: 4000 });
    expect(w.get("button").classes()).toContain("mod-warning");

    vi.advanceTimersByTime(4000);
    await w.vm.$nextTick();
    expectIdle(w);
  });

  it("clears a pending disarm timer on unmount (no late fire)", async () => {
    vi.useFakeTimers();
    const w = await armed();
    w.unmount();
    // If the timer weren't cleared, this would fire its disarm callback against
    // the torn-down component; the test simply asserts no throw.
    expect(() => vi.advanceTimersByTime(4000)).not.toThrow();
  });
});

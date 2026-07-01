// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import Imperative from "../../src/presentation/vue/Imperative.vue";

describe("Imperative", () => {
  it("paints synchronously into a fresh child", async () => {
    const wrapper = mount(Imperative, {
      props: {
        paint: (el: HTMLElement) => {
          el.textContent = "hello";
        },
      },
    });
    await nextTick();
    expect(wrapper.text()).toBe("hello");
  });

  it("repaints when the paint closure changes", async () => {
    const wrapper = mount(Imperative, {
      props: {
        paint: (el: HTMLElement) => {
          el.textContent = "first";
        },
      },
    });
    await nextTick();
    await wrapper.setProps({
      paint: (el: HTMLElement) => {
        el.textContent = "second";
      },
    });
    await nextTick();
    expect(wrapper.text()).toBe("second");
  });

  it("drops a stale ASYNC paint that resolves after a newer repaint", async () => {
    let capturedEl!: HTMLElement;
    let resolveStale!: () => void;
    // Models an async body writer: it captures the element it was given and writes
    // to it only once its (mock) service read resolves.
    const stalePaint = (el: HTMLElement): void => {
      capturedEl = el;
      void new Promise<void>((resolve) => {
        resolveStale = resolve;
      }).then(() => {
        el.textContent = "STALE";
      });
    };
    const freshPaint = (el: HTMLElement): void => {
      el.textContent = "FRESH";
    };

    const wrapper = mount(Imperative, { props: { paint: stalePaint } });
    await nextTick();

    // A newer repaint swaps in a fresh child before the stale paint resolves.
    await wrapper.setProps({ paint: freshPaint });
    await nextTick();

    resolveStale();
    await flushPromises();

    // The stale write landed in the now-detached child, not the live host.
    expect(wrapper.text()).toBe("FRESH");
    expect(capturedEl.isConnected).toBe(false);
  });

  it("reports emptiness so a slot can collapse (:empty equivalent)", async () => {
    // A painter that renders nothing (recent-runs before init, dismissed rail).
    const wrapper = mount(Imperative, { props: { paint: () => undefined } });
    await nextTick();
    const empty = wrapper.emitted("empty");
    expect(empty?.at(-1)).toEqual([true]);
  });

  it("reports non-empty when the painter writes content", async () => {
    const wrapper = mount(Imperative, {
      props: {
        paint: (el: HTMLElement) => {
          el.appendChild(document.createElement("p"));
        },
      },
    });
    await nextTick();
    expect(wrapper.emitted("empty")?.at(-1)).toEqual([false]);
  });

  it("re-reports non-empty once an async painter writes later", async () => {
    let resolvePaint!: () => void;
    const asyncPaint = (el: HTMLElement): void => {
      void new Promise<void>((resolve) => {
        resolvePaint = resolve;
      }).then(() => {
        el.appendChild(document.createElement("p"));
      });
    };
    const wrapper = mount(Imperative, { props: { paint: asyncPaint } });
    await nextTick();
    // Synchronously empty (the read is still pending) → collapsed.
    expect(wrapper.emitted("empty")?.at(-1)).toEqual([true]);

    resolvePaint();
    await flushPromises();
    // The MutationObserver saw the late write → reports non-empty.
    expect(wrapper.emitted("empty")?.at(-1)).toEqual([false]);
  });
});

// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import GuidedTourApp from "../../src/presentation/vue/guided-tour/GuidedTourApp.vue";
import { GUIDED_TOUR_DEPS } from "../../src/presentation/vue/guided-tour/guided-tour-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import type { GuidedTourViewDeps } from "../../src/presentation/views/guided-tour-view";
import type { DomainEvent } from "../../src/domain/events/domain-event";

const activeState = () => ({
  steps: [
    {
      definition: {
        id: "author-uc",
        title: "Author a Use Case",
        teach: "Create your first Use Case.",
        skippable: true,
        completion: { kind: "auto" },
      },
      status: "active",
    },
  ],
  completed: false,
  dismissed: false,
});

const doneState = () => ({ steps: activeState().steps, completed: true, dismissed: false });

function setup() {
  let current: unknown = activeState();
  const bus = new InMemoryEventBus();
  const tour = {
    getState: vi.fn(() => current),
    markDone: vi.fn(),
    skip: vi.fn(),
    restart: vi.fn(),
    dismiss: vi.fn(),
  };
  const deps = { tour, eventBus: bus } as unknown as GuidedTourViewDeps;
  const wrapper = mount(GuidedTourApp, {
    global: { provide: { [GUIDED_TOUR_DEPS as symbol]: deps } },
  });
  return { wrapper, bus, tour, setState: (s: unknown) => (current = s) };
}

describe("GuidedTourApp", () => {
  it("renders the projected tour state", () => {
    const { wrapper } = setup();
    expect(wrapper.find(".e2e-test-hub-tour-progress").text()).toBe("0 of 1 steps done");
    expect(wrapper.find(".e2e-test-hub-tour-step-title").text()).toBe("→ 1. Author a Use Case");
  });

  it("re-projects on a subscribed tour event", async () => {
    const { wrapper, bus, setState } = setup();
    setState(doneState());
    await bus.publish({ type: "tour.completed" } as unknown as DomainEvent);
    await flushPromises();
    // The completed state swaps the hint for the done message.
    expect(wrapper.text()).toContain("built and ran your own test");
  });

  it("skips a step through the tour service", async () => {
    const { wrapper, tour } = setup();
    await wrapper.get('button[aria-label="Skip step 1"]').trigger("click");
    expect(tour.skip).toHaveBeenCalledWith("author-uc");
  });
});

// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { useEventBus } from "../../src/presentation/vue/use-event-bus";
import type { EventBus } from "../../src/shared/event-bus/event-bus";
import type { DomainEvent } from "../../src/domain/events/domain-event";

/** A trivial host that binds useEventBus to the injected bus + load spy. */
const Harness = defineComponent({
  props: {
    bus: { type: Object, required: true },
    load: { type: Function, required: true },
  },
  setup(props) {
    useEventBus(props.bus as EventBus, ["usecase.updated"], props.load as () => void);
    return () => h("div");
  },
});

// The bus only reads `event.type`; the rest of the envelope is irrelevant here.
const event = { type: "usecase.updated" } as unknown as DomainEvent;

describe("useEventBus", () => {
  it("loads once on mount", async () => {
    const load = vi.fn();
    mount(Harness, { props: { bus: new InMemoryEventBus(), load } });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-loads on a subscribed domain event", async () => {
    const bus = new InMemoryEventBus();
    const load = vi.fn();
    mount(Harness, { props: { bus, load } });
    await flushPromises();

    await bus.publish(event);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes on unmount so later events do not load", async () => {
    const bus = new InMemoryEventBus();
    const load = vi.fn();
    const wrapper = mount(Harness, { props: { bus, load } });
    await flushPromises();

    wrapper.unmount();
    await bus.publish(event);
    await flushPromises();
    // Only the initial mount load ran; nothing after unmount.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not load on an event type it did not subscribe to", async () => {
    const bus = new InMemoryEventBus();
    const load = vi.fn();
    mount(Harness, { props: { bus, load } });
    await flushPromises();

    await bus.publish({ type: "prd.created" } as unknown as DomainEvent);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

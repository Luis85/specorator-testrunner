import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../src/shared/event-bus/event-bus";
import { createEvent } from "../src/shared/event-bus/create-event";

describe("InMemoryEventBus", () => {
  it("delivers events to subscribers of the matching type", async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe("settings.updated", (event) => {
      seen.push(event.id);
    });
    const event = createEvent("settings.updated", { changedFields: [] });
    await bus.publish(event);
    expect(seen).toEqual([event.id]);
  });

  it("does not deliver to subscribers of other types", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe("settings.reset", handler);
    await bus.publish(createEvent("settings.updated", { changedFields: [] }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("suite.created", handler);
    unsubscribe();
    await bus.publish(
      createEvent("suite.created", {
        suiteId: "s-1",
        name: "Suite",
        path: "Test Suites/Suite.md",
        tagExpression: "@suite",
      }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("still delivers to remaining subscribers when the error callback itself throws (A7)", async () => {
    const bus = new InMemoryEventBus(() => {
      throw new Error("error callback is broken too");
    });
    const good = vi.fn();
    bus.subscribe("suite.created", () => {
      throw new Error("bad subscriber");
    });
    bus.subscribe("suite.created", good);
    await bus.publish(
      createEvent("suite.created", {
        suiteId: "s-1",
        name: "Suite",
        path: "Test Suites/Suite.md",
        tagExpression: "@suite",
      }),
    );
    expect(good).toHaveBeenCalledOnce();
  });

  it("isolates a throwing handler so others still run", async () => {
    const onError = vi.fn();
    const bus = new InMemoryEventBus(onError);
    const good = vi.fn();
    bus.subscribe("suite.created", () => {
      throw new Error("bad subscriber");
    });
    bus.subscribe("suite.created", good);
    await bus.publish(
      createEvent("suite.created", {
        suiteId: "s-1",
        name: "Suite",
        path: "Test Suites/Suite.md",
        tagExpression: "@suite",
      }),
    );
    expect(good).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});

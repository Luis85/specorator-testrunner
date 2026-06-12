import { describe, expect, it } from "vitest";
import { LiveRefresh } from "../src/presentation/views/live-refresh";
import { InMemoryEventBus } from "../src/shared/event-bus/event-bus";
import { createEvent } from "../src/shared/event-bus/create-event";

const evidencePayload = {
  runId: "RUN-2026-01-01-100000",
  evidencePath: "Test Evidence/2026/01/RUN-2026-01-01-100000/summary.md",
  linkedUseCases: ["UC-001"],
};

describe("LiveRefresh", () => {
  it("renders once on open and re-renders (coalesced) on a subscribed event", async () => {
    const bus = new InMemoryEventBus();
    let renders = 0;
    const live = new LiveRefresh(bus, () => {
      renders += 1;
    });
    await live.open(["evidence.generated"]);
    expect(renders).toBe(1);
    await bus.publish(createEvent("evidence.generated", evidencePayload));
    await live.schedule(); // settle the scheduler chain
    expect(renders).toBeGreaterThanOrEqual(2);
    live.close();
  });

  it("ignores events after close (unsubscribed before dispose)", async () => {
    const bus = new InMemoryEventBus();
    let renders = 0;
    const live = new LiveRefresh(bus, () => {
      renders += 1;
    });
    await live.open(["evidence.generated"]);
    const before = renders;
    live.close();
    await bus.publish(createEvent("evidence.generated", evidencePayload));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renders).toBe(before);
  });

  it("does not render before open is called", () => {
    let renders = 0;
    new LiveRefresh(new InMemoryEventBus(), () => {
      renders += 1;
    });
    expect(renders).toBe(0);
  });
});

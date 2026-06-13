import { describe, expect, it } from "vitest";
import { createEvent } from "../src/shared/event-bus/create-event";

describe("prd.created event", () => {
  it("creates a typed prd.created event with the catalogued payload", () => {
    const event = createEvent(
      "prd.created",
      { prdId: "PRD-001", title: "Dashboard", path: "PRDs/PRD-001-dashboard/PRD-001-dashboard.md", parentPrdId: "PRD-000" },
      { correlationId: "PRD-001" },
    );
    expect(event.type).toBe("prd.created");
    expect(event.payload.prdId).toBe("PRD-001");
    expect(event.payload.parentPrdId).toBe("PRD-000");
    expect(event.correlationId).toBe("PRD-001");
    expect(event.source).toBe("plugin");
  });
});

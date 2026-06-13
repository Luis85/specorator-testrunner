import { describe, expect, it } from "vitest";
import { PRD_STATUSES, isPrdStatus } from "../src/domain/entities/prd";

describe("PRD status", () => {
  it("recognizes the three valid statuses", () => {
    expect(PRD_STATUSES).toEqual(["draft", "active", "deprecated"]);
    expect(isPrdStatus("active")).toBe(true);
    expect(isPrdStatus("archived")).toBe(false);
  });
});

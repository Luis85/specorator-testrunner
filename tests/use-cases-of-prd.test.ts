import { describe, expect, it } from "vitest";
import {
  firstUseCaseIdOfPrd,
  useCaseIdsOfPrd,
} from "../src/presentation/navigation/use-cases-of-prd";

const useCases = [
  { id: "UC-003", prdId: "PRD-001" },
  { id: "UC-001", prdId: "PRD-001" },
  { id: "UC-002", prdId: "PRD-002" },
  { id: "UC-009" }, // unlinked
];

describe("useCaseIdsOfPrd", () => {
  it("returns the linked Use Case ids sorted by id", () => {
    expect(useCaseIdsOfPrd(useCases, "PRD-001")).toEqual(["UC-001", "UC-003"]);
  });

  it("returns an empty array for a PRD with no Use Cases", () => {
    expect(useCaseIdsOfPrd(useCases, "PRD-999")).toEqual([]);
  });

  it("excludes unlinked Use Cases", () => {
    expect(useCaseIdsOfPrd(useCases, "PRD-002")).toEqual(["UC-002"]);
  });
});

describe("firstUseCaseIdOfPrd", () => {
  it("returns the first (id-sorted) linked Use Case", () => {
    expect(firstUseCaseIdOfPrd(useCases, "PRD-001")).toBe("UC-001");
  });

  it("returns null for a PRD with no Use Cases", () => {
    expect(firstUseCaseIdOfPrd(useCases, "PRD-999")).toBeNull();
  });
});

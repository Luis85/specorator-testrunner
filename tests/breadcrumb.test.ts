import { describe, expect, it } from "vitest";
import { breadcrumbFor, isDeepLinkable } from "../src/presentation/navigation/breadcrumb";

describe("breadcrumbFor", () => {
  it("roots every trail at Test Hub › Plan", () => {
    const trail = breadcrumbFor({ kind: "prd", prd: { id: "PRD-000", title: "Vision" } });
    expect(trail[0]).toEqual({ label: "Test Hub" });
    expect(trail[1]).toEqual({ label: "Plan" });
  });

  it("projects a PRD with its ancestry, root-first, ending at the PRD", () => {
    const trail = breadcrumbFor({
      kind: "prd",
      prd: { id: "PRD-003", title: "Checkout" },
      ancestors: [{ id: "PRD-000", title: "Vision" }],
    });
    expect(trail.map((c) => c.label)).toEqual([
      "Test Hub",
      "Plan",
      "PRD-000: Vision",
      "PRD-003: Checkout",
    ]);
    expect(trail[2]).toMatchObject({ id: "PRD-000", kind: "prd" });
    expect(trail[3]).toMatchObject({ id: "PRD-003", kind: "prd" });
  });

  it("projects a Use Case under its resolved PRD chain", () => {
    const trail = breadcrumbFor({
      kind: "use-case",
      useCase: {
        id: "UC-021",
        title: "Checkout flow",
        prdChain: [
          { id: "PRD-000", title: "Vision" },
          { id: "PRD-003", title: "Checkout" },
        ],
      },
    });
    expect(trail.map((c) => c.label)).toEqual([
      "Test Hub",
      "Plan",
      "PRD-000: Vision",
      "PRD-003: Checkout",
      "UC-021: Checkout flow",
    ]);
    const terminal = trail[trail.length - 1];
    expect(terminal).toMatchObject({ id: "UC-021", kind: "use-case" });
  });

  it("projects a Use Case with no PRD link as Test Hub › Plan › UC", () => {
    const trail = breadcrumbFor({
      kind: "use-case",
      useCase: { id: "UC-009", title: "Orphan" },
    });
    expect(trail.map((c) => c.label)).toEqual(["Test Hub", "Plan", "UC-009: Orphan"]);
  });

  it("projects a Story Map under its product PRD", () => {
    const trail = breadcrumbFor({
      kind: "story-map",
      storyMap: {
        id: "SM-002",
        title: "Onboarding journey",
        product: { id: "PRD-000", title: "Vision" },
      },
    });
    expect(trail.map((c) => c.label)).toEqual([
      "Test Hub",
      "Plan",
      "PRD-000: Vision",
      "SM-002: Onboarding journey",
    ]);
    expect(trail[trail.length - 1]).toMatchObject({ id: "SM-002", kind: "story-map" });
  });

  it("falls back to the bare id when a node has no title", () => {
    const trail = breadcrumbFor({ kind: "prd", prd: { id: "PRD-007" } });
    expect(trail[trail.length - 1].label).toBe("PRD-007");
  });

  it("omits the product crumb when a Story Map's product is unresolved", () => {
    const trail = breadcrumbFor({
      kind: "story-map",
      storyMap: { id: "SM-005", title: "Loose map" },
    });
    expect(trail.map((c) => c.label)).toEqual(["Test Hub", "Plan", "SM-005: Loose map"]);
  });
});

describe("isDeepLinkable", () => {
  it("is true for a node crumb carrying a recognized id", () => {
    expect(isDeepLinkable({ label: "PRD-003: Checkout", id: "PRD-003", kind: "prd" })).toBe(true);
  });

  it("is false for a static section/home crumb", () => {
    expect(isDeepLinkable({ label: "Test Hub" })).toBe(false);
    expect(isDeepLinkable({ label: "Plan" })).toBe(false);
  });

  it("is false for a crumb whose id is not a known artifact id", () => {
    expect(isDeepLinkable({ label: "EV-…", id: "EV-2026" })).toBe(false);
  });
});

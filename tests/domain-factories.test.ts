import { describe, expect, it } from "vitest";
import { createFeatureSpecification } from "../src/domain/entities/specification";
import { createSuite } from "../src/domain/entities/suite";

describe("createFeatureSpecification (ADR-0012 no orphans)", () => {
  it("builds a feature specification when the useCaseId is present", () => {
    const result = createFeatureSpecification({
      path: "Specifications/features/UC-001-demo.feature",
      useCaseId: "UC-001",
      featureName: "Demo",
      scenarios: [{ name: "S", tags: [], steps: [] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.useCaseId).toBe("UC-001");
    expect(result.value.featureName).toBe("Demo");
    expect(result.value.tags).toEqual([]);
    expect(result.value.scenarios).toHaveLength(1);
  });

  it("rejects an empty useCaseId at construction", () => {
    const result = createFeatureSpecification({
      path: "Specifications/features/orphan.feature",
      useCaseId: "",
      featureName: "Orphan",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a blank (whitespace-only) useCaseId", () => {
    const result = createFeatureSpecification({
      path: "x.feature",
      useCaseId: "   ",
      featureName: "F",
    });
    expect(result.ok).toBe(false);
  });

  it("omits the background key when there are no background steps", () => {
    const result = createFeatureSpecification({
      path: "UC-002-x.feature",
      useCaseId: "UC-002",
      featureName: "F",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("background" in result.value).toBe(false);
  });
});

describe("createSuite (ADR-0011 tag expression is the source of truth)", () => {
  it("builds a suite when name and tag expression are present", () => {
    const result = createSuite({
      id: "smoke",
      name: "Smoke",
      tagExpression: "@smoke and not @wip",
      path: "Test Suites/Smoke.md",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tagExpression).toBe("@smoke and not @wip");
  });

  it("rejects an empty tag expression at construction", () => {
    const result = createSuite({
      id: "smoke",
      name: "Smoke",
      tagExpression: "   ",
      path: "Test Suites/Smoke.md",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an empty name at construction", () => {
    const result = createSuite({
      id: "smoke",
      name: "  ",
      tagExpression: "@smoke",
      path: "Test Suites/Smoke.md",
    });
    expect(result.ok).toBe(false);
  });

  it("omits the description key when none is supplied", () => {
    const result = createSuite({
      id: "smoke",
      name: "Smoke",
      tagExpression: "@smoke",
      path: "Test Suites/Smoke.md",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("description" in result.value).toBe(false);
  });
});

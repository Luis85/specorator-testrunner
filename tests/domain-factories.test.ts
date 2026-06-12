import { describe, expect, it } from "vitest";
import {
  createFeatureSpecification,
  isScenarioOutline,
} from "../src/domain/entities/specification";
import { createSuite } from "../src/domain/entities/suite";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

describe("createFeatureSpecification (ADR-0012 no orphans)", () => {
  it("builds a feature specification when the useCaseId is present", () => {
    const result = createFeatureSpecification({
      path: vp("Specifications/features/UC-001-demo.feature"),
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
      path: vp("Specifications/features/orphan.feature"),
      useCaseId: "",
      featureName: "Orphan",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a blank (whitespace-only) useCaseId", () => {
    const result = createFeatureSpecification({
      path: vp("x.feature"),
      useCaseId: "   ",
      featureName: "F",
    });
    expect(result.ok).toBe(false);
  });

  it("omits the background key when there are no background steps", () => {
    const result = createFeatureSpecification({
      path: vp("UC-002-x.feature"),
      useCaseId: "UC-002",
      featureName: "F",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("background" in result.value).toBe(false);
  });

  it("passes a feature description through (Feature Editor round-trip)", () => {
    const result = createFeatureSpecification({
      path: vp("Specifications/features/UC-001-x.feature"),
      useCaseId: "UC-001",
      featureName: "F",
      description: ["Some context line."],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toEqual(["Some context line."]);
  });
});

describe("createSuite (ADR-0011 tag expression is the source of truth)", () => {
  it("builds a suite when name and tag expression are present", () => {
    const result = createSuite({
      id: "smoke",
      name: "Smoke",
      tagExpression: "@smoke and not @wip",
      path: vp("Test Suites/Smoke.md"),
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
      path: vp("Test Suites/Smoke.md"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an empty name at construction", () => {
    const result = createSuite({
      id: "smoke",
      name: "  ",
      tagExpression: "@smoke",
      path: vp("Test Suites/Smoke.md"),
    });
    expect(result.ok).toBe(false);
  });

  it("omits the description key when none is supplied", () => {
    const result = createSuite({
      id: "smoke",
      name: "Smoke",
      tagExpression: "@smoke",
      path: vp("Test Suites/Smoke.md"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("description" in result.value).toBe(false);
  });
});

describe("isScenarioOutline (TD-005)", () => {
  const base = { name: "S", tags: [], steps: [] };
  it("is true for the keyword, true for attached Examples, false for a plain scenario", () => {
    expect(isScenarioOutline({ ...base, keyword: "Scenario Outline" })).toBe(true);
    expect(isScenarioOutline({ ...base, examples: [] })).toBe(true);
    expect(isScenarioOutline(base)).toBe(false);
  });
});

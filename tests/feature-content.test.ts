import { describe, expect, it } from "vitest";
import {
  buildStarterFeature,
  featureFileName,
  nextFeatureSlug,
  slugify,
} from "../src/application/content/feature-content";
import { parseFeature } from "../src/application/content/gherkin";
import type { UseCase } from "../src/domain/entities/use-case";

const useCase = (overrides: Partial<UseCase> = {}): UseCase => ({
  id: "UC-001",
  title: "Open Example Page",
  status: "specified",
  automationStatus: "planned",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: "Use Cases/UC-001 Open Example Page.md",
  ...overrides,
});

describe("slugify / featureFileName", () => {
  it("slugifies free text", () => {
    expect(slugify("Happy Path!")).toBe("happy-path");
  });

  it("builds the ADR-0012 filename", () => {
    expect(featureFileName("UC-001", "happy-path")).toBe("UC-001-happy-path.feature");
  });
});

describe("nextFeatureSlug", () => {
  it("picks happy-path for the first feature", () => {
    expect(nextFeatureSlug(useCase())).toBe("happy-path");
  });

  it("picks feature-<n> for subsequent features", () => {
    expect(nextFeatureSlug(useCase({ featureFiles: ["a.feature"] }))).toBe("feature-2");
  });

  it("honours a caller-supplied slug", () => {
    expect(nextFeatureSlug(useCase({ featureFiles: ["a.feature"] }), "Edge Cases")).toBe(
      "edge-cases",
    );
  });
});

describe("buildStarterFeature", () => {
  it("produces parseable Gherkin tagged with the lowercased UC id", () => {
    const content = buildStarterFeature(useCase(), "happy-path");
    const feature = parseFeature(content, "Specifications/features/UC-001-happy-path.feature");
    expect(feature).not.toBeNull();
    if (!feature) return;
    expect(feature.tags).toEqual(["@uc-001"]);
    expect(feature.featureName).toBe("Open Example Page");
    expect(feature.scenarios).toHaveLength(1);
    expect(feature.scenarios[0].steps.map((s) => s.keyword)).toEqual(["Given", "When", "Then"]);
  });
});

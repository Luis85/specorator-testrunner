import { describe, expect, it } from "vitest";
import { classifyArtifactId } from "../src/presentation/navigation/artifact-id";

describe("classifyArtifactId", () => {
  it("classifies a PRD id", () => {
    expect(classifyArtifactId("PRD-003")).toBe("prd");
  });

  it("classifies a Use Case id", () => {
    expect(classifyArtifactId("UC-021")).toBe("use-case");
  });

  it("classifies a Story Map id", () => {
    expect(classifyArtifactId("SM-002")).toBe("story-map");
  });

  it("does NOT classify a Story-Map-Card id as a Story Map", () => {
    // SMC- must not match the SM- prefix or a card ref would mis-route.
    expect(classifyArtifactId("SMC-007")).toBeNull();
  });

  it("returns null for an unrecognized prefix", () => {
    expect(classifyArtifactId("EV-2026-06-01-100000")).toBeNull();
    expect(classifyArtifactId("nonsense")).toBeNull();
  });

  it("returns null for a bare prefix with no number", () => {
    expect(classifyArtifactId("PRD-")).toBeNull();
    expect(classifyArtifactId("UC-")).toBeNull();
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(classifyArtifactId("  UC-021  ")).toBe("use-case");
  });

  it("returns null for the empty string", () => {
    expect(classifyArtifactId("")).toBeNull();
  });
});

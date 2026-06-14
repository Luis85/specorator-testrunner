import { describe, expect, it } from "vitest";
import {
  rowDigest,
  scenarioRef,
  outlineRowRef,
  parseScenarioReference,
  featureScenarioRefs,
} from "../src/domain/value-objects/scenario-reference";
import { parseFeature } from "../src/application/content/gherkin";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

describe("rowDigest (content-stable Outline row key, US-056)", () => {
  it("is deterministic for the same cells", () => {
    const cells: [string, string][] = [["role", "admin"], ["name", "Alice"]];
    expect(rowDigest(cells)).toBe(rowDigest(cells));
  });

  it("is independent of column order (sorted by header)", () => {
    expect(rowDigest([["role", "admin"], ["name", "Alice"]])).toBe(
      rowDigest([["name", "Alice"], ["role", "admin"]]),
    );
  });

  it("changes when a value changes", () => {
    expect(rowDigest([["role", "admin"]])).not.toBe(rowDigest([["role", "user"]]));
  });

  it("does not alias rows when values contain separators", () => {
    expect(rowDigest([["x", "a=b"]])).not.toBe(rowDigest([["x", "a"], ["", "b"]]));
  });

  it("returns a compact base36 string", () => {
    expect(rowDigest([["role", "admin"]])).toMatch(/^[0-9a-z]+$/);
  });
});

describe("scenarioRef / outlineRowRef / parseScenarioReference", () => {
  const path = "Specifications/features/UC-001-login.feature";

  it("formats a plain scenario reference", () => {
    expect(scenarioRef(path, "Login")).toBe(`${path}::Login`);
  });

  it("formats an Outline row reference with the row- prefix", () => {
    const ref = outlineRowRef(path, "Login", [["role", "admin"]]);
    expect(ref.startsWith(`${path}::Login::row-`)).toBe(true);
  });

  it("round-trips a plain reference", () => {
    expect(parseScenarioReference(scenarioRef(path, "Login"))).toEqual({
      featurePath: path,
      scenarioName: "Login",
    });
  });

  it("round-trips an Outline row reference", () => {
    const ref = outlineRowRef(path, "Login", [["role", "admin"]]);
    const parsed = parseScenarioReference(ref);
    expect(parsed.featurePath).toBe(path);
    expect(parsed.scenarioName).toBe("Login");
    expect(parsed.rowDigest).toBe(rowDigest([["role", "admin"]]));
  });
});

describe("featureScenarioRefs", () => {
  it("yields one entry per plain scenario", () => {
    const feature = parseFeature(
      "Feature: F\n  Scenario: Login\n    Given x\n  Scenario: Logout\n    Given y\n",
      vp("Specifications/features/UC-001-f.feature"),
    );
    if (!feature) throw new Error("parse failed");
    expect(featureScenarioRefs(feature).map((e) => e.ref)).toEqual([
      "Specifications/features/UC-001-f.feature::Login",
      "Specifications/features/UC-001-f.feature::Logout",
    ]);
  });

  it("yields one entry per Outline example row, in declared order", () => {
    const feature = parseFeature(
      [
        "Feature: F",
        "  Scenario Outline: Login as <role>",
        "    Given I am <role>",
        "    Examples:",
        "      | role  |",
        "      | admin |",
        "      | user  |",
        "",
      ].join("\n"),
      vp("Specifications/features/UC-001-f.feature"),
    );
    if (!feature) throw new Error("parse failed");
    const entries = featureScenarioRefs(feature);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.scenarioName === "Login as <role>")).toBe(true);
    expect(entries[0]?.ref).toContain("::row-");
    expect(entries[0]?.ref).not.toBe(entries[1]?.ref);
  });
});

import { describe, expect, it } from "vitest";
import { structuralIssues } from "../src/application/content/feature-validation";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { parseFeature } from "../src/application/content/gherkin";
import { rowDigest } from "../src/domain/value-objects/scenario-reference";

describe("structuralIssues (TD-003 single source)", () => {
  it("returns no issues for a well-formed, UC-prefixed feature", () => {
    const spec = parseFeature(
      "Feature: Ok\n  Scenario: S\n    Given a step\n",
      vp("Specifications/features/UC-001-ok.feature"),
    );
    expect(spec).not.toBeNull();
    if (spec) expect(structuralIssues(spec)).toEqual([]);
  });

  it("flags an orphan filename as an ERROR (ADR-0012 — both surfaces agree now)", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario: S\n    Given x\n",
      vp("Specifications/features/orphan.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec)).toEqual([
      {
        level: "error",
        message: 'No "UC-NNN-" filename prefix — this Feature is an orphan (ADR-0012).',
      },
    ]);
  });

  it("uses trim() empty-name semantics (whitespace-only counts as nameless)", () => {
    // The gherkin parser trims the name at capture time, so "Feature:  \n"
    // yields featureName === "" — the fixture still pins that whitespace-only
    // or fully-empty name triggers the "Feature has no name." error.
    const spec = parseFeature(
      "Feature:  \n  Scenario: S\n    Given x\n",
      vp("Specifications/features/UC-001-blank.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((item) => item.message)).toContain("Feature has no name.");
  });

  it("flags a feature with no scenarios at all", () => {
    const spec = parseFeature("Feature: F\n", vp("Specifications/features/UC-001-bare.feature"));
    if (!spec) return;
    expect(structuralIssues(spec).map((item) => item.message)).toEqual([
      "Feature has no scenarios.",
    ]);
  });

  it("flags stepless scenarios", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario: Empty\n",
      vp("Specifications/features/UC-001-empty.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((item) => item.message)).toEqual([
      'Scenario "Empty" has no steps.',
    ]);
  });

  it("flags duplicate scenario names within a Feature (ADR-0022)", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario: Dup\n    Given x\n  Scenario: Dup\n    Given y\n",
      vp("Specifications/features/UC-001-dup.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((i) => i.message)).toContain(
      'Duplicate scenario name "Dup" — names must be unique within a Feature (ADR-0022).',
    );
  });

  it("flags a scenario name containing the reserved :: delimiter", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario: Login::row-1\n    Given x\n",
      vp("Specifications/features/UC-001-res.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((i) => i.message)).toContain(
      'Scenario "Login::row-1" uses the reserved "::" delimiter in its name.',
    );
  });

  it("flags duplicate example rows within one Scenario Outline", () => {
    const spec = parseFeature(
      [
        "Feature: F",
        "  Scenario Outline: Login as <role>",
        "    Given I am <role>",
        "    Examples:",
        "      | role  |",
        "      | admin |",
        "      | admin |",
        "",
      ].join("\n"),
      vp("Specifications/features/UC-001-rows.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((i) => i.message)).toContain(
      'Scenario Outline "Login as <role>" has duplicate example rows.',
    );
    expect(rowDigest([["role", "admin"]])).toBe(rowDigest([["role", "admin"]]));
  });

  it("leaves a well-formed Outline with distinct rows clean of identity errors", () => {
    const spec = parseFeature(
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
      vp("Specifications/features/UC-001-ok2.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec)).toEqual([]);
  });

  it("flags duplicate UNNAMED scenarios (they collide on <featurePath>::, ADR-0022)", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario:\n    Given x\n  Scenario:\n    Given y\n",
      vp("Specifications/features/UC-001-unnamed.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((i) => i.message)).toContain(
      "Duplicate unnamed scenario — every scenario needs a unique name so its Scenario Reference is collision-free (ADR-0022).",
    );
  });

  it("allows a single unnamed scenario (its <featurePath>:: ref is unique)", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario:\n    Given x\n",
      vp("Specifications/features/UC-001-one.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec)).toEqual([]);
  });
});

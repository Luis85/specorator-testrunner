import { describe, expect, it } from "vitest";
import { structuralIssues } from "../src/application/content/feature-validation";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { parseFeature } from "../src/application/content/gherkin";

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

  it("flags a scenarioless feature and stepless scenarios", () => {
    const spec = parseFeature(
      "Feature: F\n  Scenario: Empty\n",
      vp("Specifications/features/UC-001-empty.feature"),
    );
    if (!spec) return;
    expect(structuralIssues(spec).map((item) => item.message)).toEqual([
      'Scenario "Empty" has no steps.',
    ]);
  });
});

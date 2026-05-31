import { describe, expect, it } from "vitest";
import {
  collectStepTexts,
  parseFeature,
  useCaseIdFromPath,
} from "../src/application/content/gherkin";

const FEATURE = `@demo @smoke
Feature: Open Example Page
  As a new user
  I want to run a working demo test
  So that I can verify the Test Hub installation

  @happy
  Scenario: Complete the local demo page
    Given I open the local example page
    When I click the "Continue" button
    Then I should see "Test completed"
    And I wait

  Scenario Outline: Outlined
    * a generic step
`;

describe("useCaseIdFromPath", () => {
  it("extracts the UC prefix from a feature filename", () => {
    expect(useCaseIdFromPath("Specifications/features/UC-007-edit.feature")).toBe("UC-007");
  });

  it("uppercases a lowercase prefix", () => {
    expect(useCaseIdFromPath("uc-012-thing.feature")).toBe("UC-012");
  });

  it("returns null when there is no UC prefix (orphan)", () => {
    expect(useCaseIdFromPath("Specifications/features/orphan.feature")).toBeNull();
  });
});

describe("parseFeature", () => {
  it("extracts feature name, feature tags, scenarios, tags and steps", () => {
    const feature = parseFeature(FEATURE, "Specifications/features/UC-001-demo.feature");
    expect(feature).not.toBeNull();
    if (!feature) return;

    expect(feature.featureName).toBe("Open Example Page");
    expect(feature.tags).toEqual(["@demo", "@smoke"]);
    expect(feature.useCaseId).toBe("UC-001");
    expect(feature.scenarios).toHaveLength(2);

    const [first, second] = feature.scenarios;
    expect(first.name).toBe("Complete the local demo page");
    expect(first.tags).toEqual(["@happy"]);
    expect(first.steps).toEqual([
      { keyword: "Given", text: "I open the local example page" },
      { keyword: "When", text: 'I click the "Continue" button' },
      { keyword: "Then", text: 'I should see "Test completed"' },
      { keyword: "And", text: "I wait" },
    ]);

    expect(second.name).toBe("Outlined");
    expect(second.steps).toEqual([{ keyword: "*", text: "a generic step" }]);
  });

  it("ignores comments and tolerates description lines", () => {
    const feature = parseFeature(
      `# a comment\nFeature: F\n  free text description\n  Scenario: S\n    Given x`,
      "UC-002-x.feature",
    );
    expect(feature?.scenarios[0].steps).toEqual([{ keyword: "Given", text: "x" }]);
  });

  it("treats a bare keyword as a step and skips non-step lines inside a scenario", () => {
    const feature = parseFeature(
      `Feature: F
  Scenario: S
    Given
    a doc-string-ish line that is not a step
    Then done`,
      "UC-003-x.feature",
    );
    expect(feature?.scenarios[0].steps).toEqual([
      { keyword: "Given", text: "" },
      { keyword: "Then", text: "done" },
    ]);
  });

  it("does not treat a word that merely starts with a keyword as a step", () => {
    const feature = parseFeature(
      `Feature: F
  Scenario: S
    Given a real step
    Andrew is a name, not an And step
    Then done`,
      "UC-003-x.feature",
    );
    expect(feature?.scenarios[0].steps).toEqual([
      { keyword: "Given", text: "a real step" },
      { keyword: "Then", text: "done" },
    ]);
  });

  it("returns null when there is no Feature line", () => {
    expect(parseFeature("just some text\nGiven x", "x.feature")).toBeNull();
    expect(parseFeature("", "x.feature")).toBeNull();
  });

  it("leaves useCaseId empty for an orphan filename", () => {
    const feature = parseFeature("Feature: F\n  Scenario: S\n    Given x", "orphan.feature");
    expect(feature?.useCaseId).toBe("");
  });

  it("collectStepTexts flattens steps across scenarios", () => {
    const feature = parseFeature(FEATURE, "UC-001-demo.feature");
    expect(feature).not.toBeNull();
    if (!feature) return;
    expect(collectStepTexts(feature)).toEqual([
      "I open the local example page",
      'I click the "Continue" button',
      'I should see "Test completed"',
      "I wait",
      "a generic step",
    ]);
  });

  it("collects Background steps (they run before every scenario)", () => {
    const feature = parseFeature(
      `Feature: F
  Background:
    Given I am logged in
  Scenario: S
    When I do a thing
    Then it works`,
      "UC-002-x.feature",
    );
    expect(feature).not.toBeNull();
    if (!feature) return;
    expect(collectStepTexts(feature)).toEqual([
      "I am logged in",
      "I do a thing",
      "it works",
    ]);
  });
});

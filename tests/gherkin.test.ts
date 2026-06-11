import { describe, expect, it } from "vitest";
import {
  collectStepTexts,
  isPlainDescriptionLine,
  parseFeature,
  roundTripsLosslessly,
  serialiseFeature,
  useCaseIdFromPath,
} from "../src/application/content/gherkin";
import type { FeatureSpecification } from "../src/domain/entities/specification";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const RICH = `@uc-001
Feature: Rich
  A description line.

  Background:
    Given a base state

  Scenario: With table and doc string
    Given a payload:
      """json
      {
        "a": 1
      }
      """
    When I submit:
      | name | value |
      | a    | 1     |
    Then it works

  @outline
  Scenario Outline: Math
    Some scenario context.
    Given <a> plus <b>
    Then the result is <sum>

    @set-1
    Examples: small numbers
      | a | b | sum |
      | 1 | 2 | 3   |
      | 2 | 3 | 5   |
`;

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
    const feature = parseFeature(FEATURE, vp("Specifications/features/UC-001-demo.feature"));
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
      vp("UC-002-x.feature"),
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
      vp("UC-003-x.feature"),
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
      vp("UC-003-x.feature"),
    );
    expect(feature?.scenarios[0].steps).toEqual([
      { keyword: "Given", text: "a real step" },
      { keyword: "Then", text: "done" },
    ]);
  });

  it("returns null when there is no Feature line", () => {
    expect(parseFeature("just some text\nGiven x", vp("x.feature"))).toBeNull();
    expect(parseFeature("", vp("x.feature"))).toBeNull();
  });

  it("leaves useCaseId empty for an orphan filename", () => {
    const feature = parseFeature("Feature: F\n  Scenario: S\n    Given x", vp("orphan.feature"));
    expect(feature?.useCaseId).toBe("");
  });

  it("collectStepTexts flattens steps across scenarios", () => {
    const feature = parseFeature(FEATURE, vp("UC-001-demo.feature"));
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
      vp("UC-002-x.feature"),
    );
    expect(feature).not.toBeNull();
    if (!feature) return;
    // Background is its own block, NOT a scenario, and collected for missing-steps.
    expect(feature.background?.map((s) => s.text)).toEqual(["I am logged in"]);
    expect(feature.scenarios).toHaveLength(1);
    expect(collectStepTexts(feature)).toEqual(["I am logged in", "I do a thing", "it works"]);
  });

  it("does not treat doc-string content as steps", () => {
    const feature = parseFeature(
      `Feature: F
  Scenario: S
    Given a payload:
      """
      Given this is data, not a step
      When neither is this
      """
    Then it is accepted`,
      vp("UC-003-x.feature"),
    );
    expect(feature).not.toBeNull();
    if (!feature) return;
    expect(collectStepTexts(feature)).toEqual(["a payload:", "it is accepted"]);
  });
});

describe("parseFeature (extended Gherkin)", () => {
  const feature = parseFeature(RICH, vp("Specifications/features/UC-001-rich.feature"));

  it("captures feature and scenario descriptions", () => {
    expect(feature?.description).toEqual(["A description line."]);
    expect(feature?.scenarios[1].description).toEqual(["Some scenario context."]);
    expect(feature?.scenarios[0].description).toBeUndefined();
  });

  it("captures the Scenario Outline keyword and its Examples blocks", () => {
    expect(feature?.scenarios[0].keyword).toBeUndefined();
    expect(feature?.scenarios[1].keyword).toBe("Scenario Outline");
    expect(feature?.scenarios[1].examples).toEqual([
      {
        tags: ["@set-1"],
        name: "small numbers",
        header: ["a", "b", "sum"],
        rows: [
          ["1", "2", "3"],
          ["2", "3", "5"],
        ],
      },
    ]);
  });

  it("attaches a data table to the preceding step", () => {
    const when = feature?.scenarios[0].steps[1];
    expect(when?.dataTable).toEqual([
      ["name", "value"],
      ["a", "1"],
    ]);
  });

  it("attaches a doc string (with media type, dedented) to the preceding step", () => {
    const given = feature?.scenarios[0].steps[0];
    expect(given?.docString).toEqual({
      fence: '"""',
      mediaType: "json",
      lines: ["{", '  "a": 1', "}"],
    });
  });

  it("keeps Examples rows out of the scenario steps", () => {
    expect(feature?.scenarios[1].steps).toEqual([
      { keyword: "Given", text: "<a> plus <b>" },
      { keyword: "Then", text: "the result is <sum>" },
    ]);
  });

  it("parses a bare * as a zero-text step (not description text)", () => {
    const f = parseFeature(
      "Feature: F\n\n  Scenario: S\n    *\n",
      vp("Specifications/features/UC-001-star.feature"),
    );
    expect(f?.scenarios[0].steps).toEqual([{ keyword: "*", text: "" }]);
    expect(f?.scenarios[0].description).toBeUndefined();
  });
});

describe("serialiseFeature / roundTripsLosslessly", () => {
  const path = vp("Specifications/features/UC-001-rich.feature");

  it("round-trips the rich corpus losslessly", () => {
    expect(roundTripsLosslessly(RICH, path)).toBe(true);
  });

  it("serialize → parse is stable (fixed point)", () => {
    const first = parseFeature(RICH, path);
    expect(first).not.toBeNull();
    if (!first) return;
    const text = serialiseFeature(first);
    expect(parseFeature(text, path)).toEqual(first);
    expect(serialiseFeature(parseFeature(text, path) as FeatureSpecification)).toBe(text);
  });

  it("is insensitive to table-cell padding", () => {
    const padded = RICH.replace("| a | b | sum |", "|  a |b   | sum|");
    expect(roundTripsLosslessly(padded, path)).toBe(true);
  });

  it("is insensitive to tag spacing", () => {
    const spaced = RICH.replace("@uc-001", "@uc-001   ").replace("@set-1", " @set-1");
    expect(roundTripsLosslessly(spaced, path)).toBe(true);
  });

  it("fails the guard for comments (not modelled — must fall back to raw)", () => {
    expect(roundTripsLosslessly(`# top comment\n${RICH}`, path)).toBe(false);
  });

  it("fails the guard for Rule: blocks between scenarios", () => {
    const withRule = `Feature: F\n  Scenario: A\n    Given x\n  Rule: extra\n  Scenario: B\n    Given y\n`;
    expect(roundTripsLosslessly(withRule, path)).toBe(false);
  });

  it("fails the guard for unparseable content", () => {
    expect(roundTripsLosslessly("not gherkin", path)).toBe(false);
  });

  it("fails the guard for a Rule: line directly under Feature:", () => {
    const ruleAsDescription = `Feature: F\n  Rule: my rule\n\n  Scenario: S\n    Given x\n`;
    expect(roundTripsLosslessly(ruleAsDescription, path)).toBe(false);
  });

  it("preserves trailing whitespace in doc-string bodies (round-trips)", () => {
    const feature = `Feature: F\n\n  Scenario: S\n    Given a payload:\n      """\n      line with trailing spaces   \n      """\n`;
    expect(roundTripsLosslessly(feature, path)).toBe(true);
    const parsed = parseFeature(feature, path);
    expect(parsed?.scenarios[0].steps[0].docString?.lines).toEqual([
      "line with trailing spaces   ",
    ]);
  });

  it("fails the guard for a doc-string body line shallower than its fence", () => {
    const feature = `Feature: F\n\n  Scenario: S\n    Given a payload:\n      """\n   outdented beyond the fence\n      """\n`;
    expect(roundTripsLosslessly(feature, path)).toBe(false);
  });

  it("fails the guard for escaped-pipe table cells (not modelled)", () => {
    const escaped = RICH.replace("| a    | 1     |", String.raw`| a\|b | 1     |`);
    expect(roundTripsLosslessly(escaped, path)).toBe(false);
  });

  it("preserves blank paragraph breaks inside descriptions", () => {
    const feature = "Feature: F\n  para1\n\n  para2\n\n  Scenario: S\n    Given x\n";
    expect(roundTripsLosslessly(feature, path)).toBe(true);
    const parsed = parseFeature(feature, path);
    expect(parsed?.description).toEqual(["para1", "", "para2"]);
    if (!parsed) return;
    expect(serialiseFeature(parsed)).toContain("  para1\n\n  para2");
  });

  it("round-trips interior blank doc-string body lines", () => {
    const feature = `Feature: F\n\n  Scenario: S\n    Given a payload:\n      """\n      first\n\n      last\n      """\n`;
    expect(roundTripsLosslessly(feature, path)).toBe(true);
    expect(parseFeature(feature, path)?.scenarios[0].steps[0].docString?.lines).toEqual([
      "first",
      "",
      "last",
    ]);
  });

  it("fails the guard for a whitespace-only doc-string body line it cannot represent", () => {
    const feature = `Feature: F\n\n  Scenario: S\n    Given a payload:\n      """\n      first\n   \n      last\n      """\n`;
    expect(roundTripsLosslessly(feature, path)).toBe(false);
  });

  it("sanitises literal pipes in model cells (table shape is the invariant)", () => {
    const spec = parseFeature(RICH, path);
    expect(spec).not.toBeNull();
    if (!spec) return;
    spec.scenarios[1].examples?.[0].rows.push(["a|b", "2", "3"]);
    const text = serialiseFeature(spec);
    expect(text).toContain("| a/b | 2 | 3 |");
    const reparsed = parseFeature(text, path);
    expect(reparsed?.scenarios[1].examples?.[0].rows).toHaveLength(3);
    expect(reparsed?.scenarios[1].examples?.[0].rows[2]).toEqual(["a/b", "2", "3"]);
  });
});

describe("isPlainDescriptionLine", () => {
  it("accepts free text", () => {
    expect(isPlainDescriptionLine("As a user I want things")).toBe(true);
  });

  it.each([
    "@tag",
    "# comment",
    "| a | b |",
    '"""',
    "```",
    "Feature: F",
    "Scenario: S",
    "Scenario Outline: S",
    "Background:",
    "Examples:",
    "Given a step",
    "",
    "   ",
    "Rule: extra",
    "*",
  ])("rejects %j", (line) => {
    expect(isPlainDescriptionLine(line)).toBe(false);
  });
});

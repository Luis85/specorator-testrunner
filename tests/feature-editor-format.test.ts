import { describe, expect, it } from "vitest";
import { parseFeature, serialiseFeature } from "../src/application/content/gherkin";
import { type ExamplesBlock, stepDocString } from "../src/domain/entities/specification";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import {
  addExamplesColumn,
  addExamplesRow,
  asDescriptionLines,
  fenceFor,
  moveItem,
  newExamplesBlock,
  newScenario,
  newStep,
  normalizeTag,
  projectValidation,
  removeExamplesColumn,
  renameAdvisory,
  sanitizeCell,
  sanitizeDocStringLines,
  stepIsImplemented,
  stepSuggestions,
  suggestedKeyword,
} from "../src/presentation/views/feature-editor-format";

const VALID = parseFeature(
  "Feature: F\n\n  Scenario: S\n    Given x\n",
  vp("Specifications/features/UC-001-ok.feature"),
);

describe("projectValidation", () => {
  it("returns no items for a valid, UC-prefixed feature", () => {
    expect(VALID).not.toBeNull();
    if (VALID) expect(projectValidation(VALID)).toEqual([]);
  });

  it("flags an orphan filename as an ERROR (ADR-0012 — both surfaces agree now)", () => {
    const orphan = parseFeature("Feature: F\n\n  Scenario: S\n    Given x\n", vp("orphan.feature"));
    if (!orphan) return;
    const items = projectValidation(orphan);
    expect(items).toHaveLength(1);
    expect(items[0].level).toBe("error");
    expect(items[0].message).toContain("orphan");
  });

  it("flags a nameless feature, stepless scenario, and rowless outline", () => {
    const messages = projectValidation({
      path: vp("Specifications/features/UC-001-x.feature"),
      useCaseId: "UC-001",
      featureName: " ",
      tags: [],
      scenarios: [{ keyword: "Scenario Outline", name: "O", tags: [], steps: [], examples: [] }],
    }).map((item) => `${item.level}:${item.message}`);
    expect(messages).toEqual([
      "error:Feature has no name.",
      'error:Scenario "O" has no steps.',
      'warning:Scenario Outline "O" has no Examples rows.',
    ]);
  });

  it("warns about a rowless Outline implied only by attached Examples (TD-005 lenient predicate)", () => {
    const items = projectValidation({
      path: vp("Specifications/features/UC-001-implied.feature"),
      useCaseId: "UC-001",
      featureName: "F",
      tags: [],
      // No "Scenario Outline" keyword — but parsed Examples are attached.
      scenarios: [{ name: "S", tags: [], steps: [{ keyword: "Given", text: "x" }], examples: [] }],
    });
    expect(items).toEqual([
      { level: "warning", message: 'Scenario Outline "S" has no Examples rows.' },
    ]);
  });
});

describe("guided keyword flow", () => {
  it("suggests Given for the first step and And afterwards", () => {
    expect(suggestedKeyword([])).toBe("Given");
    expect(suggestedKeyword([{ keyword: "Given", text: "x" }])).toBe("And");
  });

  it("newScenario starts with one Given step; newStep follows the flow", () => {
    const scenario = newScenario();
    expect(scenario.steps).toEqual([{ keyword: "Given", text: "" }]);
    expect(newStep(scenario.steps)).toEqual({ keyword: "And", text: "" });
  });
});

describe("moveItem", () => {
  it("moves an element and reports clamped moves", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 1)).toBe(true);
    expect(list).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 0, -1)).toBe(false);
    expect(moveItem(list, 2, 1)).toBe(false);
    expect(list).toEqual(["b", "a", "c"]);
  });
});

describe("Examples mutations", () => {
  it("adds uniquely-named columns and pads rows", () => {
    const block: ExamplesBlock = { tags: [], header: ["param"], rows: [["1"]] };
    addExamplesColumn(block);
    expect(block.header).toEqual(["param", "param-2"]);
    expect(block.rows).toEqual([["1", ""]]);
  });

  it("removes a column everywhere but refuses to remove the last one", () => {
    const block: ExamplesBlock = { tags: [], header: ["a", "b"], rows: [["1", "2"]] };
    removeExamplesColumn(block, 0);
    expect(block.header).toEqual(["b"]);
    expect(block.rows).toEqual([["2"]]);
    removeExamplesColumn(block, 0);
    expect(block.header).toEqual(["b"]);
  });

  it("addExamplesRow matches the header width; newExamplesBlock is well-formed", () => {
    const block = newExamplesBlock();
    expect(block.header.length).toBeGreaterThan(0);
    addExamplesRow(block);
    expect(block.rows[block.rows.length - 1]).toHaveLength(block.header.length);
  });
});

describe("sanitizers", () => {
  it("normalizeTag ensures @, dashes inner whitespace, rejects empties", () => {
    expect(normalizeTag("wip")).toBe("@wip");
    expect(normalizeTag(" @smoke ")).toBe("@smoke");
    expect(normalizeTag("two words")).toBe("@two-words");
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("@")).toBeNull();
  });

  it("sanitizeCell trims only — pipes are handled by the serializer's escape (TD-001)", () => {
    expect(sanitizeCell(" a | b ")).toBe("a | b");
  });

  it("fenceFor avoids the fence the body contains", () => {
    expect(fenceFor(["plain"])).toBe('"""');
    expect(fenceFor(['contains """ inside'])).toBe('"""');
    expect(fenceFor(['"""'])).toBe("```");
  });

  it("asDescriptionLines keeps only plain description lines", () => {
    expect(asDescriptionLines("keep me\n@tag\nScenario: nope\n\nGiven x\nalso keep")).toEqual([
      "keep me",
      "",
      "also keep",
    ]);
  });

  it("asDescriptionLines preserves interior paragraph breaks, trims boundary blanks", () => {
    expect(asDescriptionLines("\npara1\n\npara2\n\n")).toEqual(["para1", "", "para2"]);
  });

  it("sanitizeDocStringLines escapes body lines that would close the chosen fence", () => {
    const lines = ['"""', "```", "ok"];
    const fence = fenceFor(lines); // """ present → backtick fence chosen
    expect(fence).toBe("```");
    expect(sanitizeDocStringLines(lines, fence)).toEqual(['"""', "\\```", "ok"]);
  });

  it("escaped delimiter lines survive a serialize → parse round trip", () => {
    const feature = parseFeature(
      "Feature: F\n\n  Scenario: S\n    Given a payload:\n",
      vp("Specifications/features/UC-001-doc.feature"),
    );
    expect(feature).not.toBeNull();
    if (!feature) return;
    const fence = fenceFor(['"""', "```"]);
    feature.scenarios[0].steps[0].argument = {
      kind: "docString",
      docString: {
        fence,
        lines: sanitizeDocStringLines(['"""', "```", "tail"], fence),
      },
    };
    const text = serialiseFeature(feature);
    const reparsed = parseFeature(text, feature.path);
    expect(reparsed && stepDocString(reparsed.scenarios[0].steps[0])?.lines).toEqual([
      '"""',
      "\\```",
      "tail",
    ]);
    expect(reparsed?.scenarios[0].steps).toHaveLength(1);
  });
});

describe("step suggestions & flags", () => {
  const patterns = [
    { kind: "expression" as const, source: "I open the local example page" },
    { kind: "expression" as const, source: "I open the local example page" },
  ];

  it("stepSuggestions dedupes pattern sources", () => {
    expect(stepSuggestions(patterns)).toEqual(["I open the local example page"]);
  });

  it("stepIsImplemented matches via the shared step-definition heuristics", () => {
    expect(stepIsImplemented("I open the local example page", patterns)).toBe(true);
    expect(stepIsImplemented("I do something else", patterns)).toBe(false);
  });

  it("treats an empty step as not-missing (incomplete, not unimplemented)", () => {
    expect(stepIsImplemented("  ", patterns)).toBe(true);
  });
});

describe("renameAdvisory (US-056)", () => {
  const feature = (body: string) =>
    parseFeature(`Feature: F\n${body}`, vp("Specifications/features/UC-001-r.feature"))!;

  it("returns nothing when there is no baseline", () => {
    expect(renameAdvisory(null, feature("  Scenario: A\n    Given x\n"))).toEqual([]);
  });

  it("returns nothing when scenario names are unchanged", () => {
    const next = feature("  Scenario: A\n    Given x\n    Then y\n");
    expect(renameAdvisory(["A"], next)).toEqual([]);
  });

  it("warns when a scenario name disappears", () => {
    const next = feature("  Scenario: B\n    Given x\n");
    expect(renameAdvisory(["A"], next)).toEqual([
      {
        level: "warning",
        message:
          'Scenario "A" was renamed or removed — its run history and quarantine state won\'t carry over.',
      },
    ]);
  });

  it("de-duplicates repeated removed names", () => {
    const next = feature("  Scenario: B\n    Given x\n");
    expect(renameAdvisory(["A", "A"], next)).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildAppendedStubs,
  buildAppendedStubsLayout,
  buildStepDefinitionStubFile,
  buildStepDefinitionStubFileLayout,
  countNewlines,
  findMissingSteps,
  isStepDefined,
  parseStepDefinitions,
} from "../src/application/content/step-definitions";

// STEPS_SOURCE uses createBdd form (playwright-bdd) to reflect the generated shape.
const STEPS_SOURCE = `import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();

Given("I open the local example page", async ({ page }) => {});
When("I click the {string} button", async ({ page }, label) => {});
Then(/^I should see (\\d+) results$/, async ({ page }, count) => {});
Given('a quoted single step', async ({ page }) => {});
`;

describe("parseStepDefinitions", () => {
  it("scrapes both Cucumber-expression and regex patterns", () => {
    const patterns = parseStepDefinitions(STEPS_SOURCE);
    expect(patterns).toEqual([
      { kind: "expression", source: "I open the local example page" },
      { kind: "expression", source: "I click the {string} button" },
      { kind: "regex", source: "^I should see (\\d+) results$" },
      { kind: "expression", source: "a quoted single step" },
    ]);
  });

  it("returns nothing for source with no step calls", () => {
    expect(parseStepDefinitions("const x = 1;")).toEqual([]);
  });

  it("ignores commented-out step definitions", () => {
    const source = `
      // Given("a line-commented step", () => {});
      /* When("a block-commented step", () => {}); */
      Then("a real step", () => {});
    `;
    expect(parseStepDefinitions(source)).toEqual([{ kind: "expression", source: "a real step" }]);
  });

  it("preserves patterns containing URL literals (// inside a string)", () => {
    const source = `Given("I open http://example.com/path", () => {});`;
    expect(parseStepDefinitions(source)).toEqual([
      { kind: "expression", source: "I open http://example.com/path" },
    ]);
  });
});

describe("isStepDefined", () => {
  const definitions = parseStepDefinitions(STEPS_SOURCE);

  it("matches an exact expression", () => {
    expect(isStepDefined("I open the local example page", definitions)).toBe(true);
  });

  it("matches a {string} placeholder against a quoted literal", () => {
    expect(isStepDefined('I click the "Continue" button', definitions)).toBe(true);
  });

  it("matches a regex definition", () => {
    expect(isStepDefined("I should see 5 results", definitions)).toBe(true);
  });

  it("reports an unknown step as undefined", () => {
    expect(isStepDefined("I do something undefined", definitions)).toBe(false);
  });

  it("ignores an un-compilable regex definition", () => {
    expect(isStepDefined("anything", [{ kind: "regex", source: "(" }])).toBe(false);
  });

  it("matches {int}/{float}/{word} against unquoted arguments", () => {
    const defs = parseStepDefinitions(`
      Given("I have {int} cukes", () => {});
      When("the total is {float} euros", () => {});
      Then("the {word} is ready", () => {});
    `);
    expect(isStepDefined("I have 5 cukes", defs)).toBe(true);
    expect(isStepDefined("the total is 12.50 euros", defs)).toBe(true);
    expect(isStepDefined("the kitchen is ready", defs)).toBe(true);
    // The literal text around the param still has to match.
    expect(isStepDefined("I have 5 apples", defs)).toBe(false);
  });

  it("does not match a longer step that merely starts with a definition", () => {
    const defs = parseStepDefinitions(`Given("I wait", () => {});`);
    expect(isStepDefined("I wait", defs)).toBe(true);
    expect(isStepDefined("I wait for the page", defs)).toBe(false); // anchored
  });

  it("preserves regex flags (case-insensitive defs match)", () => {
    const defs = parseStepDefinitions(`Then(/error message/i, () => {});`);
    expect(defs).toEqual([{ kind: "regex", source: "error message", flags: "i" }]);
    expect(isStepDefined("Error Message", defs)).toBe(true);
    expect(isStepDefined("error message", defs)).toBe(true);
  });

  it("matches a Scenario Outline <placeholder> as a wildcard for a param", () => {
    const defs = parseStepDefinitions(`When("I select {string} from the menu", () => {});`);
    expect(isStepDefined("I select <option> from the menu", defs)).toBe(true);
    // ...but a different literal around the placeholder is still unmatched.
    expect(isStepDefined("I select <option> from the list", defs)).toBe(false);
  });
});

describe("findMissingSteps", () => {
  it("returns distinct unmatched steps in first-seen order", () => {
    const definitions = parseStepDefinitions(STEPS_SOURCE);
    const missing = findMissingSteps(
      [
        "I open the local example page",
        "I do something undefined",
        "I do something undefined",
        'I click the "Stop" button',
        "yet another missing",
      ],
      definitions,
    );
    expect(missing).toEqual(["I do something undefined", "yet another missing"]);
  });

  it("reports an unimplemented Scenario Outline step (placeholders are wildcards, not hidden)", () => {
    // No definitions → the outline step is genuinely missing and must surface.
    expect(findMissingSteps(["I select <option> from the menu"], [])).toEqual([
      "I select <option> from the menu",
    ]);
    // With a matching def (placeholder ↔ param), it is satisfied.
    const defs = parseStepDefinitions(`When("I select {string} from the menu", () => {});`);
    expect(findMissingSteps(["I select <option> from the menu"], defs)).toEqual([]);
  });
});

describe("buildStepDefinitionStubFile", () => {
  it("emits a createBdd import header and one Given stub per step", () => {
    const file = buildStepDefinitionStubFile(["I open the page", "the result is shown"]);
    expect(file).toContain(`import { createBdd } from "playwright-bdd";`);
    expect(file).toContain(`const { Given, When, Then } = createBdd();`);
    expect(file).toContain(`Given("I open the page", async ({ page }) => {`);
    expect(file).toContain(`Given("the result is shown", async ({ page }) => {`);
    // Every stub is pending and TODO-flagged for the user to fill in.
    expect(file.match(/throw new Error\("Pending"\);/g)).toHaveLength(2);
    expect(file).toContain("// TODO: implement this step");
    expect(file).not.toContain("@cucumber/cucumber");
    expect(file).not.toContain("TestWorld");
  });

  it("renders a createBdd stub with page fixture and typed params", () => {
    const file = buildStepDefinitionStubFile(['I click the "Continue" button']);
    expect(file).toContain('import { createBdd } from "playwright-bdd";');
    expect(file).toContain("const { Given, When, Then } = createBdd();");
    expect(file).toContain(
      'Given("I click the {string} button", async ({ page }, arg1: string) =>',
    );
    expect(file).not.toContain("@cucumber/cucumber");
    expect(file).not.toContain("TestWorld");
    expect(file).not.toContain("this:");
  });

  it("parameterises quoted literals to {string} with one typed arg each", () => {
    const file = buildStepDefinitionStubFile([`I click the "Continue" button`]);
    expect(file).toContain(
      `Given("I click the {string} button", async ({ page }, arg1: string) => {`,
    );
  });

  it("parameterises Scenario Outline placeholders to {string}", () => {
    const file = buildStepDefinitionStubFile(["I select <option> from <menu>"]);
    expect(file).toContain(
      `Given("I select {string} from {string}", async ({ page }, arg1: string, arg2: string) => {`,
    );
  });

  it("squashes whitespace and escapes embedded double quotes in the comment", () => {
    const file = buildStepDefinitionStubFile(["I   have    spaced   text"]);
    expect(file).toContain(`Given("I have spaced text"`);
  });

  it("round-trips with isStepDefined — a generated stub matches its own step", () => {
    const file = buildStepDefinitionStubFile([`I click the "Continue" button`]);
    const defs = parseStepDefinitions(file);
    expect(isStepDefined(`I click the "Save" button`, defs)).toBe(true);
  });
});

describe("buildAppendedStubs", () => {
  it("appends only the missing createBdd header to a file that already has it", () => {
    const existing =
      'import { createBdd } from "playwright-bdd";\nconst { Given, When, Then } = createBdd();\n\nGiven("x", async ({ page }) => {});\n';
    const block = buildAppendedStubs(existing, ["I do a new thing"]);
    expect(block).not.toContain("import { createBdd }");
    expect(block).toContain('Given("I do a new thing", async ({ page }) =>');
  });

  it("prepends the import + a Given binding when appending to a file without playwright-bdd", () => {
    const existing = `// notes, no imports here\n`;
    const block = buildAppendedStubs(existing, ["a fresh step"]);
    expect(block).toContain('import { createBdd } from "playwright-bdd";');
    expect(block).toContain("const { Given } = createBdd();");
    expect(block).toContain('Given("a fresh step"');
  });

  it("adds a Given binding when the file calls createBdd() but destructured only other verbs (P2)", () => {
    // A hand-edited file that trimmed its destructure to the verbs it uses must
    // still get a Given binding — the stubs call Given(...). No duplicate import,
    // and `const { Given } = createBdd()` does not clash with the existing
    // `{ When, Then }` destructure.
    const existing =
      'import { createBdd } from "playwright-bdd";\nconst { When, Then } = createBdd();\n\nWhen("x", async ({ page }) => {});\n';
    const block = buildAppendedStubs(existing, ["a fresh step"]);
    expect(block).not.toContain("import { createBdd }");
    expect(block).toContain("const { Given } = createBdd();");
    expect(block).toContain('Given("a fresh step"');
  });

  it("does not re-bind Given when it is already destructured from createBdd", () => {
    const existing =
      'import { createBdd } from "playwright-bdd";\nconst { Given, When } = createBdd();\n\nGiven("x", async ({ page }) => {});\n';
    const block = buildAppendedStubs(existing, ["a fresh step"]);
    expect(block).not.toContain("createBdd()"); // no new binding line
    expect(block).toContain('Given("a fresh step"');
  });

  it("reuses a Given bound via a custom import — no duplicate binding (P2)", () => {
    // A custom-fixtures module re-exports `createBdd(test)` and the file imports
    // `Given` from it; the append must NOT add its own `const { Given } = …`.
    const existing =
      'import { Given } from "../fixtures";\n\nGiven("x", async ({ page }) => {});\n';
    const block = buildAppendedStubs(existing, ["a fresh step"]);
    expect(block).not.toContain("createBdd");
    expect(block).toContain('Given("a fresh step"');
  });

  it("preserves the existing createBdd(test) fixture argument in the new Given binding (P2)", () => {
    // A custom-fixtures file binds verbs to a project `test`:
    // `const { When } = createBdd(test)`. The appended Given binding must reuse
    // `test` so the stubs register against the same fixtures — a default
    // `createBdd()` would give them Playwright's base fixtures instead.
    const existing =
      'import { test } from "../fixtures";\nimport { createBdd } from "playwright-bdd";\nconst { When } = createBdd(test);\n\nWhen("x", async ({ page }) => {});\n';
    const block = buildAppendedStubs(existing, ["a fresh step"]);
    expect(block).toContain("const { Given } = createBdd(test);");
    expect(block).not.toContain("createBdd();");
    expect(block).toContain('Given("a fresh step"');
  });

  it("preserves a nested-call createBdd argument without truncating at the inner paren (P2)", () => {
    // `[^)]*` would have stopped at the inner `)`, yielding an unbalanced
    // `createBdd(makeTest({ headless: true })` that fails to compile.
    const existing =
      'import { createBdd } from "playwright-bdd";\nconst { When } = createBdd(makeTest({ headless: true }));\n\nWhen("x", async () => {});\n';
    const block = buildAppendedStubs(existing, ["a fresh step"]);
    expect(block).toContain("const { Given } = createBdd(makeTest({ headless: true }));");
  });

  it("adds the createBdd import when playwright-bdd is imported but createBdd isn't locally bound (P2)", () => {
    // Importing only `test` (or `createBdd as bdd`) from playwright-bdd does NOT
    // bind the local name `createBdd`, so the appended `createBdd()` call would
    // be undefined unless the import is added.
    const existing = 'import { test } from "playwright-bdd";\n\ntest("x", () => {});\n';
    const block = buildAppendedStubs(existing, ["a fresh step"]);
    expect(block).toContain('import { createBdd } from "playwright-bdd";');
    expect(block).toContain("const { Given } = createBdd();");
    expect(block).toContain('Given("a fresh step"');
  });
});

describe("stub layout (WS1 Task 1)", () => {
  it("lays out a fresh stub file with 1-based ranges per stub", () => {
    const layout = buildStepDefinitionStubFileLayout(["I do a thing", "I see it"]);
    // Byte-identical to the string builder (delegation contract).
    expect(layout.text).toBe(buildStepDefinitionStubFile(["I do a thing", "I see it"]));
    // Header: import + destructure (lines 1-2), blank line 3; each stub is 4
    // lines (comment, Given(, throw, `});`), blocks separated by one blank line.
    expect(layout.insertions).toEqual([
      { step: "I do a thing", startLine: 4, endLine: 7 },
      { step: "I see it", startLine: 9, endLine: 12 },
    ]);
  });

  it("lays out an append to a file that already binds Given (blocks only)", () => {
    const existing = `import { createBdd } from "playwright-bdd";\nconst { Given } = createBdd();\n`;
    const layout = buildAppendedStubsLayout(existing, ["I do a thing"]);
    expect(layout.text).toBe(buildAppendedStubs(existing, ["I do a thing"]));
    // No header: the single stub starts at line 1 of the appended text.
    expect(layout.insertions).toEqual([{ step: "I do a thing", startLine: 1, endLine: 4 }]);
  });

  it("lays out an append that needs the import + Given binding header", () => {
    const existing = `const helper = 1;\n`;
    const layout = buildAppendedStubsLayout(existing, ["I do a thing"]);
    expect(layout.text).toBe(buildAppendedStubs(existing, ["I do a thing"]));
    // Header: import (1) + Given binding (2), blank line 3, stub 4-7.
    expect(layout.insertions).toEqual([{ step: "I do a thing", startLine: 4, endLine: 7 }]);
  });

  it("counts newlines for the caller's file-offset math", () => {
    expect(countNewlines("")).toBe(0);
    expect(countNewlines("a\nb\n")).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  findMissingSteps,
  isStepDefined,
  parseStepDefinitions,
} from "../src/application/content/step-definitions";

const STEPS_SOURCE = `import { Given, When, Then } from "@cucumber/cucumber";

Given("I open the local example page", async function () {});
When("I click the {string} button", async function (label) {});
Then(/^I should see (\\d+) results$/, async function (count) {});
And('a quoted single step', function () {});
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
    expect(parseStepDefinitions(source)).toEqual([
      { kind: "expression", source: "a real step" },
    ]);
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

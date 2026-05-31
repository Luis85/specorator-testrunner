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

  it("skips Scenario Outline steps that still contain <placeholders>", () => {
    const missing = findMissingSteps(["I select <option> from the menu"], []);
    expect(missing).toEqual([]); // not matchable until Examples are expanded
  });
});

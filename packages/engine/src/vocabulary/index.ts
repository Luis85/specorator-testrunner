// The built-in natural-language step vocabulary plus the Cucumber-Expression
// matcher. Most scenarios need zero custom code. See DESIGN.md section 4.

import {
  CucumberExpression,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";
import type { Driver, Target } from "../driver/driver";

export type StepArg = string | number;
export type StepHandler = (driver: Driver, args: StepArg[]) => Promise<void>;

export interface StepDefinition {
  /** A Cucumber Expression, e.g. "the user clicks {string}". */
  expression: string;
  handler: StepHandler;
}

/** Thrown by assertion steps when an expectation is not met. */
export class StepAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepAssertionError";
  }
}

/** Parse a quoted target string into a Target (prefix grammar resolved by the driver). */
export function parseTarget(raw: string): Target {
  // TODO(phase-2): parse "within" scoping and ordinals here.
  return { raw };
}

async function assertPageText(
  driver: Driver,
  expected: string,
  shouldShow: boolean,
): Promise<void> {
  const visible = await driver.isVisible({ raw: `text=${expected}` });
  if (visible !== shouldShow) {
    throw new StepAssertionError(
      `Expected page to ${shouldShow ? "" : "not "}show "${expected}"`,
    );
  }
}

async function assertVisible(
  driver: Driver,
  target: Target,
  expected: boolean,
): Promise<void> {
  const visible = await driver.isVisible(target);
  if (visible !== expected) {
    throw new StepAssertionError(
      `Expected "${target.raw}" to be ${expected ? "visible" : "hidden"}`,
    );
  }
}

async function assertUrl(
  driver: Driver,
  expected: string,
  exact: boolean,
): Promise<void> {
  const url = await driver.url();
  const ok = exact ? url === expected : url.includes(expected);
  if (!ok) {
    throw new StepAssertionError(
      `Expected url to ${exact ? "be" : "contain"} "${expected}", got "${url}"`,
    );
  }
}

const s = (a: StepArg): string => String(a);
const t = (a: StepArg): Target => parseTarget(String(a));

export const builtinSteps: StepDefinition[] = [
  // Navigation
  { expression: "the user opens {string}", handler: async (d, [u]) => d.open(s(u)) },
  { expression: "the user reloads the page", handler: async (d) => d.open(await d.url()) },

  // Interaction
  { expression: "the user clicks {string}", handler: async (d, [x]) => d.click(t(x)) },
  { expression: "the user fills {string} with {string}", handler: async (d, [x, v]) => d.fill(t(x), s(v)) },
  { expression: "the user types {string} into {string}", handler: async (d, [v, x]) => d.fill(t(x), s(v)) },
  { expression: "the user selects {string} from {string}", handler: async (d, [o, x]) => d.select(t(x), s(o)) },
  { expression: "the user checks {string}", handler: async (d, [x]) => d.check(t(x), true) },
  { expression: "the user unchecks {string}", handler: async (d, [x]) => d.check(t(x), false) },
  { expression: "the user hovers {string}", handler: async (d, [x]) => d.hover(t(x)) },
  { expression: "the user presses {string}", handler: async (d, [k]) => d.press(s(k)) },

  // Waiting
  { expression: "the user waits for {string} to appear", handler: async (d, [x]) => d.waitFor(t(x), "visible") },
  { expression: "the user waits for {string} to disappear", handler: async (d, [x]) => d.waitFor(t(x), "hidden") },

  // Assertions
  { expression: "the page should show {string}", handler: async (d, [v]) => assertPageText(d, s(v), true) },
  { expression: "the page should not show {string}", handler: async (d, [v]) => assertPageText(d, s(v), false) },
  { expression: "{string} should be visible", handler: async (d, [x]) => assertVisible(d, t(x), true) },
  { expression: "{string} should be hidden", handler: async (d, [x]) => assertVisible(d, t(x), false) },
  { expression: "the url should be {string}", handler: async (d, [u]) => assertUrl(d, s(u), true) },
  { expression: "the url should contain {string}", handler: async (d, [u]) => assertUrl(d, s(u), false) },
];

const registry = new ParameterTypeRegistry();
const compiled = builtinSteps.map((def) => ({
  expr: new CucumberExpression(def.expression, registry),
  def,
}));

export interface StepMatch {
  def: StepDefinition;
  args: StepArg[];
}

/** Match a step's text against the vocabulary. Returns the first match, or null. */
export function matchStep(text: string): StepMatch | null {
  for (const { expr, def } of compiled) {
    const args = expr.match(text);
    if (args) {
      return { def, args: args.map((a) => a.getValue<StepArg>(null) as StepArg) };
    }
  }
  return null;
}

// Gherkin parsing from markdown code fences.
// The fence body is standard Gherkin, parsed with @cucumber/gherkin's classic
// token matcher. See DESIGN.md section 4.

import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import type * as messages from "@cucumber/messages";

export interface ParsedStep {
  keyword: string;
  text: string;
  line: number;
}

export interface ParsedScenario {
  name: string;
  line: number;
  tags: string[];
  steps: ParsedStep[];
}

export interface ParsedFeature {
  name: string;
  tags: string[];
  background: ParsedStep[];
  scenarios: ParsedScenario[];
}

/** Extract the body of the first ```gherkin fence in a markdown note, if any. */
export function extractGherkinFence(markdown: string): string | null {
  const match = markdown.match(/```gherkin\s*\n([\s\S]*?)\n```/);
  return match ? match[1] : null;
}

function mapStep(step: messages.Step): ParsedStep {
  return {
    keyword: step.keyword.trim(),
    text: step.text,
    line: step.location.line,
  };
}

export function parseGherkin(source: string): ParsedFeature {
  const newId = IdGenerator.uuid();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  const doc = parser.parse(source);
  const feature = doc.feature;
  if (!feature) {
    throw new Error("No Feature found in Gherkin source");
  }

  const background: ParsedStep[] = [];
  const scenarios: ParsedScenario[] = [];

  for (const child of feature.children) {
    if (child.background) {
      for (const step of child.background.steps) {
        background.push(mapStep(step));
      }
    } else if (child.scenario) {
      scenarios.push({
        name: child.scenario.name,
        line: child.scenario.location.line,
        tags: child.scenario.tags.map((t) => t.name),
        steps: child.scenario.steps.map(mapStep),
      });
    }
  }

  return {
    name: feature.name,
    tags: feature.tags.map((t) => t.name),
    background,
    scenarios,
  };
}

// Gherkin parsing from markdown code fences.
// See DESIGN.md section 4.
//
// TODO(phase-1): use @cucumber/gherkin with GherkinInMarkdownTokenMatcher and
// compile to pickles (one pickle per Scenario / Scenario Outline row).

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
  background?: ParsedStep[];
  scenarios: ParsedScenario[];
}

/** Extract the body of the first ```gherkin fence in a markdown note, if any. */
export function extractGherkinFence(markdown: string): string | null {
  const match = markdown.match(/```gherkin\s*\n([\s\S]*?)\n```/);
  return match ? match[1] : null;
}

export function parseGherkin(_source: string): ParsedFeature {
  throw new Error("parseGherkin: not implemented yet (Phase 1)");
}

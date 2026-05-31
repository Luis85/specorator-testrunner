/**
 * Pure heuristics for matching Gherkin steps against Cucumber step
 * definitions (UC-010 / US-021). I/O-free so it is unit-testable; the
 * SpecificationService feeds it the raw source of every `*.ts` steps file.
 *
 * Heuristic & its limits (V1):
 * - Step-definition *patterns* are scraped from `Given|When|Then|And|But(...)`
 *   calls. We capture either a quoted string ("..." / '...' / `...`) or a
 *   regular-expression literal (/.../).
 * - Cucumber-expression patterns are COMPILED to an anchored regex: literal
 *   text is escaped and each `{...}` parameter becomes its value class
 *   (`{string}` → a quoted literal, `{int}` → `-?\d+`, `{float}` → a decimal,
 *   `{word}` → `\S+`, anonymous `{}` → `.*`). So `When("I have {int} cukes")`
 *   matches the unquoted feature step `When I have 5 cukes`, and
 *   `When("I click the {string} button")` matches `... the "Continue" button`.
 * - Regex patterns are anchored and tested against the raw step text.
 * - Scenario Outline steps containing `<placeholders>` are NOT matched (they
 *   have no concrete value until the Examples table is expanded); the matcher
 *   skips them so they are neither reported missing nor stubbed.
 * - NOT handled: custom parameter types, optional/alternative Cucumber syntax
 *   (`colou?r`, `cat/dog`), step tables/doc-strings, and definitions built at
 *   runtime from variables. These may yield false "missing" reports; the user
 *   reviews the generated stubs (UC-010) so over-reporting is the safe failure.
 */

/** A single step-definition pattern scraped from a steps file. */
export interface StepDefinitionPattern {
  kind: "expression" | "regex";
  source: string;
}

// Given("...") / When('...') / Then(`...`) / And(/.../) / But("...")
const STEP_DEF_CALL =
  /\b(?:Given|When|Then|And|But)\s*\(\s*(?:(["'`])((?:\\.|(?!\1).)*)\1|\/((?:\\.|[^/])+)\/[a-z]*)/g;

/**
 * Strips block and line comments so a commented-out step definition isn't
 * scraped as implemented (which would hide a genuinely missing step). String
 * literals containing `//` are rare in step patterns, and an over-strip there
 * only risks a false "missing" report — the safe direction (UC-010).
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Scrapes step-definition patterns from one steps file's source. */
export const parseStepDefinitions = (source: string): StepDefinitionPattern[] => {
  const patterns: StepDefinitionPattern[] = [];
  for (const match of stripComments(source).matchAll(STEP_DEF_CALL)) {
    const [, , quoted, regex] = match;
    if (typeof quoted === "string") {
      patterns.push({ kind: "expression", source: quoted });
    } else if (typeof regex === "string") {
      patterns.push({ kind: "regex", source: regex });
    }
  }
  return patterns;
};

/** Regex fragment each Cucumber built-in parameter type expands to. */
const PARAM_CLASS: Record<string, string> = {
  string: `(?:"[^"]*"|'[^']*')`,
  int: String.raw`-?\d+`,
  float: String.raw`-?\d*\.?\d+`,
  double: String.raw`-?\d*\.?\d+`,
  word: String.raw`\S+`,
  biginteger: String.raw`-?\d+`,
  long: String.raw`-?\d+`,
  short: String.raw`-?\d+`,
  byte: String.raw`-?\d+`,
  "": `.*`, // anonymous {}
};

const CUCUMBER_PARAM = /\{(string|int|float|double|word|biginteger|long|short|byte|)\}/g;
const OUTLINE_PLACEHOLDER = /<[^>]+>/;

/** Collapses runs of whitespace and trims for stable comparison. */
const squash = (value: string): string => value.replace(/\s+/g, " ").trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compiles a Cucumber expression into an anchored regex over squashed text. */
const compileExpression = (source: string): RegExp => {
  const expression = squash(source);
  let pattern = "";
  let lastIndex = 0;
  for (const match of expression.matchAll(CUCUMBER_PARAM)) {
    pattern += escapeRegex(expression.slice(lastIndex, match.index));
    pattern += PARAM_CLASS[match[1]] ?? String.raw`\S+`;
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  pattern += escapeRegex(expression.slice(lastIndex));
  return new RegExp(`^${pattern}$`);
};

/** Anchors an author-supplied regex so it must match the whole step. */
const anchoredRegex = (source: string): RegExp => {
  const body = source.replace(/^\^/, "").replace(/\$$/, "");
  return new RegExp(`^(?:${body})$`);
};

/** True when `stepText` is satisfied by any of the supplied definitions. */
export const isStepDefined = (
  stepText: string,
  definitions: StepDefinitionPattern[],
): boolean => {
  const raw = stepText.trim();
  const squashed = squash(stepText);
  return definitions.some((definition) => {
    try {
      if (definition.kind === "regex") return anchoredRegex(definition.source).test(raw);
      return compileExpression(definition.source).test(squashed);
    } catch {
      return false; // an un-compilable pattern never matches
    }
  });
};

/**
 * Returns the distinct step texts from `stepTexts` not matched by any
 * definition, preserving first-seen order (US-021). Scenario Outline steps
 * (with `<placeholders>`) are skipped — they have no concrete value to match.
 */
export const findMissingSteps = (
  stepTexts: string[],
  definitions: StepDefinitionPattern[],
): string[] => {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const text of stepTexts) {
    if (seen.has(text)) continue;
    seen.add(text);
    if (OUTLINE_PLACEHOLDER.test(text)) continue;
    if (!isStepDefined(text, definitions)) missing.push(text);
  }
  return missing;
};

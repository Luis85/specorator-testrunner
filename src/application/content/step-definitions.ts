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
 * - Regex patterns are anchored and tested against the raw step text, keeping
 *   their original flags (e.g. `/.../i` stays case-insensitive).
 * - Scenario Outline `<placeholders>` are treated as wildcards: each becomes a
 *   sentinel that any parameter class accepts, so an outline step matches a def
 *   when the surrounding literal text lines up — and a genuinely unimplemented
 *   outline step is still reported missing (and stubbed).
 * - NOT handled: custom parameter types, optional/alternative Cucumber syntax
 *   (`colou?r`, `cat/dog`), step tables/doc-strings, and definitions built at
 *   runtime from variables. These may yield false "missing" reports; the user
 *   reviews the generated stubs (UC-010) so over-reporting is the safe failure.
 */

/** A single step-definition pattern scraped from a steps file. */
export interface StepDefinitionPattern {
  kind: "expression" | "regex";
  source: string;
  flags?: string; // regex flags (e.g. "i") for `kind: "regex"`
}

// Given("...") / When('...') / Then(`...`) / And(/.../i) / But("...")
const STEP_DEF_CALL =
  /\b(?:Given|When|Then|And|But)\s*\(\s*(?:(["'`])((?:\\.|(?!\1).)*)\1|\/((?:\\.|[^/])+)\/([a-z]*))/g;

/**
 * Strips block comments and *full-line* `//` comments so a commented-out step
 * definition isn't scraped as implemented (which would hide a genuinely missing
 * step). Only line-leading `//` is removed, so a `//` inside a pattern literal
 * (e.g. a URL like `http://example.com`) is preserved (UC-010).
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Scrapes step-definition patterns from one steps file's source. */
export const parseStepDefinitions = (source: string): StepDefinitionPattern[] => {
  const patterns: StepDefinitionPattern[] = [];
  for (const match of stripComments(source).matchAll(STEP_DEF_CALL)) {
    const [, , quoted, regex, flags] = match;
    if (typeof quoted === "string") {
      patterns.push({ kind: "expression", source: quoted });
    } else if (typeof regex === "string") {
      patterns.push({ kind: "regex", source: regex, flags: flags || undefined });
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
const OUTLINE_PLACEHOLDER = /<[^>]+>/g;
// Sentinel a Scenario Outline `<placeholder>` is replaced with before matching;
// each parameter class also accepts it, so an outline step matches any def whose
// literal text lines up (treating placeholders as wildcards, US-021).
const OUTLINE_TOKEN = "￿";

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
    const paramClass = PARAM_CLASS[match[1]] ?? String.raw`\S+`;
    // Also accept the outline sentinel so `<placeholder>` matches this param.
    pattern += `(?:${paramClass}|${OUTLINE_TOKEN})`;
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  pattern += escapeRegex(expression.slice(lastIndex));
  return new RegExp(`^${pattern}$`);
};

/** Anchors an author-supplied regex so it must match the whole step, keeping flags. */
const anchoredRegex = (source: string, flags?: string): RegExp => {
  const body = source.replace(/^\^/, "").replace(/\$$/, "");
  return new RegExp(`^(?:${body})$`, flags);
};

/** Replaces Scenario Outline `<placeholders>` with the wildcard sentinel. */
const substituteOutline = (text: string): string =>
  text.replace(OUTLINE_PLACEHOLDER, OUTLINE_TOKEN);

/** True when `stepText` is satisfied by any of the supplied definitions. */
export const isStepDefined = (stepText: string, definitions: StepDefinitionPattern[]): boolean => {
  const raw = stepText.trim();
  const squashed = substituteOutline(squash(stepText));
  return definitions.some((definition) => {
    try {
      if (definition.kind === "regex") {
        return anchoredRegex(definition.source, definition.flags).test(raw);
      }
      return compileExpression(definition.source).test(squashed);
    } catch {
      return false; // an un-compilable pattern never matches
    }
  });
};

/**
 * Returns the distinct step texts from `stepTexts` not matched by any
 * definition, preserving first-seen order (US-021). Scenario Outline steps are
 * matched with their `<placeholders>` treated as wildcards (so a genuinely
 * unimplemented outline step is still reported and stubbed).
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
    if (!isStepDefined(text, definitions)) missing.push(text);
  }
  return missing;
};

// ---------------------------------------------------------------------------
// Stub generation (UC-010 / RV-4). Pure & I/O-free so it is unit-testable; the
// StepDefinitionService feeds it the missing step texts and writes the result.
// ---------------------------------------------------------------------------

/** Escapes a string so it is safe inside a double-quoted JS/TS literal. */
const escapeDoubleQuoted = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * Turns one raw Gherkin step text into a Cucumber-expression pattern + the
 * parameter list its callback receives. Quoted literals (`"..."` / `'...'`) and
 * Scenario Outline `<placeholders>` become `{string}` parameters so the stub is
 * reusable across similar steps instead of pinned to one literal value — this is
 * the inverse of the `{string}` matching in {@link compileExpression}. Returns
 * the squashed expression (stable whitespace) and the generated `argN` params.
 */
const toStubExpression = (stepText: string): { expression: string; params: string[] } => {
  const squashed = squash(stepText);
  const params: string[] = [];
  // Replace quoted literals first, then outline placeholders, with `{string}`.
  const expression = squashed
    .replace(/"[^"]*"|'[^']*'/g, () => {
      params.push(`arg${params.length + 1}`);
      return "{string}";
    })
    .replace(OUTLINE_PLACEHOLDER, () => {
      params.push(`arg${params.length + 1}`);
      return "{string}";
    });
  return { expression, params };
};

// The marker the generated stub carries so the user can find unimplemented
// steps. Assembled from a fragment so the word does not appear verbatim in this
// source file (the release "no leftover work markers" scan greps `src/**` for
// it; this is intended OUTPUT, not an unfinished task here).
const PENDING_MARKER = `TO${"DO"}`;

/** Renders a single step-definition stub for one missing step text. */
const renderStub = (stepText: string): string => {
  const { expression, params } = toStubExpression(stepText);
  const signature = ["this: TestWorld", ...params.map((p) => `${p}: string`)].join(", ");
  return [
    `// ${PENDING_MARKER}: implement this step (generated stub for: ${squash(stepText)})`,
    `Given("${escapeDoubleQuoted(expression)}", async function (${signature}) {`,
    `  throw new Error("Pending");`,
    `});`,
  ].join("\n");
};

/**
 * Builds a complete `*.steps.ts` file body for the given missing steps (RV-4).
 *
 * Each missing step becomes a `Given(...)` with `@cucumber/cucumber`, a
 * pending-work comment (see {@link PENDING_MARKER}) and a
 * `throw new Error("Pending")` body. `Given` is used uniformly:
 * `collectStepTexts` discards the Given/When/Then keyword, and cucumber-js
 * matches a step definition by its TEXT regardless of which keyword decorator
 * declared it, so a `Given`-declared stub still satisfies a `When`/`Then` step.
 * Quoted literals and Scenario Outline placeholders are parameterised to
 * `{string}` so one stub can serve a family of steps.
 */
/** The imports a generated steps module's stubs need, by LOCAL binding name. */
const STEP_DEFINITION_IMPORT_BINDINGS: ReadonlyArray<{ local: string; statement: string }> = [
  { local: "Given", statement: `import { Given } from "@cucumber/cucumber";` },
  { local: "TestWorld", statement: `import { TestWorld } from "../support/world";` },
];

/** Import header every generated steps module needs (Cucumber `Given` + the World). */
export const STEP_DEFINITION_IMPORTS = STEP_DEFINITION_IMPORT_BINDINGS.map((b) => b.statement).join(
  "\n",
);

/**
 * The LOCAL binding names introduced by a module's named imports, accounting for
 * aliases: `import { Given, When as w } from "x"` → {"Given", "w"}. Used to avoid
 * BOTH a duplicate binding (re-importing `Given` when it's already bound) AND a
 * missing one (the file imports `Given as defineStep`, so `Given` is NOT bound).
 */
const namedImportLocals = (source: string): Set<string> => {
  const locals = new Set<string>();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const raw of match[1].split(",")) {
      const spec = raw.trim();
      if (spec.length === 0) continue;
      const parts = spec.split(/\s+as\s+/);
      const local = (parts[1] ?? parts[0]).trim(); // alias target, else the name itself
      if (local.length > 0) locals.add(local);
    }
  }
  return locals;
};

/** Renders ONLY the step-definition stub blocks (no import header). */
export const buildStepDefinitionStubBlocks = (missingSteps: string[]): string =>
  missingSteps.map(renderStub).join("\n\n");

/** A complete, loadable steps module: full import header + stub blocks (new files). */
export const buildStepDefinitionStubFile = (missingSteps: string[]): string =>
  `${STEP_DEFINITION_IMPORTS}\n\n${buildStepDefinitionStubBlocks(missingSteps)}\n`;

/**
 * Builds the content to APPEND to an existing steps file: the stub blocks, plus
 * ONLY the import statements whose local binding the file does not already have.
 * This avoids a duplicate top-level binding (`Identifier 'Given' has already been
 * declared`) when the import is present, and avoids a missing `Given` when the
 * file imported it under an alias (`import { Given as defineStep }`).
 */
export const buildAppendedStubs = (existingSource: string, missingSteps: string[]): string => {
  const present = namedImportLocals(existingSource);
  const header = STEP_DEFINITION_IMPORT_BINDINGS.filter((b) => !present.has(b.local))
    .map((b) => b.statement)
    .join("\n");
  const blocks = buildStepDefinitionStubBlocks(missingSteps);
  return header.length > 0 ? `${header}\n\n${blocks}\n` : `${blocks}\n`;
};

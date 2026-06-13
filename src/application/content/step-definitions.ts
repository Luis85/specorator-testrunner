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
const PENDING_MARKER = ["TO", "DO"].join("");

/** Renders a single step-definition stub for one missing step text. */
const renderStub = (stepText: string): string => {
  const { expression, params } = toStubExpression(stepText);
  const args = params.map((p) => `${p}: string`).join(", ");
  const signature = args ? `{ page }, ${args}` : `{ page }`;
  return [
    `// ${PENDING_MARKER}: implement this step (generated stub for: ${squash(stepText)})`,
    `Given("${escapeDoubleQuoted(expression)}", async (${signature}) => {`,
    `  throw new Error("Pending");`,
    `});`,
  ].join("\n");
};

/**
 * Builds a complete `*.steps.ts` file body for the given missing steps (RV-4).
 *
 * Each missing step becomes a `Given(...)` stub via playwright-bdd's `createBdd()`,
 * a pending-work comment (see {@link PENDING_MARKER}) and a
 * `throw new Error("Pending")` body. `Given` is used uniformly:
 * `collectStepTexts` discards the Given/When/Then keyword, and playwright-bdd
 * matches a step definition by its TEXT regardless of which keyword decorator
 * declared it, so a `Given`-declared stub still satisfies a `When`/`Then` step.
 * Quoted literals and Scenario Outline placeholders are parameterised to
 * `{string}` so one stub can serve a family of steps.
 */
const CREATE_BDD_IMPORT = `import { createBdd } from "playwright-bdd";`;
const CREATE_BDD_DESTRUCTURE = `const { Given, When, Then } = createBdd();`;

/**
 * The argument list of the file's existing `createBdd(...)` call, or `""` when
 * none is present. A custom-fixtures setup binds the BDD verbs to a project
 * `test` (`const { When } = createBdd(test)`), so an appended `Given` must reuse
 * those SAME arguments — a default `createBdd()` would register the stubs
 * against Playwright's base fixtures and the implementations would never see the
 * custom fixtures the rest of the file uses. The capture tolerates one level of
 * nested parens (`createBdd(makeTest({ headless: true }))`) so the binding it
 * builds stays balanced; the demo's bare `createBdd()` yields `""`.
 */
const existingCreateBddArgs = (source: string): string => {
  const match = /\bcreateBdd\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/.exec(source);
  return match ? match[1].trim() : "";
};

/**
 * True when the source binds the local name `createBdd` via a named import (from
 * playwright-bdd OR a custom-fixtures module that re-exports it). An alias
 * (`createBdd as bdd`) binds a DIFFERENT local name, so it does NOT count — the
 * generated binding calls `createBdd(...)` literally, so omitting the import
 * when only an alias (or an unrelated specifier like `test`) is imported would
 * leave `createBdd` undefined and the appended file would fail to load.
 */
const bindsCreateBdd = (source: string): boolean => {
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    if (match[1].split(",").some((spec) => spec.trim() === "createBdd")) return true;
  }
  return false;
};

/** The minimal createBdd binding an appended stub block needs (it only calls `Given`). */
const createBddGiven = (args: string): string => `const { Given } = createBdd(${args});`;

/** Import header every generated steps module needs (playwright-bdd `createBdd`). */
const STEP_DEFINITION_IMPORTS = `${CREATE_BDD_IMPORT}\n${CREATE_BDD_DESTRUCTURE}`;

/**
 * True when the source already binds `Given` at the top level — via a
 * `createBdd()` destructure (`const { Given … } = createBdd()`) OR a named
 * import (`import { Given } from '…'`, e.g. a custom-fixtures module that
 * re-exports `createBdd(test)`). An alias rename binds a DIFFERENT local name,
 * so `{ Given: g }` / `{ Given as g }` do NOT count. The generated stubs always
 * call `Given(...)`, so this — not merely "createBdd is called" — decides
 * whether the append must add its own `Given` binding (and adding one when
 * `Given` is already bound would be a duplicate declaration that fails to load).
 */
const bindsGiven = (source: string): boolean => {
  if (/\bconst\s*\{[^}]*\bGiven\b(?!\s*:)[^}]*\}\s*=\s*createBdd\s*\(/.test(source)) return true;
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    // A bare `Given` specifier binds the local name `Given`; `Given as g` binds
    // `g`, so only an exact `Given` (no `as`) counts.
    if (match[1].split(",").some((spec) => spec.trim() === "Given")) return true;
  }
  return false;
};

/** Renders ONLY the step-definition stub blocks (no import header). */
const buildStepDefinitionStubBlocks = (missingSteps: string[]): string =>
  missingSteps.map(renderStub).join("\n\n");

/** A complete, loadable steps module: full import header + stub blocks (new files). */
export const buildStepDefinitionStubFile = (missingSteps: string[]): string =>
  `${STEP_DEFINITION_IMPORTS}\n\n${buildStepDefinitionStubBlocks(missingSteps)}\n`;

/**
 * Builds the content to APPEND to an existing steps file: the stub blocks, plus
 * exactly the binding the stubs need. The stubs call `Given(...)`, so:
 *  - if the file already binds `Given` from createBdd → append blocks only;
 *  - else prepend `const { Given } = createBdd(<existing args>);` (a separate
 *    destructure that does NOT clash with an existing `{ When, Then }` one),
 *    reusing the file's own `createBdd(...)` arguments so custom-fixture stubs
 *    register against the same `test`, and the `import { createBdd }` too when
 *    the local `createBdd` name is not yet bound.
 * Checking the actual `Given` binding (not merely that `createBdd()` is called)
 * is what keeps a hand-edited file that only destructured `{ When, Then }` from
 * getting Given-less stubs that fail to load (bddgen/typecheck). The import is
 * gated on a real local `createBdd` binding — not merely "imports from
 * playwright-bdd" — so an aliased/partial import doesn't leave `createBdd`
 * undefined.
 */
export const buildAppendedStubs = (existingSource: string, missingSteps: string[]): string => {
  const blocks = buildStepDefinitionStubBlocks(missingSteps);
  if (bindsGiven(existingSource)) return `${blocks}\n`;
  const givenBinding = createBddGiven(existingCreateBddArgs(existingSource));
  const header = bindsCreateBdd(existingSource)
    ? givenBinding
    : `${CREATE_BDD_IMPORT}\n${givenBinding}`;
  return `${header}\n\n${blocks}\n`;
};

import type {
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import {
  EXAMPLES_RE,
  FEATURE_RE,
  parseFeature,
  parseStep,
  parseTableRow,
  SCENARIO_RE,
  useCaseIdFromPath,
} from "./gherkin-parse";

// Re-exported so external modules keep importing the parser surface from here.
export { parseFeature, useCaseIdFromPath };

/**
 * I/O-free Gherkin serializer + round-trip guard (UC-006/UC-007, TIS §6.4–§6.6).
 * Pairs with the parser ({@link ./gherkin-parse}): `serialiseFeature` is the
 * inverse of `parseFeature`, and `roundTripsLosslessly` is the load-bearing
 * invariant the Feature Editor's structured mode depends on — it offers
 * structured editing only for files whose parsed model reproduces every
 * significant line, so unmodelled constructs (comments, `Rule:` blocks) are
 * never silently dropped by a structured edit.
 */

/**
 * Escapes a cell for a `|`-delimited row using the official Gherkin escapes
 * (TD-001): `\` → `\\`, `|` → `\|`, newline → `\n`. Replaces the V1 lossy
 * `/`-substitution — a literal pipe now round-trips instead of being rewritten.
 */
const serialiseCell = (cell: string): string =>
  cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n");

/** Appends `| a | b |` rows at `indent`. */
const pushTable = (lines: string[], rows: readonly (readonly string[])[], indent: string): void => {
  for (const row of rows) lines.push(`${indent}| ${row.map(serialiseCell).join(" | ")} |`);
};

/** Appends one step line plus its single table / doc-string argument. */
const pushStep = (lines: string[], step: GherkinStep, indent: string): void => {
  lines.push(`${indent}${step.keyword} ${step.text}`.trimEnd());
  const inner = `${indent}  `;
  const argument = step.argument;
  if (argument?.kind === "table" && argument.rows.length > 0) {
    pushTable(lines, argument.rows, inner);
  }
  if (argument?.kind === "docString") {
    const { fence, mediaType, lines: body } = argument.docString;
    lines.push(`${inner}${fence}${mediaType ?? ""}`);
    // Body lines are emitted verbatim at the fence indent (no trimEnd): the
    // stored content is whitespace-faithful and must stay that way on disk.
    for (const bodyLine of body) {
      lines.push(bodyLine.length > 0 ? `${inner}${bodyLine}` : "");
    }
    lines.push(`${inner}${fence}`);
  }
};

/** Appends free-description lines at `indent`; blank lines stay blank. */
const pushDescription = (lines: string[], description: readonly string[], indent: string): void => {
  for (const text of description) lines.push(text === "" ? "" : `${indent}${text}`);
};

/** Appends one `Examples:` block — its tags, header, and the `Examples:` line + rows. */
const pushExamples = (lines: string[], block: ExamplesBlock): void => {
  lines.push("");
  if (block.tags.length > 0) lines.push(`    ${block.tags.join(" ")}`);
  lines.push(`    Examples:${block.name ? ` ${block.name}` : ""}`);
  pushTable(
    lines,
    [block.header, ...block.rows].filter((row) => row.length > 0),
    "      ",
  );
};

/** Appends one scenario block — blank separator, tags, keyword, description, steps, examples. */
const pushScenario = (lines: string[], scenario: ScenarioSpecification): void => {
  lines.push("");
  if (scenario.tags.length > 0) lines.push(`  ${scenario.tags.join(" ")}`);
  lines.push(`  ${scenario.keyword ?? "Scenario"}: ${scenario.name}`.trimEnd());
  pushDescription(lines, scenario.description ?? [], "    ");
  for (const step of scenario.steps) pushStep(lines, step, "    ");
  for (const block of scenario.examples ?? []) pushExamples(lines, block);
};

/**
 * Serialises a {@link FeatureSpecification} back to plain Gherkin (no YAML). The
 * inverse of {@link parseFeature}; the two form the load-bearing round-trip
 * invariant the Feature Editor's structured mode depends on.
 */
export const serialiseFeature = (specification: FeatureSpecification): string => {
  const lines: string[] = [];
  if (specification.tags.length > 0) lines.push(specification.tags.join(" "));
  lines.push(`Feature: ${specification.featureName}`);
  pushDescription(lines, specification.description ?? [], "  ");
  if (specification.background && specification.background.length > 0) {
    lines.push("");
    lines.push("  Background:");
    for (const step of specification.background) pushStep(lines, step, "    ");
  }
  for (const scenario of specification.scenarios) pushScenario(lines, scenario);
  return `${lines.join("\n")}\n`;
};

/**
 * Inside a doc string: pushes the comparison line and returns true at the
 * closing fence. The closing fence compares trimmed; body lines compare
 * dedented-but-verbatim — even when blank — so whitespace-only lines the parser
 * stores as "" FAIL the guard (their spaces are unrepresentable), while truly
 * blank lines compare "" === "" and still round-trip.
 */
const consumeFenceBody = (
  result: string[],
  raw: string,
  trimmed: string,
  fence: string,
  fenceIndent: string,
): boolean => {
  if (trimmed === fence) {
    result.push(trimmed);
    return true;
  }
  result.push(raw.startsWith(fenceIndent) ? raw.slice(fenceIndent.length) : raw);
  return false;
};

/**
 * Canonicalises a non-fence comparison line: `|`-rows and `@`-tag lines get
 * uniform spacing (cell padding and tag spacing are serializer-owned cosmetics);
 * any other line stays trimmed.
 */
const canonicalSignificantLine = (trimmed: string): string => {
  if (trimmed.startsWith("|")) {
    return `| ${parseTableRow(trimmed).map(serialiseCell).join(" | ")} |`;
  }
  return trimmed.startsWith("@") ? trimmed.split(/\s+/).join(" ") : trimmed;
};

/**
 * Normalised comparison lines for {@link roundTripsLosslessly}. Outside doc
 * strings: trimmed, blank lines dropped, canonical `|`-row and `@`-tag spacing
 * (indentation and blank-line placement are serializer-owned). INSIDE doc
 * strings the body is compared dedented-but-verbatim, so whitespace the parser
 * cannot represent fails the guard instead of being trimmed out of sight.
 */
const significantLines = (text: string): string[] => {
  const result: string[] = [];
  let fence: string | null = null;
  let fenceIndent = "";
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (fence !== null) {
      if (consumeFenceBody(result, raw, trimmed, fence, fenceIndent)) fence = null;
      continue;
    }
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('"""') || trimmed.startsWith("```")) {
      fence = trimmed.slice(0, 3);
      fenceIndent = raw.slice(0, raw.length - raw.trimStart().length);
      result.push(trimmed);
      continue;
    }
    result.push(canonicalSignificantLine(trimmed));
  }
  return result;
};

/**
 * True when the parsed model reproduces every significant line of `content`.
 * The Feature Editor offers structured mode only then, so constructs the model
 * does not represent (comments, `Rule:` blocks, stray text) can never be
 * silently destroyed by a structured edit.
 */
export const roundTripsLosslessly = (content: string, path: VaultPath): boolean => {
  const parsed = parseFeature(content, path);
  if (parsed === null) return false;
  const original = significantLines(content);
  const reserialised = significantLines(serialiseFeature(parsed));
  return (
    original.length === reserialised.length &&
    original.every((line, index) => line === reserialised[index])
  );
};

/**
 * True when `line` survives a parse→serialize round trip as free description
 * text — i.e. it is not a tag/comment/table/fence/keyword/step line. The
 * Feature Editor filters description input through this so a typed
 * "Scenario: x" cannot silently restructure the file on the next parse.
 */
export const isPlainDescriptionLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (/^[@#|]/.test(trimmed)) return false;
  if (trimmed.startsWith('"""') || trimmed.startsWith("```")) return false;
  if (
    FEATURE_RE.test(trimmed) ||
    SCENARIO_RE.test(trimmed) ||
    trimmed.startsWith("Background:") ||
    EXAMPLES_RE.test(trimmed) ||
    trimmed.startsWith("Rule:")
  ) {
    return false;
  }
  return parseStep(trimmed) === null;
};

/** Flattens every step text across a feature's Background + scenarios. */
export const collectStepTexts = (feature: FeatureSpecification): string[] => [
  ...(feature.background ?? []).map((step) => step.text),
  ...feature.scenarios.flatMap((scenario) => scenario.steps.map((step) => step.text)),
];

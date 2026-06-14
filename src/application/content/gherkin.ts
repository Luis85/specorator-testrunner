import type {
  DocString,
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";

/**
 * I/O-free Gherkin parser + serializer (UC-006/UC-007, TIS §6.4–§6.6).
 *
 * The parser models executable Gherkin: `Feature:`, `Background:`,
 * `Scenario:`/`Scenario Outline:` (with `Examples:` tables), tag lines, the
 * step keywords (Given/When/Then/And/But/*), per-step data tables and doc
 * strings, and free-text descriptions. NOT modelled: comments (`#`) and
 * `Rule:` blocks — {@link roundTripsLosslessly} exists so the Feature Editor
 * falls back to raw-text editing for files carrying constructs the model
 * would silently drop. `useCaseId` is derived from the filename prefix
 * `UC-\d+` per ADR-0012, not from the file body.
 */

const STEP_KEYWORDS: readonly GherkinStep["keyword"][] = [
  "Given",
  "When",
  "Then",
  "And",
  "But",
  "*",
];

// ADR-0012: the filename must START with `<UC-id>-<slug>`, so anchor to the
// basename start — `archive-UC-1-old.feature` is an orphan, not UC-1.
const UC_PREFIX = /^(UC-\d+)-/i;

/**
 * Extracts the leading `UC-NNN` prefix from a feature filename (ADR-0012).
 *
 * Accepts a plain `string`, not a `VaultPath`: this is a read-only parser of the
 * filename's leading id, not a path consumer, so it also runs over report
 * `featureUri`/`feature` strings and run targets that are not branded paths.
 */
export const useCaseIdFromPath = (path: string): UseCaseId | null => {
  const base = path.split("/").pop() ?? path;
  const match = UC_PREFIX.exec(base);
  return match ? match[1].toUpperCase() : null;
};

/** Splits a `@a @b` tag line into individual tags (keeps the leading `@`). */
const parseTagLine = (line: string): string[] =>
  line
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith("@"));

/** Matches a step line, returning the keyword and remaining text. */
const parseStep = (line: string): GherkinStep | null => {
  const trimmed = line.trim();
  for (const keyword of STEP_KEYWORDS) {
    if (keyword === "*") {
      // `*` accepts empty text like every other keyword (`Given` alone parses);
      // a lone `*` is a zero-text step, not description text.
      if (trimmed === "*" || trimmed.startsWith("* ")) {
        return { keyword: "*", text: trimmed.slice(1).trim() };
      }
      continue;
    }
    if (trimmed === keyword || trimmed.startsWith(`${keyword} `)) {
      return { keyword, text: trimmed.slice(keyword.length).trim() };
    }
  }
  return null;
};

const FEATURE_RE = /^Feature:\s*(.*)$/;
const SCENARIO_RE = /^Scenario(\s+Outline)?:\s*(.*)$/;
const EXAMPLES_RE = /^Examples:\s*(.*)$/;
// `Rule:` blocks are NOT modelled (see the module doc); the `startsWith("Rule:")`
// guards below exist so a Rule line is never mistaken for description text.

/**
 * Splits a `| a | b |` row into trimmed cells, honouring the official
 * Gherkin cell escapes: `\|` → `|`, `\\` → `\`, `\n` → newline (TD-001).
 * Any other backslash sequence is kept verbatim (lenient parse).
 */
const parseTableRow = (line: string): string[] => {
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\") {
      const next = line[i + 1];
      if (next === "|" || next === "\\") {
        current += next;
        i++;
      } else if (next === "n") {
        current += "\n";
        i++;
      } else {
        current += char;
      }
    } else if (char === "|") {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  segments.push(current);
  // Drop the empty boundary segments produced by the leading `|` and (when
  // present) the trailing `|`; inner empty cells survive.
  if (segments.length > 0 && segments[0].trim() === "") segments.shift();
  if (segments.length > 0 && segments[segments.length - 1].trim() === "") segments.pop();
  return segments.map((cell) => cell.trim());
};

/** Drops leading/trailing blank entries; interior blanks are paragraph breaks. */
const trimBlankEdges = (lines: string[]): string[] => {
  const start = lines.findIndex((line) => line !== "");
  if (start === -1) return [];
  let end = lines.length - 1;
  while (lines[end] === "") end -= 1;
  return lines.slice(start, end + 1);
};

/**
 * Parses Gherkin `content` into a {@link FeatureSpecification}. Returns `null`
 * when the text has no `Feature:` line. `path` supplies the required
 * `useCaseId` (ADR-0012); when the filename carries no `UC-NNN` prefix the
 * `useCaseId` is left empty so the validator can flag it as an orphan.
 */
// fallow-ignore-next-line complexity
export const parseFeature = (content: string, path: VaultPath): FeatureSpecification | null => {
  const lines = content.split(/\r?\n/);

  let featureName: string | null = null;
  const featureTags: string[] = [];
  const featureDescription: string[] = [];
  const scenarios: ScenarioSpecification[] = [];
  const background: GherkinStep[] = [];

  // Tags accumulate on the line(s) directly above a Feature/Scenario/Examples keyword.
  let pendingTags: string[] = [];
  let current: ScenarioSpecification | null = null;
  let inBackground = false;
  // Free-text lines flow here until the block's first step/table/keyword line.
  let descriptionTarget: string[] | null = null;
  // The step a `|` table row or doc string attaches to (the most recent step).
  let lastStep: GherkinStep | null = null;
  // The Examples block currently collecting `|` rows (header row first).
  let currentExamples: ExamplesBlock | null = null;
  // An open doc string collects dedented body lines until its closing fence.
  let openDocString: DocString | null = null;
  let docStringIndent = "";

  for (const raw of lines) {
    const line = raw.trim();

    if (openDocString !== null) {
      if (line === openDocString.fence) {
        openDocString = null;
        continue;
      }
      // Dedent by the opening fence's indentation (Gherkin doc-string rule),
      // otherwise VERBATIM — doc strings can be whitespace-significant, and the
      // guard's doc-aware comparison must see exactly what is stored. A line
      // shallower than the fence keeps only its trimmed text; the guard then
      // fails (the model cannot represent negative relative indentation).
      openDocString.lines.push(
        raw.startsWith(docStringIndent) ? raw.slice(docStringIndent.length) : line,
      );
      continue;
    }
    if (line.startsWith('"""') || line.startsWith("```")) {
      const fence: DocString["fence"] = line.startsWith('"""') ? '"""' : "```";
      const mediaType = line.slice(3).trim();
      openDocString = { fence, ...(mediaType ? { mediaType } : {}), lines: [] };
      docStringIndent = raw.slice(0, raw.length - raw.trimStart().length);
      // Without a preceding step the body is still consumed (it is an argument,
      // never steps) but cannot be attached — roundTripsLosslessly catches it.
      // First argument wins (TD-002): a doc string after a table is dropped and
      // the round-trip guard sends the file to raw mode.
      if (lastStep && lastStep.argument === undefined) {
        lastStep.argument = { kind: "docString", docString: openDocString };
      }
      continue;
    }

    if (line === "") {
      // A blank line inside a description block is a paragraph break the
      // serializer must reproduce; boundary blanks are trimmed after the loop.
      if (descriptionTarget !== null) descriptionTarget.push("");
      continue;
    }
    if (line.startsWith("#")) continue;

    if (line.startsWith("@")) {
      pendingTags.push(...parseTagLine(line));
      descriptionTarget = null; // a tag line ends a description block
      continue;
    }

    const featureMatch = FEATURE_RE.exec(line);
    if (featureMatch) {
      featureName = featureMatch[1].trim();
      featureTags.push(...pendingTags);
      pendingTags = [];
      current = null;
      inBackground = false;
      descriptionTarget = featureDescription;
      lastStep = null;
      currentExamples = null;
      continue;
    }

    // Background steps run before every scenario; collected separately so they
    // are checked by detectMissingSteps and round-trip as a `Background:` block.
    if (line.startsWith("Background:")) {
      current = null;
      inBackground = true;
      pendingTags = [];
      descriptionTarget = null;
      lastStep = null;
      currentExamples = null;
      continue;
    }

    const scenarioMatch = SCENARIO_RE.exec(line);
    if (scenarioMatch) {
      current = {
        ...(scenarioMatch[1] ? { keyword: "Scenario Outline" as const } : {}),
        name: scenarioMatch[2].trim(),
        tags: pendingTags,
        steps: [],
      };
      scenarios.push(current);
      pendingTags = [];
      inBackground = false;
      descriptionTarget = [];
      lastStep = null;
      currentExamples = null;
      continue;
    }

    const examplesMatch = EXAMPLES_RE.exec(line);
    if (examplesMatch && current) {
      const name = examplesMatch[1].trim();
      currentExamples = {
        tags: pendingTags,
        ...(name ? { name } : {}),
        header: [],
        rows: [],
      };
      (current.examples ??= []).push(currentExamples);
      pendingTags = [];
      descriptionTarget = null;
      lastStep = null;
      continue;
    }

    if (line.startsWith("|")) {
      const cells = parseTableRow(line);
      if (currentExamples) {
        if (currentExamples.header.length === 0) currentExamples.header = cells;
        else currentExamples.rows.push(cells);
      } else if (lastStep) {
        if (lastStep.argument === undefined) {
          lastStep.argument = { kind: "table", rows: [cells] };
        } else if (lastStep.argument.kind === "table") {
          lastStep.argument.rows.push(cells);
        }
        // else: the step already carries a doc string — Gherkin allows ONE
        // argument (TD-002). Drop the row; the round-trip guard then fails the
        // file into raw mode, which is correct (Cucumber rejects the file too).
      }
      descriptionTarget = null;
      continue;
    }

    const step = parseStep(line);
    if (step) {
      descriptionTarget = null;
      currentExamples = null;
      if (inBackground) {
        background.push(step);
        lastStep = step;
        continue;
      }
      if (current) {
        current.steps.push(step);
        lastStep = step;
        continue;
      }
    }

    if (step === null && descriptionTarget !== null && !line.startsWith("Rule:")) {
      descriptionTarget.push(line);
      // A scenario's description array is attached on its first line so empty
      // descriptions never appear in the model (keeps round trips stable).
      if (current && !current.description && descriptionTarget !== featureDescription) {
        current.description = descriptionTarget;
      }
      continue;
    }

    // Anything else (Rule:, free text after steps) is ignored, and a stray tag
    // block that did not attach to a keyword is discarded — both make
    // roundTripsLosslessly fail, so the Feature Editor falls back to raw text.
    pendingTags = [];
  }

  if (featureName === null) return null;

  for (const scenario of scenarios) {
    if (!scenario.description) continue;
    const trimmedDescription = trimBlankEdges(scenario.description);
    if (trimmedDescription.length === 0) delete scenario.description;
    else scenario.description = trimmedDescription;
  }
  const description = trimBlankEdges(featureDescription);

  return {
    path,
    useCaseId: useCaseIdFromPath(path) ?? "",
    featureName,
    tags: featureTags,
    ...(description.length > 0 ? { description } : {}),
    ...(background.length > 0 ? { background } : {}),
    scenarios,
  };
};

/**
 * Escapes a cell for a `|`-delimited row using the official Gherkin escapes
 * (TD-001): `\` → `\\`, `|` → `\|`, newline → `\n`. Replaces the V1 lossy
 * `/`-substitution — a literal pipe now round-trips instead of being
 * rewritten.
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

/**
 * Serialises a {@link FeatureSpecification} back to plain Gherkin (no YAML).
 * Lives next to {@link parseFeature} because the two form the load-bearing
 * round-trip invariant the Feature Editor's structured mode depends on.
 */
// fallow-ignore-next-line complexity
export const serialiseFeature = (specification: FeatureSpecification): string => {
  const lines: string[] = [];
  if (specification.tags.length > 0) lines.push(specification.tags.join(" "));
  lines.push(`Feature: ${specification.featureName}`);
  for (const text of specification.description ?? []) {
    lines.push(text === "" ? "" : `  ${text}`);
  }
  if (specification.background && specification.background.length > 0) {
    lines.push("");
    lines.push("  Background:");
    for (const step of specification.background) pushStep(lines, step, "    ");
  }
  for (const scenario of specification.scenarios) {
    lines.push("");
    if (scenario.tags.length > 0) lines.push(`  ${scenario.tags.join(" ")}`);
    lines.push(`  ${scenario.keyword ?? "Scenario"}: ${scenario.name}`.trimEnd());
    for (const text of scenario.description ?? []) {
      lines.push(text === "" ? "" : `    ${text}`);
    }
    for (const step of scenario.steps) pushStep(lines, step, "    ");
    for (const block of scenario.examples ?? []) {
      lines.push("");
      if (block.tags.length > 0) lines.push(`    ${block.tags.join(" ")}`);
      lines.push(`    Examples:${block.name ? ` ${block.name}` : ""}`);
      pushTable(
        lines,
        [block.header, ...block.rows].filter((row) => row.length > 0),
        "      ",
      );
    }
  }
  return `${lines.join("\n")}\n`;
};

/**
 * Normalised comparison lines for {@link roundTripsLosslessly}. Outside doc
 * strings: trimmed, blank lines dropped, canonical `|`-row and `@`-tag
 * spacing (indentation and blank-line placement are serializer-owned; cell
 * padding and tag spacing are cosmetic). INSIDE doc strings the body is
 * compared dedented-but-verbatim, so whitespace the parser cannot represent
 * fails the guard instead of being trimmed out of sight.
 */
// fallow-ignore-next-line complexity
const significantLines = (text: string): string[] => {
  const result: string[] = [];
  let fence: string | null = null;
  let fenceIndent = "";
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (fence !== null) {
      if (trimmed === fence) {
        fence = null;
        result.push(trimmed);
        continue;
      }
      // Compared even when blank: a whitespace-only body line the parser
      // stores as "" must FAIL the guard (its spaces are unrepresentable),
      // while truly-blank lines compare "" === "" and still round-trip.
      result.push(raw.startsWith(fenceIndent) ? raw.slice(fenceIndent.length) : raw);
      continue;
    }
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('"""') || trimmed.startsWith("```")) {
      fence = trimmed.slice(0, 3);
      fenceIndent = raw.slice(0, raw.length - raw.trimStart().length);
      result.push(trimmed);
      continue;
    }
    if (trimmed.startsWith("|")) {
      result.push(`| ${parseTableRow(trimmed).map(serialiseCell).join(" | ")} |`);
      continue;
    }
    result.push(trimmed.startsWith("@") ? trimmed.split(/\s+/).join(" ") : trimmed);
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

import type {
  DocString,
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { trimBlankEdges } from "../../shared/utils/lines";

/**
 * I/O-free Gherkin parser (UC-006/UC-007, TIS §6.4–§6.6). Split from the
 * serializer ({@link ../content/gherkin}) so each side stays within the size
 * budget; the two together form the round-trip invariant the Feature Editor's
 * structured mode depends on (`roundTripsLosslessly`).
 *
 * The parser models executable Gherkin: `Feature:`, `Background:`,
 * `Scenario:`/`Scenario Outline:` (with `Examples:` tables), tag lines, the step
 * keywords (Given/When/Then/And/But/*), per-step data tables and doc strings,
 * and free-text descriptions. NOT modelled: comments (`#`) and `Rule:` blocks —
 * `roundTripsLosslessly` exists so the Feature Editor falls back to raw-text
 * editing for files carrying constructs the model would silently drop.
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
export const parseStep = (line: string): GherkinStep | null => {
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

export const FEATURE_RE = /^Feature:\s*(.*)$/;
export const SCENARIO_RE = /^Scenario(\s+Outline)?:\s*(.*)$/;
export const EXAMPLES_RE = /^Examples:\s*(.*)$/;
// `Rule:` blocks are NOT modelled (see the module doc); the `startsWith("Rule:")`
// guards below exist so a Rule line is never mistaken for description text.

/**
 * Splits a `| a | b |` row into trimmed cells, honouring the official Gherkin
 * cell escapes: `\|` → `|`, `\\` → `\`, `\n` → newline (TD-001). Any other
 * backslash sequence is kept verbatim (lenient parse).
 */
export const parseTableRow = (line: string): string[] => {
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

/**
 * The mutable accumulator threaded through the per-line classifiers below while
 * {@link parseFeature} scans a feature file. Each `consume*` handler mutates the
 * relevant slice and reports whether it claimed the line.
 */
interface ParseState {
  featureName: string | null;
  featureTags: string[];
  featureDescription: string[];
  scenarios: ScenarioSpecification[];
  background: GherkinStep[];
  /** Tags accumulate on the line(s) directly above a Feature/Scenario/Examples keyword. */
  pendingTags: string[];
  current: ScenarioSpecification | null;
  inBackground: boolean;
  /** Free-text lines flow here until the block's first step/table/keyword line. */
  descriptionTarget: string[] | null;
  /** The step a `|` table row or doc string attaches to (the most recent step). */
  lastStep: GherkinStep | null;
  /** The Examples block currently collecting `|` rows (header row first). */
  currentExamples: ExamplesBlock | null;
  /** An open doc string collects dedented body lines until its closing fence. */
  openDocString: DocString | null;
  docStringIndent: string;
}

/** Consumes a line inside an open doc string, closing it at the matching fence. */
const consumeDocStringBody = (state: ParseState, raw: string, line: string): boolean => {
  const doc = state.openDocString;
  if (doc === null) return false;
  if (line === doc.fence) {
    state.openDocString = null;
    return true;
  }
  // Dedent by the opening fence's indentation (Gherkin doc-string rule),
  // otherwise VERBATIM — doc strings can be whitespace-significant, and the
  // guard's doc-aware comparison must see exactly what is stored. A line
  // shallower than the fence keeps only its trimmed text; the guard then fails
  // (the model cannot represent negative relative indentation).
  doc.lines.push(
    raw.startsWith(state.docStringIndent) ? raw.slice(state.docStringIndent.length) : line,
  );
  return true;
};

/** Opens a doc string at a `"""`/```` ``` ```` fence, attaching it to the last step. */
const openDocStringFence = (state: ParseState, raw: string, line: string): boolean => {
  if (!line.startsWith('"""') && !line.startsWith("```")) return false;
  const fence: DocString["fence"] = line.startsWith('"""') ? '"""' : "```";
  const mediaType = line.slice(3).trim();
  const docString: DocString = { fence, ...(mediaType ? { mediaType } : {}), lines: [] };
  state.openDocString = docString;
  state.docStringIndent = raw.slice(0, raw.length - raw.trimStart().length);
  // Without a preceding step the body is still consumed (it is an argument, never
  // steps) but cannot be attached — roundTripsLosslessly catches it. First
  // argument wins (TD-002): a doc string after a table is dropped and the
  // round-trip guard sends the file to raw mode.
  if (state.lastStep && state.lastStep.argument === undefined) {
    state.lastStep.argument = { kind: "docString", docString };
  }
  return true;
};

/** Consumes a blank line; a blank inside a description block is a paragraph break. */
const consumeBlank = (state: ParseState, line: string): boolean => {
  if (line !== "") return false;
  // The serializer reproduces inner blanks; boundary blanks are trimmed after the loop.
  if (state.descriptionTarget !== null) state.descriptionTarget.push("");
  return true;
};

/** Consumes a `@tag` line, accumulating tags for the next keyword. */
const consumeTag = (state: ParseState, line: string): boolean => {
  if (!line.startsWith("@")) return false;
  state.pendingTags.push(...parseTagLine(line));
  state.descriptionTarget = null; // a tag line ends a description block
  return true;
};

/** Consumes the `Feature:` line, attaching pending tags and opening its description. */
const consumeFeature = (state: ParseState, line: string): boolean => {
  const match = FEATURE_RE.exec(line);
  if (!match) return false;
  state.featureName = match[1].trim();
  state.featureTags.push(...state.pendingTags);
  state.pendingTags = [];
  state.current = null;
  state.inBackground = false;
  state.descriptionTarget = state.featureDescription;
  state.lastStep = null;
  state.currentExamples = null;
  return true;
};

/**
 * Consumes a `Background:` line. Background steps run before every scenario;
 * collected separately so detectMissingSteps checks them and they round-trip as
 * a `Background:` block.
 */
const consumeBackground = (state: ParseState, line: string): boolean => {
  if (!line.startsWith("Background:")) return false;
  state.current = null;
  state.inBackground = true;
  state.pendingTags = [];
  state.descriptionTarget = null;
  state.lastStep = null;
  state.currentExamples = null;
  return true;
};

/** Consumes a `Scenario:`/`Scenario Outline:` line, starting a new scenario. */
const consumeScenario = (state: ParseState, line: string): boolean => {
  const match = SCENARIO_RE.exec(line);
  if (!match) return false;
  const scenario: ScenarioSpecification = {
    ...(match[1] ? { keyword: "Scenario Outline" as const } : {}),
    name: match[2].trim(),
    tags: state.pendingTags,
    steps: [],
  };
  state.scenarios.push(scenario);
  state.current = scenario;
  state.pendingTags = [];
  state.inBackground = false;
  state.descriptionTarget = [];
  state.lastStep = null;
  state.currentExamples = null;
  return true;
};

/** Consumes an `Examples:` line (only inside a scenario), starting an examples block. */
const consumeExamples = (state: ParseState, line: string): boolean => {
  const match = EXAMPLES_RE.exec(line);
  if (!match || !state.current) return false;
  const name = match[1].trim();
  const examples: ExamplesBlock = {
    tags: state.pendingTags,
    ...(name ? { name } : {}),
    header: [],
    rows: [],
  };
  (state.current.examples ??= []).push(examples);
  state.currentExamples = examples;
  state.pendingTags = [];
  state.descriptionTarget = null;
  state.lastStep = null;
  return true;
};

/** Consumes a `|`-table row, attaching it to the open Examples block or the last step. */
const consumeTableRow = (state: ParseState, line: string, lineNo: number): boolean => {
  if (!line.startsWith("|")) return false;
  const cells = parseTableRow(line);
  if (state.currentExamples) {
    if (state.currentExamples.header.length === 0) state.currentExamples.header = cells;
    else {
      state.currentExamples.rows.push(cells);
      (state.currentExamples.rowLines ??= []).push(lineNo);
    }
  } else if (state.lastStep) {
    if (state.lastStep.argument === undefined) {
      state.lastStep.argument = { kind: "table", rows: [cells] };
    } else if (state.lastStep.argument.kind === "table") {
      state.lastStep.argument.rows.push(cells);
    }
    // else: the step already carries a doc string — Gherkin allows ONE argument
    // (TD-002). Drop the row; the round-trip guard then fails the file into raw
    // mode, which is correct (the Gherkin parser rejects the file too).
  }
  state.descriptionTarget = null;
  return true;
};

/**
 * Consumes a step line — appending it to the Background or current scenario — or,
 * when the line is not a step, a free-description line. A step parsed with no
 * Background/Scenario context clears the description/examples targets and falls
 * through (returns false) to the stray-line reset, exactly as the inline parser
 * did. The first description line of a scenario attaches its array so empty
 * descriptions never enter the model (keeps round trips stable).
 */
const consumeStepOrDescription = (state: ParseState, line: string): boolean => {
  const step = parseStep(line);
  if (step) {
    state.descriptionTarget = null;
    state.currentExamples = null;
    if (state.inBackground) {
      state.background.push(step);
      state.lastStep = step;
      return true;
    }
    if (state.current) {
      state.current.steps.push(step);
      state.lastStep = step;
      return true;
    }
    return false;
  }
  if (state.descriptionTarget !== null && !line.startsWith("Rule:")) {
    state.descriptionTarget.push(line);
    if (
      state.current &&
      !state.current.description &&
      state.descriptionTarget !== state.featureDescription
    ) {
      state.current.description = state.descriptionTarget;
    }
    return true;
  }
  return false;
};

/** Dispatches one feature-file line to the first classifier that claims it. */
const classifyLine = (state: ParseState, raw: string, line: string, lineNo: number): void => {
  if (consumeDocStringBody(state, raw, line)) return;
  if (openDocStringFence(state, raw, line)) return;
  if (consumeBlank(state, line)) return;
  if (line.startsWith("#")) return;
  if (consumeTag(state, line)) return;
  if (consumeFeature(state, line)) return;
  if (consumeBackground(state, line)) return;
  if (consumeScenario(state, line)) return;
  if (consumeExamples(state, line)) return;
  if (consumeTableRow(state, line, lineNo)) return;
  if (consumeStepOrDescription(state, line)) return;
  // Anything else (Rule:, free text after steps) is ignored, and a stray tag
  // block that did not attach to a keyword is discarded — both make
  // roundTripsLosslessly fail, so the Feature Editor falls back to raw text.
  state.pendingTags = [];
};

/**
 * Parses Gherkin `content` into a {@link FeatureSpecification}. Returns `null`
 * when the text has no `Feature:` line. `path` supplies the required `useCaseId`
 * (ADR-0012); when the filename carries no `UC-NNN` prefix the `useCaseId` is
 * left empty so the validator can flag it as an orphan.
 */
export const parseFeature = (content: string, path: VaultPath): FeatureSpecification | null => {
  const state: ParseState = {
    featureName: null,
    featureTags: [],
    featureDescription: [],
    scenarios: [],
    background: [],
    pendingTags: [],
    current: null,
    inBackground: false,
    descriptionTarget: null,
    lastStep: null,
    currentExamples: null,
    openDocString: null,
    docStringIndent: "",
  };

  let lineNo = 0;
  for (const raw of content.split(/\r?\n/)) {
    lineNo += 1; // 1-based feature-file line of `raw`
    classifyLine(state, raw, raw.trim(), lineNo);
  }

  if (state.featureName === null) return null;

  for (const scenario of state.scenarios) {
    if (!scenario.description) continue;
    const trimmedDescription = trimBlankEdges(scenario.description);
    if (trimmedDescription.length === 0) delete scenario.description;
    else scenario.description = trimmedDescription;
  }
  const description = trimBlankEdges(state.featureDescription);

  return {
    path,
    useCaseId: useCaseIdFromPath(path) ?? "",
    featureName: state.featureName,
    tags: state.featureTags,
    ...(description.length > 0 ? { description } : {}),
    ...(state.background.length > 0 ? { background: state.background } : {}),
    scenarios: state.scenarios,
  };
};

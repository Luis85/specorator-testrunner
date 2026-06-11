import { isPlainDescriptionLine, useCaseIdFromPath } from "../../application/content/gherkin";
import {
  isStepDefined,
  type StepDefinitionPattern,
} from "../../application/content/step-definitions";
import type {
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";

/**
 * Pure helpers for the Feature Editor (the `.feature` file handler's
 * structured mode). DOM-free and I/O-free so the editing logic is
 * unit-testable, following the test-console-format.ts pattern.
 */

export interface ValidationItem {
  level: "error" | "warning";
  message: string;
}

/**
 * Live structural validation over the in-memory spec — the same rules as
 * `SpecificationService.validate` (name, ≥1 scenario, steps per scenario,
 * ADR-0012 filename prefix) so the editor strip and the Validate action
 * agree, plus editor-only hints (unnamed scenario, Outline without Examples
 * rows) for content that is still being typed.
 */
export const projectValidation = (specification: FeatureSpecification): ValidationItem[] => {
  const items: ValidationItem[] = [];
  if (useCaseIdFromPath(specification.path) === null) {
    items.push({
      level: "warning",
      message: 'No "UC-NNN-" filename prefix — this Feature is an orphan (ADR-0012).',
    });
  }
  if (specification.featureName.trim() === "") {
    items.push({ level: "error", message: "Feature has no name." });
  }
  if (specification.scenarios.length === 0) {
    items.push({ level: "error", message: "Feature has no scenarios." });
  }
  for (const scenario of specification.scenarios) {
    const label = scenario.name.trim() === "" ? "(unnamed)" : scenario.name;
    if (scenario.name.trim() === "") {
      items.push({ level: "warning", message: "A scenario has no name." });
    }
    if (scenario.steps.length === 0) {
      items.push({ level: "error", message: `Scenario "${label}" has no steps.` });
    }
    if (scenario.keyword === "Scenario Outline") {
      const hasRows = (scenario.examples ?? []).some((block) => block.rows.length > 0);
      if (!hasRows) {
        items.push({
          level: "warning",
          message: `Scenario Outline "${label}" has no Examples rows.`,
        });
      }
    }
  }
  return items;
};

/** Guided keyword flow: the first step reads `Given`, follow-ups read `And`. */
export const suggestedKeyword = (existingSteps: readonly GherkinStep[]): GherkinStep["keyword"] =>
  existingSteps.length === 0 ? "Given" : "And";

/** A fresh step for the add-step button (guided keyword pre-selected). */
export const newStep = (existingSteps: readonly GherkinStep[]): GherkinStep => ({
  keyword: suggestedKeyword(existingSteps),
  text: "",
});

/** A fresh scenario with one guided starter step. */
export const newScenario = (): ScenarioSpecification => ({
  name: "",
  tags: [],
  steps: [newStep([])],
});

/** A fresh Examples block with one named column and one empty row. */
export const newExamplesBlock = (): ExamplesBlock => ({
  tags: [],
  header: ["param"],
  rows: [[""]],
});

/** Moves `array[index]` one slot up/down; returns false when it cannot move. */
export const moveItem = <T>(array: T[], index: number, delta: -1 | 1): boolean => {
  const target = index + delta;
  if (index < 0 || index >= array.length || target < 0 || target >= array.length) return false;
  const [item] = array.splice(index, 1);
  array.splice(target, 0, item);
  return true;
};

/** Appends a uniquely-named column and pads every row. */
export const addExamplesColumn = (block: ExamplesBlock): void => {
  let name = "param";
  for (let n = 2; block.header.includes(name); n += 1) name = `param-${n}`;
  block.header.push(name);
  for (const row of block.rows) row.push("");
};

/** Removes column `index` from the header and every row (never the last one). */
export const removeExamplesColumn = (block: ExamplesBlock, index: number): void => {
  if (index < 0 || index >= block.header.length || block.header.length <= 1) return;
  block.header.splice(index, 1);
  for (const row of block.rows) row.splice(index, 1);
};

/** Appends an empty row matching the header width. */
export const addExamplesRow = (block: ExamplesBlock): void => {
  block.rows.push(block.header.map(() => ""));
};

/**
 * Normalises a tag chip input: trims, dashes inner whitespace, ensures the
 * leading `@`. Returns null when nothing tag-like remains.
 */
export const normalizeTag = (value: string): string | null => {
  const joined = value.trim().replace(/\s+/g, "-").replace(/^@+/, "");
  return joined === "" ? null : `@${joined}`;
};

/** Keeps a table cell round-trippable: a raw `|` would break the row syntax. */
export const sanitizeCell = (value: string): string => value.replace(/\|/g, "/").trim();

/** Picks a doc-string fence the body cannot terminate early. */
export const fenceFor = (lines: readonly string[]): '"""' | "```" =>
  lines.some((line) => line.trim() === '"""') ? "```" : '"""';

/**
 * Escapes body lines that would terminate the chosen fence early (Gherkin's
 * own `\"""` convention). Needed when the body contains BOTH delimiters, so
 * no fence choice alone is safe; Cucumber unescapes the backslash at runtime
 * while our parser keeps the line literal (trim ≠ fence → round-trip safe).
 */
export const sanitizeDocStringLines = (lines: readonly string[], fence: '"""' | "```"): string[] =>
  lines.map((line) => (line.trim() === fence ? line.replace(fence, `\\${fence}`) : line));

/** Splits textarea input into the lines that round-trip as description text. */
export const asDescriptionLines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => isPlainDescriptionLine(line));

/** De-duplicated datalist suggestions for the step-text inputs. */
export const stepSuggestions = (patterns: readonly StepDefinitionPattern[]): string[] => [
  ...new Set(patterns.map((pattern) => pattern.source)),
];

/**
 * True when the step needs no missing-definition flag. Empty text is
 * "incomplete", not "missing" (the validation strip owns that complaint).
 */
export const stepIsImplemented = (
  text: string,
  patterns: readonly StepDefinitionPattern[],
): boolean => text.trim() === "" || isStepDefined(text, [...patterns]);

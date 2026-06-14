import {
  structuralIssues,
  type ValidationItem,
} from "../../application/content/feature-validation";
import { isPlainDescriptionLine } from "../../application/content/gherkin";
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
import { isScenarioOutline } from "../../domain/entities/specification";
import { trimBlankEdges } from "../../shared/utils/lines";

/**
 * Pure helpers for the Feature Editor (the `.feature` file handler's
 * structured mode). DOM-free and I/O-free so the editing logic is
 * unit-testable, following the test-console-format.ts pattern.
 */

export type { ValidationItem } from "../../application/content/feature-validation";

/**
 * Live validation for the editor strip: the shared structural rules
 * (TD-003) plus editor-only typing-time hints (unnamed scenario, rowless
 * Outline) for content that is still being typed.
 */
export const projectValidation = (specification: FeatureSpecification): ValidationItem[] => {
  const items = structuralIssues(specification);
  for (const scenario of specification.scenarios) {
    const label = scenario.name.trim() === "" ? "(unnamed)" : scenario.name;
    if (scenario.name.trim() === "") {
      items.push({ level: "warning", message: "A scenario has no name." });
    }
    if (isScenarioOutline(scenario)) {
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
export const moveItem = (array: unknown[], index: number, delta: -1 | 1): boolean => {
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

/** Tidies editor cell input; pipes/backslashes are escaped by the serializer (TD-001). */
export const sanitizeCell = (value: string): string => value.trim();

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

/**
 * Splits textarea input into the lines that round-trip as description text.
 * Interior blank lines survive as paragraph breaks (the parser preserves
 * them); boundary blanks are layout and are dropped.
 */
export const asDescriptionLines = (value: string): string[] => {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line === "" || isPlainDescriptionLine(line));
  return trimBlankEdges(lines);
};

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

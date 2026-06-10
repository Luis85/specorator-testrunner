import type { TestSuite } from "../../domain/entities/suite";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/** A Test Suite projected to the columns the suites panel displays (US-023/US-024/US-025). */
export interface SuiteRow {
  id: string;
  name: string;
  tagExpression: string;
  path: VaultPath;
}

/** Pure projection so the suites panel's row shaping is unit-testable. */
export const projectSuiteRows = (suites: TestSuite[]): SuiteRow[] =>
  suites.map((suite) => ({
    id: suite.id,
    name: suite.name,
    tagExpression: suite.tagExpression,
    path: suite.path,
  }));

/** The "Scenarios" cell of one suite row (Wave F insight). */
export interface ScenarioCountCell {
  /** Display text: the count, or "—" when the Tag Expression did not parse. */
  text: string;
  /** `warning` accents a zero count via the [data-status] convention. */
  status: "warning" | null;
  /** Hover explanation for the zero / parse-error states. */
  tooltip: string | null;
  ariaLabel: string;
}

/**
 * Pure projection of a `countMatchingScenarios` result to the "Scenarios" cell
 * (Wave F): the matched count, a warning-accented "0" when the Tag Expression
 * matches nothing, or "—" with the parse error when it is malformed.
 */
export const scenarioCountCell = (count: Result<number>): ScenarioCountCell => {
  if (!count.ok) {
    return {
      text: "—",
      status: null,
      tooltip: count.error.message,
      ariaLabel: `Tag Expression did not parse: ${count.error.message}`,
    };
  }
  if (count.value === 0) {
    return {
      text: "0",
      status: "warning",
      tooltip: "No scenarios match this Tag Expression.",
      ariaLabel: "0 scenarios match",
    };
  }
  return {
    text: String(count.value),
    status: null,
    tooltip: null,
    ariaLabel: `${count.value} ${count.value === 1 ? "scenario matches" : "scenarios match"}`,
  };
};

/** The inline Tag Expression preview line in CreateSuiteModal (Wave F). */
export interface TagExpressionPreview {
  text: string;
  /** Tints the line via [data-status]; null renders the muted default. */
  status: "warning" | "error" | null;
}

/**
 * Pure projection of a `countMatchingScenarios` result to the modal's inline
 * preview. Informational only — creation stays allowed with 0 matches.
 */
export const tagExpressionPreview = (count: Result<number>): TagExpressionPreview => {
  if (!count.ok) return { text: count.error.message, status: "error" };
  if (count.value === 0) {
    return { text: "No scenarios match this Tag Expression.", status: "warning" };
  }
  return {
    text: `Matches ${count.value} ${count.value === 1 ? "scenario" : "scenarios"}.`,
    status: null,
  };
};

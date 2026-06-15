import type {
  FeatureSpecification,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import { useCaseIdFromPath } from "./gherkin";
import { isScenarioOutline } from "../../domain/entities/specification";
import { rowCells, rowDigest } from "../../domain/value-objects/scenario-reference";

/** One line of a structural validation verdict (service + editor strip). */
export interface ValidationItem {
  level: "error" | "warning";
  message: string;
}

const scenarioLabel = (scenario: ScenarioSpecification): string =>
  scenario.name.trim() === "" ? "(unnamed)" : scenario.name.trim();

/**
 * Scenario Reference collision rules (ADR-0022, US-056): the name-based key must
 * be unique, must not forge the reserved `::` / `::row-` delimiters, and an
 * Outline's content-stable row digests must not collide. Kept out of
 * {@link structuralIssues} so each rule stays small and independently testable.
 */
export const identityIssues = (scenarios: readonly ScenarioSpecification[]): ValidationItem[] => {
  const items: ValidationItem[] = [];
  const seenNames = new Set<string>();
  const reportedDup = new Set<string>();
  for (const scenario of scenarios) {
    const name = scenario.name.trim();
    if (name.includes("::")) {
      items.push({
        level: "error",
        message: `Scenario "${scenarioLabel(scenario)}" uses the reserved "::" delimiter in its name.`,
      });
    }
    // Empty names are compared too: two unnamed scenarios both resolve to the
    // `<featurePath>::` reference, so they collide just like a repeated name.
    if (seenNames.has(name) && !reportedDup.has(name)) {
      items.push({
        level: "error",
        message:
          name === ""
            ? "Duplicate unnamed scenario — every scenario needs a unique name so its Scenario Reference is collision-free (ADR-0022)."
            : `Duplicate scenario name "${name}" — names must be unique within a Feature (ADR-0022).`,
      });
      reportedDup.add(name);
    }
    seenNames.add(name);
    const dup = duplicateRowIssue(scenario);
    if (dup) items.push(dup);
  }
  return items;
};

/** The single duplicate-example-row error for one Outline, or null. */
const duplicateRowIssue = (scenario: ScenarioSpecification): ValidationItem | null => {
  if (!isScenarioOutline(scenario)) return null;
  const seen = new Set<string>();
  for (const block of scenario.examples ?? []) {
    for (const row of block.rows) {
      const digest = rowDigest(rowCells(block.header, row));
      if (seen.has(digest)) {
        return {
          level: "error",
          message: `Scenario Outline "${scenarioLabel(scenario)}" has duplicate example rows.`,
        };
      }
      seen.add(digest);
    }
  }
  return null;
};

/**
 * THE structural Feature rules (TD-003) — consumed by
 * `SpecificationService.validate` (the Validate action) and the Feature
 * Editor's live strip, which layers typing-time hints on top. Semantics
 * locked here: empty name uses trim() (whitespace-only is nameless), and an
 * orphan filename is an ERROR on both surfaces (ADR-0012).
 */
export const structuralIssues = (specification: FeatureSpecification): ValidationItem[] => {
  const items: ValidationItem[] = [];
  if (useCaseIdFromPath(specification.path) === null) {
    items.push({
      level: "error",
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
    if (scenario.steps.length === 0) {
      items.push({
        level: "error",
        message: `Scenario "${scenarioLabel(scenario)}" has no steps.`,
      });
    }
  }
  items.push(...identityIssues(specification.scenarios));
  return items;
};

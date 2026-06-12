import type { FeatureSpecification } from "../../domain/entities/specification";
import { useCaseIdFromPath } from "./gherkin";

/** One line of a structural validation verdict (service + editor strip). */
export interface ValidationItem {
  level: "error" | "warning";
  message: string;
}

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
    const label = scenario.name.trim() === "" ? "(unnamed)" : scenario.name;
    if (scenario.steps.length === 0) {
      items.push({ level: "error", message: `Scenario "${label}" has no steps.` });
    }
  }
  return items;
};

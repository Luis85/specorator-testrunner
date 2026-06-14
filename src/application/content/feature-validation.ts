import type { FeatureSpecification } from "../../domain/entities/specification";
import { useCaseIdFromPath } from "./gherkin";
import { isScenarioOutline } from "../../domain/entities/specification";
import { rowDigest } from "../../domain/value-objects/scenario-reference";

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
  const seenNames = new Set<string>();
  const reportedDup = new Set<string>();
  for (const scenario of specification.scenarios) {
    const name = scenario.name.trim();
    const label = name === "" ? "(unnamed)" : name;

    if (scenario.steps.length === 0) {
      items.push({ level: "error", message: `Scenario "${label}" has no steps.` });
    }

    // Scenario Reference collision rules (ADR-0022, US-056): the name-based key
    // must be unique and must not forge the reserved `::` / `::row-` delimiters.
    if (name.includes("::")) {
      items.push({
        level: "error",
        message: `Scenario "${label}" uses the reserved "::" delimiter in its name.`,
      });
    }
    if (name !== "" && seenNames.has(name) && !reportedDup.has(name)) {
      items.push({
        level: "error",
        message: `Duplicate scenario name "${name}" — names must be unique within a Feature (ADR-0022).`,
      });
      reportedDup.add(name);
    }
    seenNames.add(name);

    // The content-stable Outline row digest must be collision-free, so identical
    // example rows are a structural error (mirrors the duplicate-name rule).
    if (isScenarioOutline(scenario)) {
      const seenRows = new Set<string>();
      let flagged = false;
      for (const block of scenario.examples ?? []) {
        for (const row of block.rows) {
          const cells = block.header.map(
            (header, i) => [header, row[i] ?? ""] as [string, string],
          );
          const digest = rowDigest(cells);
          if (seenRows.has(digest) && !flagged) {
            items.push({
              level: "error",
              message: `Scenario Outline "${label}" has duplicate example rows.`,
            });
            flagged = true;
          }
          seenRows.add(digest);
        }
      }
    }
  }
  return items;
};

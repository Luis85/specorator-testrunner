import { useCaseIdFromPath } from "../../application/content/gherkin";
import type {
  FeatureFileEntry,
  MissingStepResult,
  SpecificationValidationResult,
} from "../../application/services/specification-service";
import type { GenerateStepDefinitionsResult } from "../../application/services/step-definition-service";
import type { UseCase } from "../../domain/entities/use-case";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { type ChecklistRow, checklistRow } from "../settings/settings-rows";

/** The Use Case header fields the detail view renders, projected for a row. */
export interface UseCaseHeaderRow {
  id: string;
  title: string;
  status: string;
  automationStatus: string;
  path: VaultPath;
}

/**
 * Pure projection of a Use Case to its detail-view header. Kept separate from
 * the dashboard's {@link projectUseCaseRows} so the header can evolve (e.g. a
 * description line) without widening the explorer table's row shape.
 */
export const projectUseCaseHeader = (useCase: UseCase): UseCaseHeaderRow => ({
  id: useCase.id,
  title: useCase.title,
  status: useCase.status,
  automationStatus: useCase.automationStatus,
  path: useCase.path,
});

/**
 * Pure view-model shaping for the Use Case detail view (Wave D). Mirrors how the
 * dashboard / settings rows keep projections unit-testable and free of Obsidian
 * APIs: the view renders these verbatim. The per-feature action results reuse
 * the wizard's `ChecklistRow` vocabulary (✓/✗/!) so every inline surface reads
 * alike.
 */

/** A Feature Specification belonging to one Use Case, projected for a row. */
export interface FeatureRow {
  /** Vault path of the `.feature` file (the run/validate/detect target). */
  path: VaultPath;
  /** Path relative to the feature-files folder (the human-readable label). */
  label: string;
}

/**
 * Filters the full Feature listing down to the Features belonging to one Use
 * Case, using the ADR-0012 filename back-reference (`<UC-id>-<slug>.feature`).
 *
 * The filename prefix — not `useCase.featureFiles` — is the source of truth here
 * so a Feature created on disk (or whose forward-link write failed) still shows
 * up under its Use Case; orphan files with no `UC-NNN-` prefix are excluded.
 * Listing order is preserved (the service does not sort).
 */
export const projectFeatureRows = (
  useCaseId: UseCaseId,
  features: FeatureFileEntry[],
): FeatureRow[] =>
  features
    .filter((feature) => useCaseIdFromPath(feature.path) === useCaseId)
    .map((feature) => ({ path: feature.path, label: feature.label }));

/**
 * Maps a Feature validation result to checklist rows: a single ✓ row when the
 * Feature is valid, else one ✗ row per structural error (the service already
 * phrases each message). A not-valid result with no errors — which the service
 * never produces today — still renders a generic ✗ row rather than nothing.
 */
export const featureValidationRows = (result: SpecificationValidationResult): ChecklistRow[] => {
  if (result.valid) return [checklistRow("ok", "Feature Specification is valid.")];
  if (result.errors.length === 0) {
    return [checklistRow("error", "Feature Specification is not valid.")];
  }
  return result.errors.map((error) => checklistRow("error", error.message));
};

/**
 * Maps a missing-steps detection result to checklist rows: a single ✓ row when
 * every step is defined, else a ! summary row plus one info row per undefined
 * step so the user can see exactly what needs step definitions.
 */
export const missingStepsRows = (result: MissingStepResult): ChecklistRow[] => {
  if (result.missingSteps.length === 0) return [checklistRow("ok", "All steps are defined.")];
  return [
    checklistRow(
      "warning",
      `${result.missingSteps.length} ${
        result.missingSteps.length === 1 ? "step needs" : "steps need"
      } a definition:`,
    ),
    ...result.missingSteps.map((step) => checklistRow("info", step)),
  ];
};

/**
 * Maps a step-definition generation result to checklist rows. An empty
 * `generatedSteps` means detection found nothing undefined (or every step has
 * since been implemented), so report that rather than a spurious "generated 0".
 */
export const stepGenerationRows = (result: GenerateStepDefinitionsResult): ChecklistRow[] => {
  if (result.generatedSteps.length === 0) {
    return [checklistRow("ok", "No missing steps — nothing to generate.")];
  }
  const count = result.generatedSteps.length;
  return [
    checklistRow(
      "ok",
      `Generated ${count} step ${count === 1 ? "stub" : "stubs"} in ${result.stepFile}.`,
    ),
  ];
};

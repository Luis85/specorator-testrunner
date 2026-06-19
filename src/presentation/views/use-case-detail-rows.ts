import { useCaseIdFromPath } from "../../application/content/gherkin";
import type { FeatureHealth } from "../../application/services/feature-insight-service";
import type {
  FeatureFileEntry,
  MissingStepResult,
  SpecificationService,
  SpecificationValidationResult,
} from "../../application/services/specification-service";
import type {
  GenerateStepDefinitionsResult,
  StepDefinitionService,
} from "../../application/services/step-definition-service";
import type { UseCase } from "../../domain/entities/use-case";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { type ChecklistRow, checklistRow } from "../settings/settings-rows";

/**
 * The Use Case → (Domain ›) PRD breadcrumb label. Empty when the Use Case has
 * neither a domain nor a PRD link. Falls back to the bare PRD id when its title
 * is not in `prdTitleById`.
 */
export const prdBreadcrumbLabel = (
  uc: { domain?: string; prdId?: string },
  prdTitleById: Map<string, string>,
): string => {
  const parts: string[] = [];
  if (uc.domain) parts.push(`Domain: ${uc.domain}`);
  if (uc.prdId) {
    const title = prdTitleById.get(uc.prdId);
    parts.push(title ? `${uc.prdId}: ${title}` : uc.prdId);
  }
  return parts.join("  ›  ");
};

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

/** A feature-level exclusion badge (e.g. `@wip`, `@quarantine`) for the health line. */
export interface FeatureHealthBadge {
  /** CSS class the view renders the chip with. */
  cls: string;
  /** Chip text (the tag). */
  text: string;
  /** Tooltip / aria-label naming the KPI exclusion. */
  tooltip: string;
}

/** The muted per-Feature health line (Wave F insight). */
export interface FeatureHealthLine {
  /** e.g. "3 scenarios" or "3 scenarios (1 @wip, 1 quarantined)". */
  text: string;
  /**
   * Feature-level exclusion badges to render after the text (`@wip`, ADR-0017;
   * `@quarantine`, US-058). A data-driven list so the view just iterates — the
   * which-badges branching stays here, in a unit-tested pure projection.
   */
  badges: FeatureHealthBadge[];
}

/**
 * Pure projection of a Feature's {@link FeatureHealth} to the muted info line
 * each Feature row shows (Wave F): scenario count, the scenario-level @wip and
 * @quarantine (US-058) counts when any, plus the feature-level exclusion badges.
 * The @wip and quarantine counts share one parenthetical so the line stays
 * compact, e.g. "3 scenarios (1 @wip, 1 quarantined)".
 */
export const featureHealthLine = (health: FeatureHealth): FeatureHealthLine => {
  const scenarios = `${health.scenarioCount} ${health.scenarioCount === 1 ? "scenario" : "scenarios"}`;
  const segments: string[] = [];
  if (health.wipScenarioCount > 0) segments.push(`${health.wipScenarioCount} @wip`);
  if (health.quarantineScenarioCount > 0) {
    segments.push(`${health.quarantineScenarioCount} quarantined`);
  }
  const annotations = segments.length > 0 ? ` (${segments.join(", ")})` : "";
  const badges: FeatureHealthBadge[] = [];
  // The KPI exclusion is decided by ADR-0017 / US-058, but the decision ids are
  // internal references and stay out of user copy.
  if (health.featureIsWip) {
    badges.push({
      cls: "e2e-test-hub-wip-badge",
      text: "@wip",
      tooltip: "This Feature is tagged @wip and is excluded from the KPI roll-up.",
    });
  }
  if (health.featureIsQuarantined) {
    badges.push({
      cls: "e2e-test-hub-quarantine-badge",
      text: "@quarantine",
      tooltip: "This Feature is tagged @quarantine and is excluded from the KPI roll-up.",
    });
  }
  return { text: `${scenarios}${annotations}`, badges };
};

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

// ── Per-Feature action outcomes ──────────────────────────────────────────────
// The async orchestration behind each Feature row's inline action: call the
// service, then map success/failure to the SAME ChecklistRow vocabulary above.
// Extracted from the view so the error/empty paths (which the view itself can't
// unit-test) are covered, and the view's methods stay thin (render pending,
// await the outcome, render it).

/** Validate the chosen Feature (UC-007) and project the outcome to rows. */
export const validateFeatureOutcome = async (
  specificationService: Pick<SpecificationService, "validate">,
  featurePath: VaultPath,
): Promise<ChecklistRow[]> => {
  const result = await specificationService.validate(featurePath);
  if (!result.ok) return [checklistRow("error", `Validation failed: ${result.error.message}`)];
  return featureValidationRows(result.value);
};

/** Detect the chosen Feature's undefined steps (UC-010) and project to rows. */
export const detectMissingStepsOutcome = async (
  specificationService: Pick<SpecificationService, "detectMissingSteps">,
  featurePath: VaultPath,
): Promise<ChecklistRow[]> => {
  const result = await specificationService.detectMissingSteps(featurePath);
  if (!result.ok) return [checklistRow("error", `Detection failed: ${result.error.message}`)];
  return missingStepsRows(result.value);
};

/**
 * Detect-then-generate (UC-010 / RV-4): detect the Feature's undefined steps,
 * then generate non-destructive step-definition stubs — the same two-call
 * orchestration the command palette uses — projected to rows.
 */
export const generateStepDefinitionsOutcome = async (
  specificationService: Pick<SpecificationService, "detectMissingSteps">,
  stepDefinitionService: Pick<StepDefinitionService, "generate">,
  featurePath: VaultPath,
): Promise<ChecklistRow[]> => {
  const detected = await specificationService.detectMissingSteps(featurePath);
  if (!detected.ok) return [checklistRow("error", `Detection failed: ${detected.error.message}`)];
  const generated = await stepDefinitionService.generate(
    featurePath,
    detected.value.missingSteps,
    detected.value.detectionEventId,
  );
  if (!generated.ok) {
    return [
      checklistRow("error", `Could not generate step definitions: ${generated.error.message}`),
    ];
  }
  return stepGenerationRows(generated.value);
};

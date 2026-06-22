import type { FeatureFileEntry } from "../../application/services/specification-service";
import {
  AUTOMATED_STATUSES,
  SPECIFIED_STATUSES,
} from "../../application/services/traceability-service";
import type { UseCase } from "../../domain/entities/use-case";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { UseCaseKpiFilter } from "./dashboard-rows";
import { projectFeatureRows } from "./use-case-detail-rows";

/** A Use Case projected to the columns US-017 displays. */
export interface UseCaseRow {
  id: string;
  title: string;
  status: string;
  automationStatus: string;
  /**
   * Wave F insight: how many Feature Specifications back-reference this Use
   * Case (the ADR-0012 `<UC-id>-` filename convention, via the same pure
   * filter the detail view uses). `null` when the Feature listing was
   * unavailable — rendered as "—", never as a false zero-warning.
   */
  featureCount: number | null;
  path: VaultPath;
}

/**
 * Pure projection so the dashboard's row shaping is unit-testable. `features`
 * is the full `.feature` listing (or `null` when listing failed); each row's
 * `featureCount` reuses {@link projectFeatureRows} so the explorer and the
 * detail view agree on which Features belong to a Use Case.
 */
export const projectUseCaseRows = (
  useCases: UseCase[],
  features: FeatureFileEntry[] | null,
): UseCaseRow[] =>
  useCases.map((useCase) => ({
    id: useCase.id,
    title: useCase.title,
    status: useCase.status,
    automationStatus: useCase.automationStatus,
    featureCount: features === null ? null : projectFeatureRows(useCase.id, features).length,
    path: useCase.path,
  }));

/**
 * Scopes the projected rows to a KPI funnel filter (E1 PR3), so a tile showing
 * "8 passing" drills into EXACTLY those 8 rows. Each bucket reuses the SAME
 * predicate {@link projectDashboardSnapshot} counts with — the shared
 * {@link SPECIFIED_STATUSES}/{@link AUTOMATED_STATUSES} sets and the same
 * `automationStatus` comparisons — so the explorer can never drift from the
 * funnel. The exhaustive `switch` (no `default`) makes a new filter a compile
 * error here. Pure: no I/O, unit-tested against every automation status.
 */
export const filterUseCaseRows = (rows: UseCaseRow[], filter: UseCaseKpiFilter): UseCaseRow[] => {
  switch (filter) {
    case "all":
      return rows;
    case "specified":
      // A deprecated UC's status ("deprecated") is not in SPECIFIED_STATUSES, so
      // this already matches `specifiedUseCases` (active-only) without a guard.
      return rows.filter((row) => SPECIFIED_STATUSES.has(row.status));
    case "automated":
      return rows.filter((row) => isActive(row) && AUTOMATED_STATUSES.has(row.automationStatus));
    case "passing":
      return rows.filter((row) => isActive(row) && row.automationStatus === "passing");
    case "failing":
      return rows.filter((row) => isActive(row) && row.automationStatus === "failing");
  }
};

/**
 * Mirrors {@link projectDashboardSnapshot}'s `active` filter (ADR-0017): the
 * automation buckets count NON-deprecated Use Cases only. Without this a
 * deprecated UC that was `passing`/`failing`/`automated` before deprecation —
 * excluded from the funnel tile — would still surface under the explorer's
 * filter, so "8 passing" would drill into 9 rows.
 */
const isActive = (row: UseCaseRow): boolean => row.status !== "deprecated";

/** The "Features" cell of one Use Case row (Wave F insight). */
export interface FeatureCountCell {
  text: string;
  /** `warning` accents a zero count via the [data-status] convention. */
  status: "warning" | null;
  tooltip: string | null;
}

/**
 * Pure projection of a row's `featureCount` to its "Features" cell: the count,
 * a warning-accented "0" nudging the user toward generation, or "—" when the
 * listing was unavailable (unknown, not zero).
 */
export const featureCountCell = (featureCount: number | null): FeatureCountCell => {
  if (featureCount === null) {
    return { text: "—", status: null, tooltip: "Feature Specifications could not be listed." };
  }
  if (featureCount === 0) {
    return {
      text: "0",
      status: "warning",
      tooltip: "No Feature Specifications yet — open the Use Case to generate one.",
    };
  }
  return { text: String(featureCount), status: null, tooltip: null };
};

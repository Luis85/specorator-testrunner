import type { SuiteId, UseCaseId, VaultPath } from "../value-objects/identifiers";
import type { TestRunSummary } from "./test-run";

/** Use Case domain entity (TIS §6.1–§6.3). */

/**
 * Business lifecycle states, as a runtime list so UI dropdowns and runtime
 * validation (UseCaseService.updateMetadata) enumerate the same single source
 * the {@link UseCaseStatus} union is derived from (Wave G §3).
 */
export const USE_CASE_STATUSES = [
  "draft",
  "specified",
  "ready-for-automation",
  "automated",
  "verified",
  "deprecated",
] as const;

/** Business lifecycle. */
export type UseCaseStatus = (typeof USE_CASE_STATUSES)[number];

/** Test state, derived per ADR-0017 with `@wip` exclusion. */
export type AutomationStatus =
  | "not-planned"
  | "planned"
  | "missing-steps"
  | "implemented"
  | "passing"
  | "failing";

export interface UseCase {
  id: UseCaseId;
  title: string;
  description?: string;
  status: UseCaseStatus;
  automationStatus: AutomationStatus;
  featureFiles: VaultPath[]; // 0..N per ADR-0012; empty = not automated
  suites: SuiteId[];
  evidence: VaultPath[];
  lastTestRun?: TestRunSummary;
  path: VaultPath;
}

import type {
  CiReadinessResult,
  RunnerValidationResult,
} from "../../application/services/environment-validation-service";
import type { RepairResult } from "../../application/services/maintenance-service";
import type { AppError } from "../../shared/errors/errors";

/**
 * Pure view-model shaping for the settings tab's inline result/error surfaces
 * (Wave A), mirroring how dashboard-rows / suite-rows keep projections
 * unit-testable and free of Obsidian APIs. The tab renders these rows verbatim.
 */

/** Visual status of one inline checklist row; styles.css colours by it. */
export type ChecklistStatus = "ok" | "error" | "warning" | "info" | "pending";

export interface ChecklistRow {
  icon: string;
  text: string;
  status: ChecklistStatus;
}

/**
 * Same icon vocabulary as the initialization wizard's progress rows
 * (✓ done / ✗ failed / – skipped / … running), so the two surfaces read alike.
 */
const STATUS_ICONS: Record<ChecklistStatus, string> = {
  ok: "✓",
  error: "✗",
  warning: "!",
  info: "–",
  pending: "…",
};

export const checklistRow = (status: ChecklistStatus, text: string): ChecklistRow => ({
  status,
  text,
  icon: STATUS_ICONS[status],
});

/**
 * Maps a runner validation result to checklist rows: a single ✓ row when the
 * environment is ready, else one row per reported issue (its severity maps
 * 1:1 onto a row status). A not-valid result with no issues — which the
 * service never produces today — still renders a generic ✗ row rather than
 * silently rendering nothing.
 */
export const runnerValidationRows = (result: RunnerValidationResult): ChecklistRow[] => {
  if (result.valid) {
    // Healthy, but surface any non-error advisories (e.g. an outdated
    // .testrunner manifest → Repair) so a warning isn't swallowed.
    const advisories = result.issues.filter((issue) => issue.severity !== "error");
    return [
      checklistRow("ok", "Environment is ready."),
      ...advisories.map((issue) => checklistRow(issue.severity, issue.message)),
    ];
  }
  if (result.issues.length === 0) return [checklistRow("error", "Environment is not ready.")];
  return result.issues.map((issue) => checklistRow(issue.severity, issue.message));
};

/** Maps a successful repair outcome to checklist rows. */
export const repairRows = (result: RepairResult): ChecklistRow[] => [
  checklistRow(
    "ok",
    `Repaired ${result.repairedFiles.length} .testrunner ${
      result.repairedFiles.length === 1 ? "file" : "files"
    }.`,
  ),
  result.reinstalledPackages
    ? checklistRow("ok", "Reinstalled npm dependencies.")
    : checklistRow("info", "Dependencies were intact; no reinstall was needed."),
  result.reinstalledBrowsers
    ? checklistRow("ok", "Verified the browser installation.")
    : checklistRow("info", "Browser installation was not re-run."),
  // A V1→V2 migration deletes legacy cucumber files and the user may have custom
  // V1 steps that no longer run — surface it (a warning, not just a log) so they
  // know to re-author them.
  ...(result.migratedFromV1
    ? [
        checklistRow(
          "warning",
          `Migrated the runner from the V1 Cucumber engine to playwright-bdd (removed ${result.removedFiles.length} legacy ${
            result.removedFiles.length === 1 ? "file" : "files"
          }). Any custom V1 step files must be re-authored as createBdd steps.`,
        ),
      ]
    : []),
];

/** Maps a failed repair to a single explanatory ✗ row. */
export const repairFailureRow = (error: AppError): ChecklistRow =>
  checklistRow(
    "error",
    error.code === "RUN_IN_PROGRESS" || error.code === "MAINTENANCE_IN_PROGRESS"
      ? "A test run or maintenance task is in progress; try again when it finishes."
      : `Repair failed: ${error.message}`,
  );

/**
 * Maps a CI readiness result to checklist rows: ready ✓ (or one ✗ row per
 * missing item), followed by the advisory warnings the service always emits
 * (repository variable/secrets reminders, ADR-0011/0014).
 */
export const ciReadinessRows = (result: CiReadinessResult): ChecklistRow[] => [
  ...(result.ready
    ? [checklistRow("ok", "CI is ready.")]
    : result.missingItems.map((item) => checklistRow("error", item))),
  ...result.warnings.map((warning) => checklistRow("warning", warning)),
];

/** Shape guard for one SettingsService validation message inside details. */
const hasMessage = (entry: unknown): entry is { message: string } =>
  typeof entry === "object" &&
  entry !== null &&
  typeof (entry as { message?: unknown }).message === "string";

/**
 * Extracts the field-level messages out of a SETTINGS_INVALID error.
 * SettingsService.save() packs its validation errors into
 * `details.errors: SettingsValidationMessage[]`; each message already names
 * its environment/key (e.g. `Environment "staging" baseUrl …`), so the tab
 * renders the messages verbatim — no extra field→label mapping needed.
 * Defensive: a malformed/missing details payload falls back to the top-level
 * error message so a rejected save is never silent.
 */
export const settingsErrorMessages = (error: AppError): string[] => {
  const raw = error.details?.errors;
  if (Array.isArray(raw)) {
    const messages = raw.filter(hasMessage).map((entry) => entry.message);
    if (messages.length > 0) return messages;
  }
  return [error.message];
};

/**
 * True for PipelineGenerationService's "a workflow already exists" rejection
 * (OQ-005 never-clobber default). The service reports it as a generic
 * VALIDATION_FAILED, so the message is the only discriminator; the tab uses
 * this to offer the explicit "Overwrite workflow" follow-up.
 */
export const isWorkflowAlreadyExistsError = (error: AppError): boolean =>
  error.code === "VALIDATION_FAILED" && /already exists/i.test(error.message);

/**
 * Validates a new environment name for the add-environment modal: non-empty
 * (after trimming) and not a duplicate of an existing environment key.
 * Returns the problem text, or `undefined` when the name is acceptable.
 */
export const environmentNameProblem = (
  name: string,
  existingNames: readonly string[],
): string | undefined => {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a name for the environment.";
  if (existingNames.includes(trimmed)) {
    return `An environment named "${trimmed}" already exists.`;
  }
  return undefined;
};

/** One auth env-var editor row's current input state. */
export interface AuthVarPair {
  key: string;
  value: string;
}

/**
 * Builds the `auth.env` record from the editor rows. Rows whose KEY is empty
 * are UI staging (a just-added, not-yet-named row) and are dropped — they are
 * not data yet. Keys are trimmed (an accidental trailing space would otherwise
 * be a save-blocking invalid env-var name), but INVALID keys are deliberately
 * kept: SettingsService.save() must reject them so the inline error display
 * can tell the user what to fix. Later duplicates win, matching record
 * assignment. Returns `undefined` when no row carries data, so the
 * environment serializes without an `auth` section at all.
 */
export const buildAuthEnv = (pairs: readonly AuthVarPair[]): Record<string, string> | undefined => {
  const env: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key === "") continue;
    env[key] = pair.value;
  }
  return Object.keys(env).length === 0 ? undefined : env;
};

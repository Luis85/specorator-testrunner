/**
 * Tagged error model (TIS §3.2, ADR-0019).
 *
 * Codes are stable across plugin versions: adding is safe, renaming is breaking.
 */
export type ErrorCode =
  // execution
  | "RUN_IN_PROGRESS" // ADR-0018
  | "RUN_TIMEOUT"
  | "RUN_CANCELLED"
  // path / command safety
  | "PATH_UNSAFE" // PathSafetyPolicy
  | "COMMAND_DISALLOWED" // RunnerExecutionPolicy
  // install / runner
  | "INIT_FAILED"
  | "RUNNER_MISSING_FILE"
  | "BROWSER_NOT_INSTALLED"
  | "NPM_INSTALL_FAILED"
  // report / evidence
  | "REPORT_NOT_FOUND"
  | "REPORT_PARSE_FAILED"
  | "EVIDENCE_WRITE_FAILED"
  // settings / validation
  | "SETTINGS_INVALID"
  | "VALIDATION_FAILED"
  | "SUT_ENV_NOT_FOUND";

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/** Builds an {@link AppError}; keeps call sites terse. */
export const appError = (
  code: ErrorCode,
  message: string,
  options: { details?: Record<string, unknown>; cause?: unknown } = {},
): AppError => ({
  code,
  message,
  details: options.details,
  cause: options.cause,
});

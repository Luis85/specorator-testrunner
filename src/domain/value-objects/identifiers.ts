/**
 * Identifier value objects (TIS §3.3, §3.4). Kept as branded-by-convention
 * string aliases in V1; the domain treats them as opaque.
 */
export type Id = string;
export type UseCaseId = string; // e.g. "UC-001"
export type SuiteId = string; // e.g. "smoke"
export type RunId = string; // e.g. "RUN-2026-06-01-100000"
export type EvidenceId = string; // e.g. "EV-2026-06-01-100000"

/**
 * A path relative to the vault root.
 *
 * Rules (validated by PathSafetyPolicy, TIS §14.1):
 * - Must be relative to vault root.
 * - Must not start with "/".
 * - Must not contain "..".
 * - May reference hidden folders such as `.testrunner` and `.github`.
 */
export type VaultPath = string;

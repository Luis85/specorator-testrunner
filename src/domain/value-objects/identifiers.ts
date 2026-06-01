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
 * Unlike the identifier aliases above, `VaultPath` is a BRANDED type: a plain
 * `string` cannot be assigned to it, so the only ways to obtain one are the
 * constructors in {@link file://./vault-path.ts} (P3-4, ADR-0008):
 *
 * - `vaultPath(raw)` — the SMART constructor. Runs {@link DefaultPathSafetyPolicy}
 *   and returns a `Result<VaultPath>`. This is the single ADR-0008 chokepoint for
 *   UNTRUSTED input (settings load, frontmatter, user-entered paths).
 * - `unsafeVaultPath(raw)` — the documented, auditable cast for values already
 *   known to be safe (DEFAULT_SETTINGS constants, recombined already-valid
 *   segments, test fixtures). `grep unsafeVaultPath` enumerates the trusted
 *   surface.
 *
 * Rules (validated by PathSafetyPolicy, TIS §14.1):
 * - Must be relative to vault root.
 * - Must not start with "/".
 * - Must not contain "..".
 * - May reference hidden folders such as `.testrunner` and `.github`.
 */
export type VaultPath = string & { readonly __brand: "VaultPath" };

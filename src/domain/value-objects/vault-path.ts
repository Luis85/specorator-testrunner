import type { VaultPath } from "./identifiers";
import { DefaultPathSafetyPolicy } from "../policies/path-safety-policy";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Constructors for the branded {@link VaultPath} value object (P3-4, ADR-0008).
 *
 * `VaultPath` is `string & { __brand }`, so a plain string can never be assigned
 * to it. Obtaining one therefore forces a deliberate choice between two paths:
 *
 *  - {@link vaultPath} — the SMART constructor. Validates UNTRUSTED input through
 *    {@link DefaultPathSafetyPolicy} and yields a `Result<VaultPath>`. This is the
 *    single ADR-0008 chokepoint: any path derived from settings on disk,
 *    frontmatter, or user input must pass through here.
 *  - {@link unsafeVaultPath} — the documented, auditable cast for values that are
 *    already known to be safe (compile-time constants like DEFAULT_SETTINGS,
 *    recombinations of already-branded segments, and test fixtures). It performs
 *    NO validation, so every call site is part of the trusted surface; running
 *    `grep -rn unsafeVaultPath src test` enumerates that surface for audit.
 */

/** Shared, stateless policy instance — the validator is pure (no I/O). */
const PATH_SAFETY = new DefaultPathSafetyPolicy();

/**
 * SMART constructor — the ADR-0008 chokepoint for UNTRUSTED input.
 *
 * Validates `raw` through {@link DefaultPathSafetyPolicy} and, on success, returns
 * it branded as a {@link VaultPath}. Use this wherever a path originates outside
 * the plugin's own constants: `data.json` settings on load, note frontmatter, and
 * paths typed by the user. On failure the underlying `PATH_UNSAFE` error is
 * propagated so callers can fall back to a default or surface a validation error.
 */
export const vaultPath = (raw: string): Result<VaultPath> => {
  const safe = PATH_SAFETY.validate(raw as VaultPath);
  return safe.ok ? ok(raw as VaultPath) : err(safe.error);
};

/**
 * UNSAFE/trusted brander — a documented, NO-OP cast to {@link VaultPath}.
 *
 * Use this ONLY for values already known to be vault-safe, so threading a
 * `Result` everywhere is unnecessary:
 *  - compile-time constants (e.g. `DEFAULT_SETTINGS` paths);
 *  - recombinations of already-valid segments (e.g. {@link joinVaultPath});
 *  - test fixtures.
 *
 * It does NOT validate. Never call it on untrusted input — use {@link vaultPath}
 * instead. Every call site is auditable via `grep -rn unsafeVaultPath`.
 */
export const unsafeVaultPath = (raw: string): VaultPath => raw as VaultPath;

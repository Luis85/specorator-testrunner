import type { VaultPath } from "./identifiers";
import { DefaultPathSafetyPolicy, type PathSafetyPolicy } from "../policies/path-safety-policy";
import { appError } from "../../shared/errors/errors";
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
 * Validates `raw` through a {@link PathSafetyPolicy} and, on success, returns it
 * branded as a {@link VaultPath}. Use this wherever a path originates outside the
 * plugin's own constants: `data.json` settings on load, note frontmatter, and
 * paths typed by the user. On failure the underlying `PATH_UNSAFE` error is
 * propagated so callers can fall back to a default or surface a validation error.
 *
 * `policy` defaults to a shared pure instance; callers that already hold an
 * injected `PathSafetyPolicy` (e.g. `SettingsService`) pass it so validation and
 * branding happen in ONE call and cannot drift apart.
 */
export const vaultPath = (
  raw: unknown,
  policy: PathSafetyPolicy = PATH_SAFETY,
): Result<VaultPath> => {
  // `raw` is `unknown` because the untrusted sources this guards (a hand-edited
  // or sync-corrupted `data.json`, note frontmatter) can hold a non-string —
  // e.g. `{ "featureFilesPath": 42 }`. Reject it here as a Result rather than
  // letting `PathSafetyPolicy.validate` call `.trim()` on a number and throw,
  // which would crash settings load instead of falling back to a default.
  if (typeof raw !== "string") {
    return err(appError("PATH_UNSAFE", `Path must be a string (got ${typeof raw}).`));
  }
  const safe = policy.validate(raw);
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

import type { VaultPath } from "../value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Rejects vault-escaping paths in settings and generated artifacts
 * (TIS §14.1, BBV §6.4). Pure: no I/O, so it is trivially unit-testable.
 */
export interface PathSafetyPolicy {
  validate(path: VaultPath): Result<void>;
}

/**
 * The only path characters that may reach a generated artifact: alphanumerics,
 * space, `_`, `.`, `/`, `-`. This is an allowlist, so it implicitly rejects
 * control characters and newlines as well as the JS/shell/YAML metacharacters
 * `"` `'` `` ` `` `$` `{` `}` `\`. Mirrors the strict screening in
 * pipeline-generation-service.ts (SEC-1 / P0-1).
 */
const SAFE_PATH_CHARS = /^[A-Za-z0-9 _./-]+$/;

export class DefaultPathSafetyPolicy implements PathSafetyPolicy {
  validate(path: VaultPath): Result<void> {
    if (path === undefined || path === null || path.trim() === "") {
      return err(appError("PATH_UNSAFE", "Path must not be empty."));
    }
    if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
      return err(
        appError("PATH_UNSAFE", `Path must be relative to the vault root: "${path}".`, {
          details: { path },
        }),
      );
    }
    // Reject ".." as a whole path segment (forward or back slash separated).
    if (path.split(/[\\/]/).some((segment) => segment === "..")) {
      return err(
        appError("PATH_UNSAFE", `Path must not contain "..": "${path}".`, {
          details: { path },
        }),
      );
    }
    // A path travels into generated artifacts — notably the `cucumber.mjs`
    // feature glob (a JS string literal) — so it must not carry control
    // characters, newlines, or metacharacters (`"` `'` `` ` `` `$` `{` `}` `\`)
    // that could break out of a literal and inject code (SEC-1 / P0-1).
    if (!SAFE_PATH_CHARS.test(path)) {
      return err(
        appError("PATH_UNSAFE", `Path contains unsafe characters: "${path}".`, {
          details: { path },
        }),
      );
    }
    return ok(undefined);
  }
}

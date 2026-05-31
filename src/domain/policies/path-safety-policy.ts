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
    return ok(undefined);
  }
}

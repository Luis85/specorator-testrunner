import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Rejects vault-escaping paths in settings and generated artifacts
 * (TIS §14.1, BBV §6.4). Pure: no I/O, so it is trivially unit-testable.
 *
 * Takes a plain `string`: this policy is the screen UNBRANDED input passes
 * BEFORE it may be branded as a `VaultPath` (the `vaultPath()` smart
 * constructor, ADR-0008).
 */
export interface PathSafetyPolicy {
  validate(path: string): Result<void>;
}

/**
 * Characters that must never reach a generated artifact. A path can be
 * interpolated into a `playwright.config.ts` feature glob (a JS string literal), so we
 * reject the JS/shell/YAML metacharacters that could break out of a literal —
 * `"` `'` `` ` `` `$` `{` `}` `\` — plus control characters and newlines.
 *
 * This is a DENYLIST rather than an ASCII allowlist on purpose: Obsidian vault
 * folders legitimately use non-English names (e.g. `Especificações`, `テスト`),
 * and an ASCII-only rule would reject them and silently reset the user's config
 * to defaults (security review M2). The injection protection does not depend on
 * rejecting Unicode — the primary defence is `JSON.stringify` at the generation
 * sink (P0-1); this is defence-in-depth.
 */
const UNSAFE_PATH_CHARS = /["'`${}\\]/;
// eslint-disable-next-line no-control-regex -- deliberately rejecting C0 controls + DEL
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export class DefaultPathSafetyPolicy implements PathSafetyPolicy {
  validate(path: string): Result<void> {
    // Defensive: callers should pass a string, but untrusted settings/frontmatter
    // can carry a non-string (e.g. a number from a corrupt data.json). Guard the
    // type before any string method so this returns a Result instead of throwing.
    if (typeof path !== "string" || path.trim() === "") {
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
    // A path travels into generated artifacts — notably the `playwright.config.ts`
    // feature glob (a JS string literal) — so it must not carry control
    // characters, newlines, or metacharacters (`"` `'` `` ` `` `$` `{` `}` `\`)
    // that could break out of a literal and inject code (SEC-1 / P0-1).
    if (CONTROL_CHARS.test(path) || UNSAFE_PATH_CHARS.test(path)) {
      return err(
        appError("PATH_UNSAFE", `Path contains unsafe characters: "${path}".`, {
          details: { path },
        }),
      );
    }
    return ok(undefined);
  }
}

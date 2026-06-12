import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * Joins vault path segments with "/", collapsing duplicate and trailing
 * separators. Vault paths are always "/"-separated regardless of platform.
 *
 * Returns a branded {@link VaultPath}. The recombination is safe by construction:
 * it only concatenates segments that are themselves already-valid paths or
 * trusted literals, so the result is branded via an internal unchecked cast
 * rather than re-validated (P3-4 / ADR-0008). This `shared` util cannot import
 * the domain `unsafeVaultPath` brander without inverting the layering, so the
 * cast lives here and is part of the same auditable trusted surface.
 *
 * Guard (review §4): segments must be vault-relative and traversal-free —
 * an absolute or `..` segment reaching this trusted brander is a programmer
 * error (ADR-0019), not user input (user paths are screened upstream by the
 * `vaultPath()` smart constructor / PathSafetyPolicy), so it throws.
 */
export const joinVaultPath = (...segments: (string | VaultPath)[]): VaultPath => {
  for (const segment of segments) {
    if (segment.startsWith("/") || segment.startsWith("\\")) {
      throw new Error(
        `joinVaultPath: absolute segment "${segment}" — vault paths are vault-relative (ADR-0008).`,
      );
    }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(segment)) {
      throw new Error(
        `joinVaultPath: traversal segment "${segment}" — ".." is never a vault path part.`,
      );
    }
  }
  return segments
    .filter((segment) => segment !== "")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") as VaultPath;
};

/**
 * POSIX relative path from one vault folder to another (both vault-relative).
 * Used to point the runner's working directory at the feature folder
 * regardless of how either is configured (per ADR-0008).
 */
export const relativeVaultPath = (from: VaultPath, to: VaultPath): string => {
  const fromParts = from.split("/").filter((s) => s !== "");
  const toParts = to.split("/").filter((s) => s !== "");
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const down = toParts.slice(common);
  const segments = [...Array<string>(ups).fill(".."), ...down];
  return segments.length === 0 ? "." : segments.join("/");
};

import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * Joins vault path segments with "/", collapsing duplicate and trailing
 * separators. Vault paths are always "/"-separated regardless of platform.
 */
export const joinVaultPath = (...segments: string[]): VaultPath =>
  segments
    .filter((segment) => segment !== "")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

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
  const segments = [...Array(ups).fill(".."), ...down];
  return segments.length === 0 ? "." : segments.join("/");
};

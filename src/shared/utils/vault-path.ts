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

import type { FeatureSpecification } from "../entities/specification";
import { isScenarioOutline } from "../entities/specification";

/** 32-bit FNV-1a; non-cryptographic, deterministic, synchronous. */
const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * Content-stable digest of one Outline example row (US-056, ADR-0022). Cells
 * are `[header, value]` pairs; sorting by header makes the digest independent
 * of column order, and JSON-encoding the sorted pairs makes values that contain
 * separators unable to alias one row onto another. Reorder-stable: a row's
 * digest depends only on its content, never its position.
 */
export const rowDigest = (cells: ReadonlyArray<readonly [string, string]>): string => {
  const sorted = [...cells].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return fnv1a(JSON.stringify(sorted)).toString(36);
};

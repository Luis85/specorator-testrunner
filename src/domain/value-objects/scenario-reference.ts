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

/** Plain scenario identity: `<featurePath>::<scenarioName>` (ADR-0022). */
export const scenarioRef = (featurePath: string, scenarioName: string): string =>
  `${featurePath}::${scenarioName}`;

/** Outline row identity: `<featurePath>::<scenarioName>::row-<digest>`. */
export const outlineRowRef = (
  featurePath: string,
  scenarioName: string,
  cells: ReadonlyArray<readonly [string, string]>,
): string => `${scenarioRef(featurePath, scenarioName)}::row-${rowDigest(cells)}`;

export interface ParsedScenarioReference {
  featurePath: string;
  scenarioName: string;
  /** Present only for an Outline row reference. */
  rowDigest?: string;
}

/**
 * Inverse of {@link scenarioRef} / {@link outlineRowRef}. Safe because the `::`
 * delimiter is reserved in scenario names (validation, US-056) and vault paths
 * never contain `::`, so the split is unambiguous.
 */
export const parseScenarioReference = (ref: string): ParsedScenarioReference => {
  const parts = ref.split("::");
  const base: ParsedScenarioReference = {
    featurePath: parts[0] ?? "",
    scenarioName: parts[1] ?? "",
  };
  const rowToken = parts[2];
  if (rowToken !== undefined && rowToken.startsWith("row-")) {
    return { ...base, rowDigest: rowToken.slice("row-".length) };
  }
  return base;
};

export interface ScenarioRefEntry {
  scenarioName: string;
  ref: string;
}

/**
 * All scenario references for a parsed Feature, in declaration order: one entry
 * per plain scenario, one per Outline example row (across every `Examples`
 * block). The order matches the order a report expands rows, so a resolver can
 * zip report rows onto these entries by position within a scenario name.
 */
export const featureScenarioRefs = (feature: FeatureSpecification): ScenarioRefEntry[] => {
  const path = String(feature.path);
  const entries: ScenarioRefEntry[] = [];
  for (const scenario of feature.scenarios) {
    if (isScenarioOutline(scenario)) {
      for (const block of scenario.examples ?? []) {
        for (const row of block.rows) {
          const cells = block.header.map(
            (header, i) => [header, row[i] ?? ""] as [string, string],
          );
          entries.push({
            scenarioName: scenario.name,
            ref: outlineRowRef(path, scenario.name, cells),
          });
        }
      }
    } else {
      entries.push({ scenarioName: scenario.name, ref: scenarioRef(path, scenario.name) });
    }
  }
  return entries;
};

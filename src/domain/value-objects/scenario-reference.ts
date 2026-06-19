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
export const rowDigest = (cells: readonly (readonly [string, string])[]): string => {
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
  cells: readonly (readonly [string, string])[],
): string => `${scenarioRef(featurePath, scenarioName)}::row-${rowDigest(cells)}`;

export interface ParsedScenarioReference {
  featurePath: string;
  scenarioName: string;
  /** Present only for an Outline row reference. */
  rowDigest?: string;
}

/**
 * Inverse of {@link scenarioRef} / {@link outlineRowRef}. The `::` delimiter is
 * reserved in scenario names (validation, US-056) AND in feature paths — the
 * resolver refuses to mint a reference for a feature whose vault path contains
 * `::` (codex P2), because `a::b::row-c` is otherwise ambiguous between a path
 * with `::` and a plain scenario named `row-c`. With that guarantee the split is
 * unambiguous: `parts[0]` is the path, `parts[1]` the scenario name, and a
 * `parts[2]` of `row-<digest>` marks an Outline row. A plain scenario named
 * `row-…` has no `parts[2]`, so it is never mistaken for a row suffix.
 */
export const parseScenarioReference = (ref: string): ParsedScenarioReference => {
  const parts = ref.split("::");
  const base: ParsedScenarioReference = {
    featurePath: parts[0] ?? "",
    scenarioName: parts[1] ?? "",
  };
  const rowToken = parts[2];
  if (rowToken?.startsWith("row-")) {
    return { ...base, rowDigest: rowToken.slice("row-".length) };
  }
  return base;
};

/**
 * Zips an `Examples` header with one row into `[header, value]` cells, padding
 * a short row with `""`. The single source of the cell shape that feeds
 * {@link rowDigest}, so the identity reference and the duplicate-row validation
 * compute the same digest (US-056).
 */
export const rowCells = (header: readonly string[], row: readonly string[]): [string, string][] =>
  header.map((value, i) => [value, row[i] ?? ""]);

/**
 * Substitutes `<param>` tokens in a Scenario Outline name with an example row's
 * values, mirroring how Cucumber compiles a pickle's name (US-056). This is the
 * name a run report carries for an Outline row (e.g. `Login as <role>` with
 * `role=admin` becomes `Login as admin`), so the resolver can match report rows
 * back to their reference. An unknown `<token>` is left literal, as Cucumber does.
 */
export const expandScenarioName = (
  name: string,
  cells: readonly (readonly [string, string])[],
): string => {
  const values = new Map(cells.map(([header, value]) => [header, value]));
  return name.replace(/<([^>]+)>/g, (whole, key: string) => values.get(key) ?? whole);
};

export interface ScenarioRefEntry {
  /** The Outline template / plain scenario name (for display). */
  scenarioName: string;
  /** The name a run report carries for this row — expanded for Outline rows. */
  matchName: string;
  ref: string;
  /**
   * The tags effective for this specific scenario/row: the scenario's own tags,
   * plus — for an Outline row — its `Examples:` block's tags (the only way
   * Gherkin scopes a tag to particular rows). Lets a domain policy decide
   * per-row exclusions — `@quarantine` (US-058) — without re-parsing the Feature.
   * Feature-level tags are NOT folded in here; a consumer that wants the full
   * effective set unions them with the Feature's separately.
   */
  tags: string[];
  /**
   * 1-based feature-file line of an Outline example row (from the parser), when
   * known. Lets a resolver disambiguate filtered same-name rows by line — the
   * report row carries the same line — instead of by position. Absent for plain
   * scenarios and parser output without line info.
   */
  line?: number;
}

/**
 * All scenario references for a parsed Feature, in declaration order: one entry
 * per plain scenario, one per Outline example row (across every `Examples`
 * block). Each entry carries the `matchName` a run report uses (expanded for
 * Outline rows) so a resolver can join report rows to references by that name,
 * and the order matches report row expansion so same-name rows zip by position.
 */
export const featureScenarioRefs = (feature: FeatureSpecification): ScenarioRefEntry[] => {
  const path = String(feature.path);
  const entries: ScenarioRefEntry[] = [];
  for (const scenario of feature.scenarios) {
    if (isScenarioOutline(scenario)) {
      for (const block of scenario.examples ?? []) {
        block.rows.forEach((row, index) => {
          const cells = rowCells(block.header, row);
          const line = block.rowLines?.[index];
          entries.push({
            scenarioName: scenario.name,
            matchName: expandScenarioName(scenario.name, cells),
            ref: outlineRowRef(path, scenario.name, cells),
            // A row's effective tags = the scenario's tags + its Examples block's
            // tags, so a block-scoped `@quarantine` excludes exactly those rows.
            tags: [...scenario.tags, ...block.tags],
            ...(line !== undefined ? { line } : {}),
          });
        });
      }
    } else {
      entries.push({
        scenarioName: scenario.name,
        matchName: scenario.name,
        ref: scenarioRef(path, scenario.name),
        tags: scenario.tags,
      });
    }
  }
  return entries;
};

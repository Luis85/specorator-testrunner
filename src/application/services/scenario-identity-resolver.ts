import { readFeatureFile } from "./feature-loading";
import { identityIssues } from "../content/feature-validation";
import { parseFeature } from "../content/gherkin";
import type { ParsedReport, ScenarioResult } from "../ports/report-parser";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { FeatureSpecification } from "../../domain/entities/specification";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import {
  featureScenarioRefs,
  type ScenarioRefEntry,
} from "../../domain/value-objects/scenario-reference";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import type { Logger } from "../../shared/logging/logger";

/**
 * Vault-relative feature path for a report's runner-relative `featureUri`.
 * playwright-bdd writes the uri relative to the runner's config dir (e.g.
 * `../features/auth/login.feature`), so resolving it against the run's recorded
 * runner path and normalizing `.`/`..` yields the vault-relative path. This
 * works for any layout — including a runner and features folder that share an
 * intermediate parent (`TestHub/.testrunner` + `TestHub/features`) — preserves
 * nested subfolders, and uses the run's own runner path rather than the current
 * `featureFilesPath` setting, so a re-import after a settings change still
 * resolves the feature that actually ran (codex P2 — no settings drift).
 */
const resolveVaultPath = (runnerPath: string, uri: string): VaultPath => {
  const out: string[] = [];
  for (const segment of `${runnerPath}/${uri}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return unsafeVaultPath(out.join("/"));
};

const byLine = (a: ScenarioResult, b: ScenarioResult): number =>
  (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);

/** Buckets items by a key, preserving insertion order within each bucket. */
const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const list = out.get(key(item)) ?? [];
    list.push(item);
    out.set(key(item), list);
  }
  return out;
};

/** Buckets results by their `featureUri`, skipping rows that carry none. */
const groupByFeatureUri = (results: ScenarioResult[]): Map<string, ScenarioResult[]> => {
  const byUri = new Map<string, ScenarioResult[]>();
  for (const result of results) {
    if (!result.featureUri) continue; // e.g. a Background pseudo-result
    const list = byUri.get(result.featureUri) ?? [];
    list.push(result);
    byUri.set(result.featureUri, list);
  }
  return byUri;
};

/**
 * Enriches imported report results with their Scenario Reference (US-056,
 * ADR-0022). Name-derived identity: the durable key is computed from the
 * authoritative `.feature` file, not stamped into it. Outline rows are joined to
 * the same-run feature by position (report rows expand in declaration order) and
 * keyed by the row's content digest, so a between-run row reorder still attaches
 * history to the right parameter set. Pure with respect to the input report —
 * returns a new result list. Guaranteed never to throw: any unexpected I/O
 * fault is caught, logged as a warning, and the original report is returned
 * unenriched.
 */
export class ScenarioIdentityResolver {
  constructor(
    private readonly vaultFs: VaultFileSystem,
    private readonly logger: Logger,
  ) {}

  async enrich<T extends ParsedReport>(
    report: T,
    runnerPath: string,
    featureSnapshot?: Record<string, string>,
  ): Promise<T> {
    try {
      const cache = new Map<string, FeatureSpecification | null>();
      const enriched = report.scenarioResults.map((result) => ({ ...result }));

      for (const [uri, results] of groupByFeatureUri(enriched)) {
        const vaultPath = resolveVaultPath(runnerPath, uri);
        const feature = await this.featureFor(vaultPath, cache, featureSnapshot);
        if (feature) this.assign(results, feature, String(vaultPath));
      }

      return { ...report, scenarioResults: enriched };
    } catch (error) {
      this.logger.warn("Scenario identity: enrichment failed; returning report unenriched", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return report;
    }
  }

  /**
   * Parses a feature once per path (cached). Prefers the run-start snapshot —
   * the content that actually ran (US-056) — and falls back to the live vault
   * file when the snapshot has no entry for this path (older runs, manual
   * re-imports, or a snapshot that failed to write).
   */
  private async featureFor(
    vaultPath: VaultPath,
    cache: Map<string, FeatureSpecification | null>,
    featureSnapshot?: Record<string, string>,
  ): Promise<FeatureSpecification | null> {
    const key = String(vaultPath);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let feature: FeatureSpecification | null;
    const snapshot = featureSnapshot?.[key];
    if (snapshot !== undefined) {
      feature = parseFeature(snapshot, vaultPath);
      if (feature === null) {
        this.logger.warn("Scenario identity: snapshot feature unparseable; refs skipped", {
          vaultPath: key,
        });
      }
    } else {
      const read = await readFeatureFile(this.vaultFs, vaultPath);
      if (!read.ok) {
        this.logger.warn("Scenario identity: feature unreadable; refs skipped", {
          vaultPath: key,
          reason: read.error.message,
        });
      }
      feature = read.ok ? read.value : null;
    }
    cache.set(key, feature);
    return feature;
  }

  /**
   * Zips a feature's ordered refs onto report rows grouped by the name the report
   * carries. For an Outline row that name is the EXPANDED name (Cucumber pickle
   * naming), so the lookup keys on `matchName`, not the template name; rows that
   * share a name (e.g. an Outline whose name omits the varying param) still zip
   * by line order within the group.
   *
   * Run-time validation isn't enforced before a run, so a Feature that
   * `structuralIssues` would reject (duplicate scenario names, duplicate Outline
   * rows) can reach here and would mint identical references that silently merge
   * history. Refuse to assign for such a Feature — leave the refs undefined until
   * the collision is fixed (codex review).
   */
  private assign(
    results: ScenarioResult[],
    feature: FeatureSpecification,
    vaultPath: string,
  ): void {
    if (this.refusesFeature(feature, vaultPath)) return;

    const refEntries = groupBy(featureScenarioRefs(feature), (entry) => entry.matchName);
    const groups = groupBy(results, (result) => result.scenario);

    for (const [name, group] of groups) {
      this.assignGroup(group, refEntries.get(name) ?? [], name, vaultPath);
    }
  }

  /**
   * Whether a feature must not receive references: a path carrying the reserved
   * `::` delimiter (which would parse back ambiguously, codex P2) or an identity
   * collision (duplicate names/rows would mint refs that silently merge history).
   */
  private refusesFeature(feature: FeatureSpecification, vaultPath: string): boolean {
    if (vaultPath.includes("::")) {
      this.logger.warn("Scenario identity: feature path contains reserved '::'; refs skipped", {
        vaultPath,
      });
      return true;
    }
    if (identityIssues(feature.scenarios).length > 0) {
      this.logger.warn("Scenario identity: feature has identity collisions; refs skipped", {
        vaultPath,
      });
      return true;
    }
    return false;
  }

  /** Assigns one name-group's report rows their Scenario Reference. */
  private assignGroup(
    group: ScenarioResult[],
    entries: ScenarioRefEntry[],
    name: string,
    vaultPath: string,
  ): void {
    // Multiple feature rows share this name (an Outline whose name omits the
    // varying param) AND the report carries a different count — a tag filter
    // dropped some rows, so position no longer identifies the row. Index-zipping
    // would hand a row another row's content digest (codex P1).
    const ambiguous = entries.length > 1 && group.length !== entries.length;
    // In the ambiguous case fall back to matching by feature-file line: the
    // report row and the source example row carry the same line, so a filtered
    // row still gets its OWN content-stable ref (US-056 follow-up). Built only
    // when needed and only from entries that actually carry a line.
    const byRowLine = ambiguous
      ? new Map(entries.flatMap((e) => (e.line !== undefined ? [[e.line, e.ref] as const] : [])))
      : null;
    [...group].sort(byLine).forEach((result, index) => {
      const ref = ambiguous
        ? result.line !== undefined
          ? byRowLine?.get(result.line)
          : undefined
        : entries[index]?.ref;
      if (ref !== undefined) {
        result.scenarioRef = ref;
        return;
      }
      // Unresolvable: a filtered same-name Outline row with no line match, or more
      // report rows than the feature declares. Leave scenarioRef UNSET — a
      // positional fallback would collide across runs that select different single
      // rows and merge distinct history (codex). Unknown identity, not a guess.
      this.logger.warn("Scenario identity: unresolved outline row; ref left unset", {
        vaultPath,
        name,
        index,
        reason: ambiguous ? "filtered-rows" : "row-count-mismatch",
      });
    });
  }
}

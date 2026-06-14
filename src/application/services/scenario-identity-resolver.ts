import { readFeatureFile } from "./feature-loading";
import type { SettingsService } from "./settings-service";
import type { ParsedReport, ScenarioResult } from "../ports/report-parser";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { FeatureSpecification } from "../../domain/entities/specification";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { featureScenarioRefs } from "../../domain/value-objects/scenario-reference";
import type { Logger } from "../../shared/logging/logger";
import { joinVaultPath } from "../../shared/utils/vault-path";

/** Last `/`-segment of a runner-relative feature uri (e.g. `UC-001-x.feature`). */
const basename = (uri: string): string => uri.split("/").pop() ?? uri;

const byLine = (a: ScenarioResult, b: ScenarioResult): number =>
  (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);

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
 * returns a new result list. Guaranteed never to throw: any unexpected fault
 * (including settings/IO failures) is caught, logged as a warning, and the
 * original report is returned unenriched.
 */
export class ScenarioIdentityResolver {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly vaultFs: VaultFileSystem,
    private readonly logger: Logger,
  ) {}

  async enrich<T extends ParsedReport>(report: T): Promise<T> {
    try {
      const featureDir = (await this.settingsService.load()).paths.featureFilesPath;
      const cache = new Map<string, FeatureSpecification | null>();
      const enriched = report.scenarioResults.map((result) => ({ ...result }));

      for (const [uri, results] of groupByFeatureUri(enriched)) {
        const vaultPath = joinVaultPath(featureDir, basename(uri));
        const feature = await this.featureFor(vaultPath, cache);
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

  /** Reads + parses a feature once per path; caches the result (null when unreadable). */
  private async featureFor(
    vaultPath: VaultPath,
    cache: Map<string, FeatureSpecification | null>,
  ): Promise<FeatureSpecification | null> {
    const key = String(vaultPath);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const read = await readFeatureFile(this.vaultFs, vaultPath);
    if (!read.ok) {
      this.logger.warn("Scenario identity: feature unreadable; refs skipped", {
        vaultPath: key,
        reason: read.error.message,
      });
    }
    const feature = read.ok ? read.value : null;
    cache.set(key, feature);
    return feature;
  }

  /** Zips a feature's ordered refs onto report rows grouped by scenario name. */
  private assign(
    results: ScenarioResult[],
    feature: FeatureSpecification,
    vaultPath: string,
  ): void {
    const refsByName = new Map<string, string[]>();
    for (const entry of featureScenarioRefs(feature)) {
      const list = refsByName.get(entry.scenarioName) ?? [];
      list.push(entry.ref);
      refsByName.set(entry.scenarioName, list);
    }

    const groups = new Map<string, ScenarioResult[]>();
    for (const result of results) {
      const list = groups.get(result.scenario) ?? [];
      list.push(result);
      groups.set(result.scenario, list);
    }

    for (const [name, group] of groups) {
      const refs = refsByName.get(name) ?? [];
      [...group].sort(byLine).forEach((result, index) => {
        const ref = refs[index];
        if (ref !== undefined) {
          result.scenarioRef = ref;
        } else {
          result.scenarioRef = `${vaultPath}::${name}::row-${index}`;
          this.logger.warn("Scenario identity: row count mismatch; provisional ref", {
            vaultPath,
            name,
            index,
          });
        }
      });
    }
  }
}

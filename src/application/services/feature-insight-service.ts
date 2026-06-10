import { parseFeature } from "../content/gherkin";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SpecificationService } from "./specification-service";
import type {
  FeatureSpecification,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import {
  matchesTags,
  parseTagExpression,
  type TagExpression,
} from "../../domain/policies/tag-expression";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * FeatureInsightService (Wave F): read-only scenario/tag insight for the
 * dashboards. Answers two persona-audit questions without opening files:
 * "how many scenarios does this Test Suite's Tag Expression actually match?"
 * (suites explorer + CreateSuiteModal preview) and "how healthy is this
 * Feature Specification?" (Use Case detail view).
 *
 * It lives as its OWN narrow application service rather than widening
 * SuiteService (suite-note CRUD — it never parses Gherkin) or
 * SpecificationService (Feature lifecycle — create/update/validate, all
 * event-publishing): insight is a pure cross-cutting QUERY consumed by three
 * presentation surfaces, publishes no events, and composes the existing
 * pieces — `SpecificationService.listFeatures` for discovery (so the
 * recursive-listing semantics stay defined once) and `parseFeature` for
 * parsing (no second Gherkin parser). Read+parse-per-render matches how
 * TraceabilityService already derives automation status (cheap: features are
 * small), so no index/cache is introduced.
 */

/** Per-Feature health for the Use Case detail view's muted info line. */
export interface FeatureHealth {
  path: VaultPath;
  /** Number of scenarios the Feature declares. */
  scenarioCount: number;
  /**
   * Scenarios carrying a SCENARIO-LEVEL `@wip` tag. Feature-level `@wip` is
   * reported separately via {@link featureIsWip} (its own badge), so it is NOT
   * folded in here — that would always read "N scenarios (N @wip)".
   */
  wipScenarioCount: number;
  /** The Feature itself is tagged `@wip` — excluded from KPIs per ADR-0017. */
  featureIsWip: boolean;
}

/**
 * `@wip` is matched case-insensitively, mirroring UseCaseAutomationPolicy's
 * exclusion check (ADR-0017) so the badge and the KPI roll-up agree.
 */
const WIP_TAG = "@wip";
const hasWipTag = (tags: string[]): boolean => tags.some((tag) => tag.toLowerCase() === WIP_TAG);

/**
 * A scenario's EFFECTIVE tags: feature-level tags inherit to every scenario
 * per Gherkin semantics (Cucumber evaluates `--tags` against this union).
 */
export const effectiveScenarioTags = (
  feature: FeatureSpecification,
  scenario: ScenarioSpecification,
): string[] => [...feature.tags, ...scenario.tags];

/** Pure projection of one parsed Feature to its {@link FeatureHealth}. */
export const projectFeatureHealth = (feature: FeatureSpecification): FeatureHealth => ({
  path: feature.path,
  scenarioCount: feature.scenarios.length,
  wipScenarioCount: feature.scenarios.filter((scenario) => hasWipTag(scenario.tags)).length,
  featureIsWip: hasWipTag(feature.tags),
});

/**
 * Counts the scenarios in ONE parsed Feature that a parsed Tag Expression
 * matches, evaluating against each scenario's effective (inherited) tags.
 */
export const countMatchingScenariosInFeature = (
  expression: TagExpression,
  feature: FeatureSpecification,
): number =>
  feature.scenarios.filter((scenario) =>
    matchesTags(expression, effectiveScenarioTags(feature, scenario)),
  ).length;

export interface FeatureInsightService {
  /**
   * Evaluates `tagExpression` against every scenario of every `.feature` file
   * (effective tags, so feature-level tags count) and returns the matched
   * total. A malformed expression returns the parse error (VALIDATION_FAILED)
   * so callers can surface it verbatim. Best-effort over the corpus:
   * unreadable or unparseable Feature files are skipped, matching how
   * TraceabilityService derives automation status.
   */
  countMatchingScenarios(tagExpression: string): Promise<Result<number>>;
  /** Reads + parses one Feature file and projects its {@link FeatureHealth}. */
  healthFor(featurePath: VaultPath): Promise<Result<FeatureHealth>>;
}

export class DefaultFeatureInsightService implements FeatureInsightService {
  constructor(
    private readonly specifications: Pick<SpecificationService, "listFeatures">,
    private readonly fs: VaultFileSystem,
  ) {}

  async countMatchingScenarios(tagExpression: string): Promise<Result<number>> {
    const parsed = parseTagExpression(tagExpression);
    if (!parsed.ok) return err(parsed.error);

    const listed = await this.specifications.listFeatures();
    if (!listed.ok) return err(listed.error);

    let total = 0;
    for (const entry of listed.value) {
      const read = await this.fs.readFile(entry.path);
      if (!read.ok) continue; // best-effort: skip unreadable files
      const feature = parseFeature(read.value, entry.path);
      if (feature === null) continue; // not valid Gherkin — skip
      total += countMatchingScenariosInFeature(parsed.value, feature);
    }
    return ok(total);
  }

  async healthFor(featurePath: VaultPath): Promise<Result<FeatureHealth>> {
    const read = await this.fs.readFile(featurePath);
    if (!read.ok) return err(read.error);
    const feature = parseFeature(read.value, featurePath);
    if (feature === null) {
      return err(appError("VALIDATION_FAILED", `"${featurePath}" is not a valid Feature.`));
    }
    return ok(projectFeatureHealth(feature));
  }
}

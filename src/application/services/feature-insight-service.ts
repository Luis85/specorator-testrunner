import { parseFeature } from "../content/gherkin";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SpecificationService } from "./specification-service";
import type {
  FeatureSpecification,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import { isScenarioOutline } from "../../domain/entities/specification";
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
   * Scenarios carrying a SCENARIO-LEVEL `@wip` tag, or a `@wip` on a runnable
   * Examples block — the same per-block scope `countMatchingScenariosInFeature`
   * matches against, so the health line and suite counts agree. Feature-level
   * `@wip` is reported separately via {@link featureIsWip} (its own badge), so
   * it is NOT folded in here — that would always read "N scenarios (N @wip)".
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
 * Scenario-level `@wip`, or `@wip` on a runnable Examples block — the same
 * per-block scope `countMatchingScenariosInFeature` matches against, so the
 * health line and suite counts agree. Feature-level `@wip` stays out: it is
 * reported separately via `featureIsWip`.
 */
const scenarioHasWip = (scenario: ScenarioSpecification): boolean =>
  hasWipTag(scenario.tags) ||
  (scenario.examples ?? []).some((block) => block.rows.length > 0 && hasWipTag(block.tags));

/**
 * A scenario's EFFECTIVE tags: feature-level tags inherit to every scenario
 * per Gherkin semantics (Cucumber evaluates `--tags` against this union).
 */
export const effectiveScenarioTags = (
  feature: FeatureSpecification,
  scenario: ScenarioSpecification,
): string[] => [...feature.tags, ...scenario.tags];

/**
 * The tag sets Cucumber evaluates for a scenario. A plain scenario
 * contributes its single inherited set. An Outline expands once per Examples
 * ROW, so only blocks that HAVE rows contribute (feature + scenario + block
 * tags) — a rowless block, or an Outline with no usable Examples at all,
 * executes nothing and must not match any expression.
 */
const effectiveScenarioTagSets = (
  feature: FeatureSpecification,
  scenario: ScenarioSpecification,
): string[][] => {
  const base = effectiveScenarioTags(feature, scenario);
  const isOutline = isScenarioOutline(scenario);
  if (!isOutline) return [base];
  const runnable = (scenario.examples ?? []).filter((block) => block.rows.length > 0);
  return runnable.map((block) => [...base, ...block.tags]);
};

/** Pure projection of one parsed Feature to its {@link FeatureHealth}. */
export const projectFeatureHealth = (feature: FeatureSpecification): FeatureHealth => ({
  path: feature.path,
  scenarioCount: feature.scenarios.length,
  wipScenarioCount: feature.scenarios.filter(scenarioHasWip).length,
  featureIsWip: hasWipTag(feature.tags),
});

/**
 * Counts the scenarios in ONE parsed Feature that a parsed Tag Expression
 * matches. An outline still counts as ONE scenario (matching scenarioCount
 * semantics), but it matches when any of its Examples blocks' effective tag
 * sets match — mirroring how Cucumber selects tagged Examples rows.
 */
export const countMatchingScenariosInFeature = (
  expression: TagExpression,
  feature: FeatureSpecification,
): number =>
  feature.scenarios.filter((scenario) =>
    effectiveScenarioTagSets(feature, scenario).some((tags) => matchesTags(expression, tags)),
  ).length;

/**
 * Counts the scenarios a Tag Expression matches against an ALREADY-LOADED
 * Feature corpus, synchronously. Obtained from
 * {@link FeatureInsightService.scenarioCounter} so callers evaluating MANY
 * expressions (the suites explorer renders one count per suite) pay the
 * list+read+parse cost once per render, not once per row.
 */
export type ScenarioCounter = (tagExpression: string) => Result<number>;

export interface FeatureInsightService {
  /**
   * Evaluates `tagExpression` against every scenario of every `.feature` file
   * (effective tags, so feature-level tags count) and returns the matched
   * total. A malformed expression returns the parse error (VALIDATION_FAILED)
   * so callers can surface it verbatim. Best-effort over the corpus:
   * unreadable or unparseable Feature files are skipped, matching how
   * TraceabilityService derives automation status. For a SINGLE expression
   * (e.g. the CreateSuiteModal preview); evaluating many expressions should
   * go through {@link scenarioCounter} instead.
   */
  countMatchingScenarios(tagExpression: string): Promise<Result<number>>;
  /**
   * Loads + parses the Feature corpus ONCE and returns a synchronous
   * {@link ScenarioCounter} over it (review: the per-row variant made the
   * suites explorer re-read every Feature file once PER SUITE per render —
   * O(suites × features) I/O on every event-driven re-render).
   */
  scenarioCounter(): Promise<Result<ScenarioCounter>>;
  /** Reads + parses one Feature file and projects its {@link FeatureHealth}. */
  healthFor(featurePath: VaultPath): Promise<Result<FeatureHealth>>;
  /**
   * Union of every feature-, scenario- and Examples-level tag across the
   * Feature corpus, seeded with the `@smoke`/`@wip` conventions and sorted.
   * Best-effort like the other corpus queries (unreadable or unparseable
   * files are skipped); feeds the Feature Editor's tag picker.
   */
  listKnownTags(): Promise<Result<string[]>>;
}

export class DefaultFeatureInsightService implements FeatureInsightService {
  constructor(
    private readonly specifications: Pick<SpecificationService, "listFeatures">,
    private readonly fs: VaultFileSystem,
  ) {}

  async countMatchingScenarios(tagExpression: string): Promise<Result<number>> {
    // Cheap pre-check so a malformed expression never costs a corpus load.
    const parsed = parseTagExpression(tagExpression);
    if (!parsed.ok) return err(parsed.error);
    const counter = await this.scenarioCounter();
    if (!counter.ok) return err(counter.error);
    return counter.value(tagExpression);
  }

  async scenarioCounter(): Promise<Result<ScenarioCounter>> {
    const listed = await this.specifications.listFeatures();
    if (!listed.ok) return err(listed.error);

    const features: FeatureSpecification[] = [];
    for (const entry of listed.value) {
      const read = await this.fs.readFile(entry.path);
      if (!read.ok) continue; // best-effort: skip unreadable files
      const feature = parseFeature(read.value, entry.path);
      if (feature === null) continue; // not valid Gherkin — skip
      features.push(feature);
    }

    return ok((tagExpression: string): Result<number> => {
      const parsed = parseTagExpression(tagExpression);
      if (!parsed.ok) return err(parsed.error);
      let total = 0;
      for (const feature of features) {
        total += countMatchingScenariosInFeature(parsed.value, feature);
      }
      return ok(total);
    });
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

  async listKnownTags(): Promise<Result<string[]>> {
    const listed = await this.specifications.listFeatures();
    if (!listed.ok) return err(listed.error);

    const tags = new Set<string>(["@smoke", "@wip"]);
    for (const entry of listed.value) {
      const read = await this.fs.readFile(entry.path);
      if (!read.ok) continue; // best-effort: skip unreadable files
      const feature = parseFeature(read.value, entry.path);
      if (feature === null) continue; // not valid Gherkin — skip
      collectFeatureTags(feature, tags);
    }
    return ok([...tags].sort());
  }
}

/** Adds every feature/scenario/Examples-block tag of `feature` to `tags`. */
const collectFeatureTags = (feature: FeatureSpecification, tags: Set<string>): void => {
  for (const tag of feature.tags) tags.add(tag);
  for (const scenario of feature.scenarios) {
    for (const tag of scenario.tags) tags.add(tag);
    for (const block of scenario.examples ?? []) {
      for (const tag of block.tags) tags.add(tag);
    }
  }
};

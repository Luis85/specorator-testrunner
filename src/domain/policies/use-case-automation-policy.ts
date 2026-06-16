import type { FeatureSpecification } from "../entities/specification";
import type { AutomationStatus } from "../entities/use-case";
import { featureScenarioRefs } from "../value-objects/scenario-reference";

/**
 * UseCaseAutomationPolicy (ADR-0017 table, ADR-0022 history-derived — US-057).
 *
 * Derives `UseCase.automationStatus` from the states of its Features. A Feature's
 * state is rolled up from its scenarios' *latest* recorded results
 * (per-scenario history, US-057), not from a single UC-level `lastTestRun`. This
 * replaces V1's ADR-0017 "floor" + scope-awareness workaround: because each
 * scenario keeps its own last-known status, a targeted single-Feature/scenario
 * rerun updates only the scenarios it touched, so siblings can neither regress
 * nor inflate the roll-up — no floor is needed.
 *
 * Features tagged `@wip` are excluded so half-built work does not drag the
 * dashboard red (ADR-0017 — exclusion granularity is the Feature, not the
 * scenario). Pure domain logic: no I/O, unit-testable in isolation (BBV §10).
 */

const WIP_TAG = "@wip";

/**
 * Latest recorded scenario results, as a runtime list so the history log
 * read-back validation (ScenarioHistoryService) enumerates the same single
 * source the {@link ScenarioLatestStatus} union is derived from.
 */
export const SCENARIO_LATEST_STATUSES = ["passed", "failed", "skipped"] as const;

/** Latest recorded result of a scenario; `undefined` means it has never run. */
export type ScenarioLatestStatus = (typeof SCENARIO_LATEST_STATUSES)[number];

/**
 * Looks up a scenario's latest recorded status by its Scenario Reference
 * (`<featurePath>::<name>[::row-<digest>]`, US-056). Returns `undefined` for a
 * scenario with no history. Supplied by the application layer from the
 * `ScenarioHistoryService` projection; the policy stays pure.
 */
export type ScenarioStatusLookup = (scenarioRef: string) => ScenarioLatestStatus | undefined;

/** A Feature tagged `@wip` is parked work — excluded from the roll-up. */
const isWip = (feature: FeatureSpecification): boolean =>
  feature.tags.some((tag) => tag.toLowerCase() === WIP_TAG);

/**
 * A Feature has "undefined Gherkin steps" (the `missing-steps` row) when it
 * declares no scenarios at all, or any scenario has no steps. Concrete step
 * definitions live in the runner project, not the spec; an empty step list is
 * the strongest signal available at the domain level that the Feature cannot be
 * executed as written.
 */
const hasUndefinedSteps = (feature: FeatureSpecification): boolean =>
  feature.scenarios.length === 0 ||
  feature.scenarios.some((scenario) => scenario.steps.length === 0);

/** Run state of a single Feature, rolled up from its scenarios' latest results. */
type FeatureRunState = "not-run" | "passing" | "failing" | "partial";

/**
 * Rolls a Feature up from its scenarios' latest statuses:
 * - `not-run` — none of its scenarios has any recorded result;
 * - `failing` — at least one scenario's latest result is `failed`;
 * - `passing` — every scenario has run and its latest result is `passed`;
 * - `partial` — some scenarios ran (none failing) but not all passed (a
 *   `skipped` latest, or a scenario with no history yet).
 *
 * A Feature with no resolvable scenario references reads as `not-run` (rare;
 * US-056 keeps references collision-free, and this only happens when every
 * scenario degraded to an unset ref — accepted edge, ADR-0022).
 */
const featureRunState = (
  feature: FeatureSpecification,
  latestStatusFor: ScenarioStatusLookup,
): FeatureRunState => {
  const refs = featureScenarioRefs(feature);
  let anyRun = false;
  let anyFailed = false;
  let allPassed = refs.length > 0;
  for (const { ref } of refs) {
    const status = latestStatusFor(ref);
    if (status === undefined) {
      allPassed = false;
      continue;
    }
    anyRun = true;
    if (status === "failed") anyFailed = true;
    if (status !== "passed") allPassed = false;
  }
  if (!anyRun) return "not-run";
  if (anyFailed) return "failing";
  return allPassed ? "passing" : "partial";
};

/**
 * Computes the roll-up `AutomationStatus` for a Use Case from its (non-`@wip`)
 * Features and the per-scenario history, per the ADR-0017 table:
 *
 * | Non-`@wip` Feature states            | result          |
 * | ------------------------------------ | --------------- |
 * | No Features                          | `not-planned`   |
 * | 1+ Features, none ever run           | `planned`       |
 * | 1+ Features have undefined steps     | `missing-steps` |
 * | All run, all passed                  | `passing`       |
 * | Any Feature failing                  | `failing`       |
 * | Some run, none failing, not all pass | `implemented`   |
 */
export const computeAutomationStatus = (
  features: FeatureSpecification[],
  latestStatusFor: ScenarioStatusLookup,
): AutomationStatus => {
  const active = features.filter((feature) => !isWip(feature));

  // No (non-@wip) Features exist for this UC.
  if (active.length === 0) return "not-planned";

  // A Feature that cannot be executed as written outranks run state: the user
  // must finish writing it before any pass/fail signal is meaningful.
  if (active.some(hasUndefinedSteps)) return "missing-steps";

  const states = active.map((feature) => featureRunState(feature, latestStatusFor));

  // No scenario across any active Feature has run yet: specified but unexercised.
  if (states.every((state) => state === "not-run")) return "planned";

  // Any failing Feature keeps the UC red until every scenario passes again.
  if (states.some((state) => state === "failing")) return "failing";

  // Every active Feature passed all its scenarios — the whole UC passes.
  if (states.every((state) => state === "passing")) return "passing";

  // Exercised at least once, nothing failing, but not all passing yet.
  return "implemented";
};

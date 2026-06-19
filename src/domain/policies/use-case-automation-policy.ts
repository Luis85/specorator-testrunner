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
 * scenario). Individual scenarios tagged `@quarantine` are excluded too (US-058,
 * UC-028): a consciously-parked flaky scenario keeps running and recording
 * history, but its flapping must not move the KPI — exclusion granularity here is
 * the scenario, not the Feature. Pure domain logic: no I/O, unit-testable in
 * isolation (BBV §10).
 */

const WIP_TAG = "@wip";
/** A scenario tagged `@quarantine` is a parked flake — excluded from the roll-up. */
const QUARANTINE_TAG = "@quarantine";

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
 * A scenario tagged `@quarantine` is excluded from its Feature's run-state
 * roll-up (US-058). Matched case-insensitively, mirroring {@link isWip}, so the
 * KPI exclusion and the dashboard's quarantine count agree.
 */
const isQuarantined = (tags: string[]): boolean =>
  tags.some((tag) => tag.toLowerCase() === QUARANTINE_TAG);

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

/**
 * Run state of a single Feature, rolled up from its scenarios' latest results.
 * `excluded` is the neutral state for a Feature that contributes no scenarios to
 * the roll-up (every scenario is `@quarantine`); the aggregate drops it entirely.
 */
type FeatureRunState = "excluded" | "not-run" | "passing" | "failing" | "partial";

/**
 * Rolls a Feature up from its scenarios' latest statuses:
 * - `excluded` — it has scenarios but every one is `@quarantine`, so it
 *   contributes no run signal and is dropped from the aggregate (US-058);
 * - `not-run` — none of its (non-quarantined) scenarios has any recorded result;
 * - `failing` — at least one scenario's latest result is `failed`;
 * - `passing` — every scenario has run and its latest result is `passed`;
 * - `partial` — some scenarios ran (none failing) but not all passed (a
 *   `skipped` latest, or a scenario with no history yet).
 *
 * A Feature with no resolvable scenario references reads as `not-run` (rare;
 * US-056 keeps references collision-free, and this only happens when every
 * scenario degraded to an unset ref — accepted edge, ADR-0022).
 *
 * Scenarios tagged `@quarantine` are dropped first (US-058): a parked flake
 * contributes no pass/fail signal. A Feature whose scenarios are ALL quarantined
 * has no active refs and reads `excluded` — neutral in the roll-up (a passing
 * sibling can still make the UC pass), NOT `not-run` (which would drag a passing
 * UC down to `implemented`).
 */
const featureRunState = (
  feature: FeatureSpecification,
  latestStatusFor: ScenarioStatusLookup,
): FeatureRunState => {
  const allRefs = featureScenarioRefs(feature);
  const refs = allRefs.filter((entry) => !isQuarantined(entry.tags));
  // `excluded` (neutral) ONLY when there WERE refs and `@quarantine` removed them
  // all. A Feature with no refs to begin with — a rowless Scenario Outline, or
  // every scenario degraded to an unset ref (ADR-0022) — never executed, so it
  // stays `not-run` below rather than silently letting a passing sibling carry
  // the UC to `passing`.
  if (refs.length === 0 && allRefs.length > 0) return "excluded";
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
 * | 1+ Features have undefined steps     | `missing-steps` |
 * | All Features fully quarantined       | `planned`       |
 * | No contributing Feature has run      | `planned`       |
 * | Any Feature failing                  | `failing`       |
 * | All contributing Features passing    | `passing`       |
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
  // must finish writing it before any pass/fail signal is meaningful. Checked
  // over ALL active Features (quarantine parks a flake, not an unwritten step).
  if (active.some(hasUndefinedSteps)) return "missing-steps";

  // Fully-quarantined Features (`excluded`) contribute no signal and are dropped,
  // so a passing sibling is not dragged down to `implemented` (US-058). If every
  // Feature is excluded, `states` is empty and the `every` checks below fall
  // through to `planned` (no KPI-contributing run).
  const states = active
    .map((feature) => featureRunState(feature, latestStatusFor))
    .filter((state) => state !== "excluded");

  // No scenario across any contributing Feature has run yet (or all are
  // quarantined): specified but unexercised for the KPI.
  if (states.every((state) => state === "not-run")) return "planned";

  // Any failing Feature keeps the UC red until every scenario passes again.
  if (states.some((state) => state === "failing")) return "failing";

  // Every active Feature passed all its scenarios — the whole UC passes.
  if (states.every((state) => state === "passing")) return "passing";

  // Exercised at least once, nothing failing, but not all passing yet.
  return "implemented";
};

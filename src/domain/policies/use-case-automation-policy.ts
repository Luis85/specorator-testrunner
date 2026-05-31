import type { FeatureSpecification } from "../entities/specification";
import type { AutomationStatus, UseCase } from "../entities/use-case";

/**
 * UseCaseAutomationPolicy (ADR-0017, TIS §14.3).
 *
 * Derives `UseCase.automationStatus` from the states of its Features. Features
 * tagged `@wip` are excluded from the roll-up so half-built work does not drag
 * the dashboard red (ADR-0017 — exclusion granularity is the Feature, not the
 * scenario). Pure domain logic: no I/O, unit-testable in isolation (BBV §10).
 */

const WIP_TAG = "@wip";

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

/**
 * Computes the roll-up `AutomationStatus` for a Use Case from its (non-`@wip`)
 * Features and its last run, per the ADR-0017 table:
 *
 * | Non-`@wip` Feature states            | result          |
 * | ------------------------------------ | --------------- |
 * | No Features                          | `not-planned`   |
 * | 1+ Features, none ever run           | `planned`       |
 * | 1+ Features have undefined steps     | `missing-steps` |
 * | All run, all passed                  | `passing`       |
 * | All run, at least one failed         | `failing`       |
 * | Some run, none failed, some not run  | `implemented`   |
 *
 * Run state is sourced from `useCase.lastTestRun` (the UC-level roll-up the
 * vault persists per TIS §10.1); the policy treats "the UC has a recorded run"
 * as "its Features have run". Finer per-Feature run history is deferred to V2.
 */
export const computeAutomationStatus = (
  useCase: UseCase,
  features: FeatureSpecification[],
): AutomationStatus => {
  const active = features.filter((feature) => !isWip(feature));

  // No (non-@wip) Features exist for this UC.
  if (active.length === 0) return "not-planned";

  // A Feature that cannot be executed as written outranks run state: the user
  // must finish writing it before any pass/fail signal is meaningful.
  if (active.some(hasUndefinedSteps)) return "missing-steps";

  const lastRun = useCase.lastTestRun;
  // No run recorded yet: Features are specified but never exercised.
  if (!lastRun) return "planned";

  // A recorded failure (or errored run) keeps the UC red until it passes again.
  if (lastRun.status === "failed" || lastRun.status === "errored") return "failing";

  // The UC has run and the last result was a pass. ADR-0017 rejects a latest-
  // wins roll-up: a single passing run only makes the WHOLE UC "passing" when it
  // actually exercised every (non-@wip) Feature — i.e. a UC-wide run
  // (`use-case`/`all`), or a UC with a single Feature (any scope covers it). A
  // single-Feature-scope run on a multi-Feature UC leaves siblings unrun, so the
  // UC stays partially "implemented". A legacy summary without a scope keeps the
  // prior behaviour (treated as covering) for backward compatibility.
  if (lastRun.status === "passed") {
    const coversWholeUseCase =
      lastRun.scope === undefined ||
      lastRun.scope === "all" ||
      lastRun.scope === "use-case" ||
      active.length === 1;
    return coversWholeUseCase ? "passing" : "implemented";
  }

  // Queued / running / cancelled: exercised at least once but no clean pass yet.
  return "implemented";
};

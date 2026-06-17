import type { DomainEventType } from "../events/domain-event";
import { matchesTags, parseTagExpression } from "../policies/tag-expression";

/**
 * The Guided Tour's completion vocabulary (spec 2026-06-11): the event/rule
 * types and the pure, defensive predicates that observe each step's completion
 * from domain events. Kept apart from the {@link TOUR_STEPS} table so the
 * "how do we know a step is done" logic reads (and tests) on its own. Every
 * predicate must exclude the artifacts initialization itself ships.
 */

/** Known init-shipped artifacts the predicates exclude (wired in main.ts). */
export interface TourEventContext {
  demoUseCaseId: string; // DEMO_USE_CASE_ID ("UC-001")
  demoFeatureFileName: string; // DEMO_FEATURE_FILE_NAME
  defaultSuiteIds: readonly string[]; // DEFAULT_SUITES ids ("smoke", "regression")
}

/**
 * One observable condition. `matches` is pure and defensive: payloads arrive
 * as `unknown` at subscription time and a malformed shape simply doesn't match.
 * `captured` carries the previous sequence rule's {@link TourEventRule.capture}
 * value (e.g. a runId) so a sequence can correlate its events.
 */
export interface TourEventRule {
  type: DomainEventType;
  matches(payload: unknown, ctx: TourEventContext, captured?: string): boolean;
  /** Value remembered for the NEXT rule of an event-sequence. */
  capture?(payload: unknown): string | undefined;
}

export type TourCompletion =
  | { kind: "event"; rule: TourEventRule }
  /** Each rule must match once, in order. */
  | {
      kind: "event-sequence";
      rules: readonly TourEventRule[];
      /**
       * Rules that roll the sequence back to {@link retryFrom} when they match
       * mid-flight — the terminal events of a FAILED attempt. Without them a
       * run-correlated sequence would keep waiting for the failed run's id and
       * dead-end the step on the documented "fix it, then re-run" path
       * (PR #31 Codex review). `matches` receives the most recent capture.
       */
      resetOn?: readonly TourEventRule[];
      /** Index the sequence rolls back to on reset (default 0). */
      retryFrom?: number;
    }
  | { kind: "manual" };

/** Narrows an unknown payload to a plain record, or null. */
export const record = (payload: unknown): Record<string, unknown> | null =>
  typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;

/**
 * True when a Tag Expression would SELECT the authored `@tour`
 * scenario — evaluated with the real tag-expression semantics, not a token
 * scan, so `not @tour` (token present, scenario excluded) is rejected while
 * `@smoke or @tour` (scenario included) passes (PR #31 Codex review).
 */
const selectsTourScenario = (tagExpression: unknown): boolean => {
  if (typeof tagExpression !== "string") return false;
  const parsed = parseTagExpression(tagExpression);
  return parsed.ok && matchesTags(parsed.value, ["@tour"]);
};

/**
 * Shared by the create-suite rule and run-own-test's first sequence rule (the
 * one check, no drift): a non-default suite whose Tag Expression selects the
 * authored scenario.
 */
export const isTourSuiteCreation = (payload: unknown, ctx: TourEventContext): boolean => {
  const p = record(payload);
  return (
    typeof p?.suiteId === "string" &&
    !ctx.defaultSuiteIds.includes(p.suiteId) &&
    selectsTourScenario(p.tagExpression)
  );
};

/**
 * A successful validation of the authored Feature: valid, non-demo, tagged
 * @tour. Requiring @tour (not just valid) closes the loophole Codex flagged
 * on PR #31 — the generated scaffold validates clean, but only the AUTHORED
 * scenario carries the tag this step teaches.
 */
export const isTourFeatureValidation = (payload: unknown, ctx: TourEventContext): boolean => {
  const p = record(payload);
  return (
    p?.valid === true &&
    typeof p.featurePath === "string" &&
    !p.featurePath.endsWith(ctx.demoFeatureFileName) &&
    Array.isArray(p.tags) &&
    p.tags.includes("@tour")
  );
};

/** Captures a payload's featurePath (the correlation key of steps 4–6). */
export const captureFeaturePath = (payload: unknown): string | undefined => {
  const value = record(payload)?.featurePath;
  return typeof value === "string" ? value : undefined;
};

/** Captures a payload's runId (the correlation key of the run sequences). */
export const captureRunId = (payload: unknown): string | undefined => {
  const value = record(payload)?.runId;
  return typeof value === "string" ? value : undefined;
};

/** Captures a payload's suiteId (the run-own-test sequence's first key). */
export const captureSuiteId = (payload: unknown): string | undefined => {
  const value = record(payload)?.suiteId;
  return typeof value === "string" ? value : undefined;
};

/**
 * Final rule of the run-correlated sequences: a PASSED terminal whose runId is
 * the one the sequence captured — never an arbitrary green run.
 */
export const isCapturedRunPassed = (
  payload: unknown,
  _ctx: TourEventContext,
  captured?: string,
): boolean => {
  const p = record(payload);
  return p?.status === "passed" && captured !== undefined && p.runId === captured;
};

/**
 * Anchor rule of the feature-scoped sequences (steps 5 and 6): the @tour
 * Feature's validation, capturing its path so later detection/generation
 * events for OTHER feature files cannot advance the tour (PR #31 Codex
 * review). Shared, pure, stateless — safe to reference from several steps.
 */
export const tourFeatureValidated: TourEventRule = {
  type: "specification.validation.completed",
  matches: isTourFeatureValidation,
  capture: captureFeaturePath,
};

/**
 * The terminal events of a failed/aborted attempt, for run-correlated
 * sequences' `resetOn`. `captured` is the value the sequence is currently
 * waiting on; before a runId is captured the rules match any terminal —
 * ADR-0018 (single active run) guarantees a terminal seen mid-sequence
 * belongs to the attempt being tracked. A PASSED terminal never resets (the
 * final rule consumes it first).
 */
export const failedAttemptTerminals: readonly TourEventRule[] = [
  {
    type: "testrun.completed",
    matches: (payload, _ctx, captured) => {
      const p = record(payload);
      return p?.status === "failed" && (captured === undefined || p.runId === captured);
    },
  },
  {
    type: "testrun.failed",
    matches: (payload, _ctx, captured) =>
      captured === undefined || record(payload)?.runId === captured,
  },
  {
    type: "testrun.cancelled",
    matches: (payload, _ctx, captured) =>
      captured === undefined || record(payload)?.runId === captured,
  },
];

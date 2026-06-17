import type { ScenarioLatestStatus } from "./use-case-automation-policy";

/**
 * Scenario flakiness scoring (US-058, EPIC-014). A pure projection over the
 * per-scenario history window US-057 records (`recent: last-N normalized
 * statuses`). The signal the story names is **status flips** — pass↔fail
 * transitions — so the score is the flip RATE over the window: `0` = never flips
 * (stable), `1` = flips on every run (maximally flaky). The AC's "stability
 * score" is its inverse (`1 - score`); flakiness is exposed because the title,
 * the dashboard, and the quarantine cap are all flakiness-oriented.
 *
 * No I/O — unit-testable in isolation (BBV §10), like the roll-up policy.
 */

/** Flakiness classification bands (D2); see {@link computeFlakiness}. */
export const FLAKINESS_BANDS = ["unknown", "stable", "suspect", "flaky"] as const;
export type FlakinessBand = (typeof FLAKINESS_BANDS)[number];

export interface ScenarioFlakiness {
  /** Pass/fail results considered after dropping `skipped`. */
  runs: number;
  /** Adjacent pass/fail pairs compared (`max(0, runs - 1)`). */
  transitions: number;
  /** Adjacent pairs whose status differs (pass↔fail). */
  flips: number;
  /** `flips / transitions` in `[0, 1]`; `0` when fewer than two pass/fail runs. */
  score: number;
  band: FlakinessBand;
}

/** Fewer pass/fail results than this cannot exhibit a flip — band is `unknown`. */
export const MIN_RUNS_FOR_SCORE = 2;
/** At or above this flip rate a scenario is `flaky`; below (but > 0) is `suspect`. */
export const FLAKY_SCORE = 0.5;

/**
 * Computes a scenario's flakiness from its history window. `skipped` results are
 * dropped first (a skip is not a pass/fail signal: it should neither register as
 * a flip nor count as a stabilising pass), then the flip rate is taken over the
 * remaining pass/fail subsequence. Flip count is reversal-invariant, so the
 * window may be passed newest-first (as stored) or oldest-first.
 */
export const computeFlakiness = (statuses: readonly ScenarioLatestStatus[]): ScenarioFlakiness => {
  const outcomes = statuses.filter((status) => status !== "skipped");
  const runs = outcomes.length;
  const transitions = Math.max(0, runs - 1);
  let flips = 0;
  for (let i = 1; i < runs; i += 1) {
    if (outcomes[i] !== outcomes[i - 1]) flips += 1;
  }
  const score = transitions === 0 ? 0 : flips / transitions;
  return { runs, transitions, flips, score, band: classify(runs, flips, score) };
};

const classify = (runs: number, flips: number, score: number): FlakinessBand => {
  if (runs < MIN_RUNS_FOR_SCORE) return "unknown";
  if (flips === 0) return "stable";
  return score >= FLAKY_SCORE ? "flaky" : "suspect";
};

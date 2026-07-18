import type { TestRunStatus } from "../../domain/entities/test-run";

/**
 * Pure formatting helpers for the live Test Console (US-030, UC-015). Kept
 * I/O-free and DOM-free so the rendering logic is unit-testable.
 */

/** A streamed line, prefixed so stderr is visually distinct from stdout. */
export const formatOutputLine = (stream: "stdout" | "stderr", line: string): string =>
  stream === "stderr" ? `[stderr] ${line}` : line;

/** Human-readable banner for the run's terminal state. */
export const formatStatusBanner = (status: TestRunStatus, durationMs?: number): string => {
  const suffix = durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(1)}s)` : "";
  switch (status) {
    case "passed":
      return `Run passed${suffix}`;
    case "failed":
      return `Run failed${suffix}`;
    case "errored":
      return `Run errored${suffix}`;
    case "cancelled":
      return `Run cancelled${suffix}`;
    case "running":
      return "Run in progress…";
    case "queued":
      return "Run queued";
  }
};

// Playwright's list reporter ends a run with one summary line per non-zero
// outcome category (the `passed` line also carries the total duration). These
// are the lines worth lifting into the banner so the OUTCOME reads at the top
// instead of only "Run failed" (testvault demo-run feedback).
const PLAYWRIGHT_SUMMARY = /^\d+ (?:passed|failed|flaky|skipped|interrupted|did not run)\b/;

// playwright-bdd's `bddgen` prints this header (+ step snippets) when a feature
// references steps with no definition — the SAME signal `SpecificationService`
// keys on. bddgen still exits 0, so those scenarios fail under `playwright test`;
// surfacing the header explains WHY the run failed and drives the hint below.
const BDDGEN_MISSING_STEPS = /^Missing step definitions: (\d+)/;

/**
 * Lifts a runner summary line out of the stream: a Playwright list-reporter
 * count (`12 passed (3.4s)`, `1 failed`, …) or playwright-bdd's
 * `Missing step definitions: N` header. Returns the trimmed line, or null for
 * any other output.
 */
export const extractRunSummary = (line: string): string | null => {
  const trimmed = line.trim();
  return PLAYWRIGHT_SUMMARY.test(trimmed) || BDDGEN_MISSING_STEPS.test(trimmed) ? trimmed : null;
};

/**
 * An actionable hint derived from the lifted summary lines, or null when none
 * applies. Missing step definitions are the one outcome a normal user can't
 * decode alone — point them at the step-definition flow.
 */
export const summaryHint = (summaryLines: readonly string[]): string | null =>
  summaryLines.some((line) => {
    const match = BDDGEN_MISSING_STEPS.exec(line.trim());
    return match !== null && Number(match[1]) > 0;
  })
    ? "Some steps have no step definition — open Pending Steps to generate and implement them."
    : null;

/**
 * Formats an elapsed duration as `mm:ss` for the Test Console's live timer.
 * Pure (no `Date.now()` inside) so the tick logic is unit-tested without a
 * clock. Negative inputs clamp to zero; minutes are not capped at 60 so a long
 * run reads e.g. `75:09`.
 */
export const formatElapsed = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

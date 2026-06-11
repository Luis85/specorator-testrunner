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

/**
 * Recognizes Cucumber's end-of-run summary lines ("1 scenario (1 undefined)",
 * "3 steps (3 undefined)") in the streamed output. The banner appends them so
 * the OUTCOME is readable at the top — without this, "Run failed" gives no
 * reason and the explanation sits at the bottom of a long stream (testvault
 * demo-run feedback). Returns the trimmed line, or null for any other line.
 */
export const extractCucumberSummary = (line: string): string | null => {
  const trimmed = line.trim();
  return /^\d+ (scenarios?|steps?) \(.+\)$/.test(trimmed) ? trimmed : null;
};

/**
 * An actionable hint derived from the run's Cucumber summary, or null when no
 * guidance applies. "undefined" steps are the one outcome a normal user can't
 * decode from the summary alone — point them at the step-definition flow.
 */
export const summaryHint = (summaryLines: readonly string[]): string | null =>
  summaryLines.some((line) => line.includes("undefined"))
    ? "Some steps have no step definition. Open the Use Case and use “Generate step definitions”, then implement the stubs in .testrunner/src/steps."
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

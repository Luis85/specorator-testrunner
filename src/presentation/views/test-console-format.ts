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

/** CSS modifier suffix for status-driven styling. */
export const statusModifier = (status: TestRunStatus): string => status;

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

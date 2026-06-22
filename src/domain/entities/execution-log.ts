import type { RunId } from "../value-objects/identifiers";
import type { ExecutionScope, TestRun, TestRunResult, TestRunStatus } from "./test-run";

/**
 * One terminal run's entry in the durable execution log (E1). Unlike the
 * evidence-derived history sources (the traceability snapshot's `recentRuns`
 * and {@link RunHistoryService}, both keyed off Evidence partitions), this log
 * records EVERY terminal run — including an `errored` spawn fault or a
 * `cancelled` run that produced no evidence — so a later read can surface an
 * honest "last run" verdict rather than the stale prior run those sources skip
 * to.
 */
export interface ExecutionLogEntry {
  runId: RunId;
  scope: ExecutionScope;
  target: string;
  status: TestRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  result?: TestRunResult;
}

/**
 * Projects a finished {@link TestRun} into an {@link ExecutionLogEntry}. Pure —
 * no I/O. `finishedAt` falls back to `startedAt` when the run carries none; a
 * terminal run should always have it, so this is purely defensive. `result` and
 * `durationMs` are carried only when present (an `errored`/`cancelled` run may
 * have neither).
 */
export const toExecutionLogEntry = (run: TestRun): ExecutionLogEntry => ({
  runId: run.id,
  scope: run.scope,
  target: run.target,
  status: run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt ?? run.startedAt,
  ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
  ...(run.result !== undefined ? { result: run.result } : {}),
});

/**
 * Returns a newest-first list with `entry` at the head, any existing entry for
 * the SAME `runId` removed (a re-record of a run replaces its prior entry rather
 * than duplicating it), then truncated to `cap`. Pure — no I/O. A `cap` of 0
 * yields an empty list.
 */
export const prependCapped = (
  entries: readonly ExecutionLogEntry[],
  entry: ExecutionLogEntry,
  cap: number,
): ExecutionLogEntry[] =>
  [entry, ...entries.filter((existing) => existing.runId !== entry.runId)].slice(
    0,
    Math.max(cap, 0),
  );

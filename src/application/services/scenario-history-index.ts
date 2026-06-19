import { EXECUTION_SCOPES, type ExecutionScope } from "../../domain/entities/test-run";
import {
  SCENARIO_LATEST_STATUSES,
  type ScenarioLatestStatus,
} from "../../domain/policies/use-case-automation-policy";

/**
 * The data model, schema guards, and folding logic for the per-scenario history
 * projections (US-057, EPIC-014). Kept separate from {@link
 * DefaultScenarioHistoryService} (which owns the I/O and orchestration) so the
 * projection's shape and its v1-schema validation live as pure, dependency-light
 * units. ADR-0022: these are *rebuildable projections*, never an independent
 * source of truth — the Evidence notes remain authoritative.
 */

export const SCHEMA_VERSION = 1;

/** `YYYY/MM/<runId>/scenarios.ndjson` relative to the evidence root (ADR-0016). */
export const NDJSON_PATTERN = /^(\d{4})\/(\d{2})\/([^/]+)\/scenarios\.ndjson$/;
/** `YYYY/MM/<runId>/summary.md` — the note we fall back to for rebuild (D2). */
export const SUMMARY_PATTERN = /^(\d{4})\/(\d{2})\/([^/]+)\/summary\.md$/;

/** One per-scenario result line in a per-run `scenarios.ndjson`. */
export interface HistoryLine {
  v: number;
  scenarioRef: string;
  runId: string;
  status: ScenarioLatestStatus;
  at: string;
  durationMs?: number;
  scope: ExecutionScope;
}

export interface HistoryEntry {
  status: ScenarioLatestStatus;
  runId: string;
  at: string;
  durationMs?: number;
  scope: ExecutionScope;
}

export interface ScenarioRecord {
  latest: HistoryEntry;
  recent: HistoryEntry[];
}

export interface ScenarioIndex {
  v: number;
  depth: number;
  /**
   * The configured evidence root this projection was built from. A mismatch with
   * the current `paths.evidencePath` means the cache describes a different tree
   * (the user repointed the Evidence folder while the plugin was open), so it is
   * stale and must be rebuilt rather than served (codex P2). Optional for
   * back-compat: an index written before this field is treated as stale once.
   */
  root?: string;
  scenarios: Record<string, ScenarioRecord>;
}

export const lineToEntry = (line: HistoryLine): HistoryEntry => ({
  status: line.status,
  runId: line.runId,
  at: line.at,
  ...(line.durationMs !== undefined ? { durationMs: line.durationMs } : {}),
  scope: line.scope,
});

export const asString = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * Folds one result into a scenario's record: de-dupes by runId (idempotent
 * re-imports), keeps `recent` newest-first trimmed to `depth`, and sets `latest`
 * to the newest-by-timestamp entry.
 */
export const foldEntry = (
  index: ScenarioIndex,
  ref: string,
  entry: HistoryEntry,
  depth: number,
): void => {
  const existing = index.scenarios[ref];
  const recent = (existing?.recent ?? []).filter((e) => e.runId !== entry.runId);
  recent.push(entry);
  recent.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const trimmed = recent.slice(0, depth);
  index.scenarios[ref] = { latest: trimmed[0], recent: trimmed };
};

const VALID_STATUSES = new Set<string>(SCENARIO_LATEST_STATUSES);
const VALID_SCOPES = new Set<string>(EXECUTION_SCOPES);

/**
 * Strict v1 schema guard for one NDJSON history line. A line that parses as JSON
 * but violates the schema — status outside the {@link ScenarioLatestStatus}
 * union, blank/missing `scenarioRef`/`runId`/`at`, unknown `scope`, or a
 * non-numeric `durationMs` — is rejected so the rebuild marks the log errored and
 * prefers the authoritative note, rather than storing a corrupt status the
 * roll-up would silently mis-read (codex P2).
 */
export const isHistoryLine = (value: unknown): value is HistoryLine => {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.scenarioRef === "string" &&
    line.scenarioRef !== "" &&
    typeof line.runId === "string" &&
    line.runId !== "" &&
    typeof line.at === "string" &&
    line.at !== "" &&
    typeof line.status === "string" &&
    VALID_STATUSES.has(line.status) &&
    typeof line.scope === "string" &&
    VALID_SCOPES.has(line.scope) &&
    (line.durationMs === undefined || typeof line.durationMs === "number")
  );
};

/**
 * Strict guard for a persisted {@link HistoryEntry}. Applies the SAME schema
 * validation as {@link isHistoryLine} (status union, non-blank runId/at, scope
 * union, numeric durationMs) so a parseable-but-corrupt cache — e.g. a hand-
 * edited/sync-mangled `status: "failed "` — is rejected and the index rebuilt
 * from the authoritative logs, rather than served and mis-read by the roll-up
 * (codex P2).
 */
const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.status === "string" &&
    VALID_STATUSES.has(entry.status) &&
    typeof entry.runId === "string" &&
    entry.runId !== "" &&
    typeof entry.at === "string" &&
    entry.at !== "" &&
    typeof entry.scope === "string" &&
    VALID_SCOPES.has(entry.scope) &&
    (entry.durationMs === undefined || typeof entry.durationMs === "number")
  );
};

/**
 * Structural guard for a persisted {@link ScenarioIndex}. Rejects a
 * parseable-but-malformed cache (e.g. `scenarios` not a plain object, or a
 * record missing a usable `latest`/`recent`) so {@link DefaultScenarioHistoryService}
 * rebuilds from the committed logs instead of crashing a later deref (codex P2).
 */
export const isScenarioIndex = (value: unknown): value is ScenarioIndex => {
  if (typeof value !== "object" || value === null) return false;
  const scenarios = (value as { scenarios?: unknown }).scenarios;
  if (typeof scenarios !== "object" || scenarios === null || Array.isArray(scenarios)) return false;
  return Object.values(scenarios as Record<string, unknown>).every((record) => {
    if (typeof record !== "object" || record === null) return false;
    const { latest, recent } = record as { latest?: unknown; recent?: unknown };
    return isHistoryEntry(latest) && Array.isArray(recent) && recent.every(isHistoryEntry);
  });
};

import type { RunHistoryEntry } from "../../application/services/run-history-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** Runs fetched per "Load older" click (and on first paint). */
export const EVIDENCE_PAGE_SIZE = 50;

/** The statuses evidence frontmatter can carry, plus the no-filter sentinel. */
export const EVIDENCE_STATUS_FILTERS = [
  "all",
  "passed",
  "failed",
  "errored",
  "cancelled",
  "skipped",
] as const;
export type EvidenceStatusFilter = (typeof EVIDENCE_STATUS_FILTERS)[number];

/**
 * Display label for a status filter option: capitalized for the dropdown while
 * the option VALUE keeps the lowercase filter the projection compares against.
 */
export const statusFilterLabel = (filter: EvidenceStatusFilter): string =>
  filter.charAt(0).toUpperCase() + filter.slice(1);

export interface EvidenceRunRow {
  runId: string;
  status: string;
  passed: string;
  failed: string;
  total: string;
  scope: string;
  date: string;
  evidencePath: VaultPath;
  ariaLabel: string;
}

export interface EvidenceMonthGroup {
  heading: string;
  rows: EvidenceRunRow[];
}

const MISSING = "—";

const count = (value: number | undefined): string =>
  value === undefined ? MISSING : String(value);

/** `2026-05-31T10:05:00.000Z` → `2026-05-31 10:05`; missing/odd values → `—`. */
const formatDate = (iso: string | undefined): string =>
  iso === undefined || iso.length < 16 ? MISSING : iso.slice(0, 16).replace("T", " ");

const scopeLabel = (entry: RunHistoryEntry): string => {
  if (entry.scope === undefined) return MISSING;
  // A demo run's target IS "demo" — repeating it adds nothing.
  return entry.target === undefined || entry.target === entry.scope
    ? entry.scope
    : `${entry.scope}: ${entry.target}`;
};

/**
 * One history entry → one table row. Pre-existing notes lack `scope`/`target`
 * and unreadable notes lack everything frontmatter-derived; both degrade to
 * placeholder cells with status "unknown" — the row stays navigable because
 * the note's existence is what put it in the list.
 */
export const projectEvidenceRow = (entry: RunHistoryEntry): EvidenceRunRow => {
  const status = entry.status ?? "unknown";
  return {
    runId: entry.runId,
    status,
    passed: count(entry.passed),
    failed: count(entry.failed),
    total: count(entry.total),
    scope: scopeLabel(entry),
    date: formatDate(entry.createdAt),
    evidencePath: entry.evidencePath,
    ariaLabel: `Open evidence for ${entry.runId} (${status})`,
  };
};

/**
 * Groups newest-first entries into month sections (partition-derived, so it
 * needs no date parsing) and applies the status filter to the LOADED entries —
 * "Load older" extends what the filter sees, per the design spec.
 */
export const projectEvidenceGroups = (
  entries: RunHistoryEntry[],
  filter: EvidenceStatusFilter,
): EvidenceMonthGroup[] => {
  const groups: EvidenceMonthGroup[] = [];
  for (const entry of entries) {
    if (filter !== "all" && (entry.status ?? "unknown") !== filter) continue;
    const heading = `${entry.year} / ${entry.month}`;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.heading === heading) {
      last.rows.push(projectEvidenceRow(entry));
    } else {
      groups.push({ heading, rows: [projectEvidenceRow(entry)] });
    }
  }
  return groups;
};

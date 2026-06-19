import { parseScenarioEvidenceBlock } from "../content/scenario-evidence-block";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { ExecutionScope } from "../../domain/entities/test-run";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { parseFrontmatter } from "../../shared/utils/frontmatter";
import {
  asString,
  isHistoryLine,
  lineToEntry,
  NDJSON_PATTERN,
  SUMMARY_PATTERN,
  type HistoryEntry,
} from "./scenario-history-index";

/**
 * Reads the committed per-run history sources back into `scenarioRef → entry`
 * pairs for an index rebuild (US-057, EPIC-014). The per-run NDJSON log is
 * preferred; the colocated Evidence note's `testrunner-scenarios` block is the
 * fallback (design D2) when the log is absent, unusable, or partially corrupt.
 * Kept separate from {@link DefaultScenarioHistoryService} so the parsing rules
 * are an isolated, dependency-light unit; the service still owns orchestration.
 */

/** One per-run folder's history sources, paired by their `YYYY/MM/<runId>` key. */
export interface RunFolder {
  ndjson?: VaultPath;
  summary?: VaultPath;
}

/** A resolved history result: which scenario, and its folded entry. */
export interface RefEntry {
  ref: string;
  entry: HistoryEntry;
}

/**
 * Groups listed Evidence files into per-run folders keyed `YYYY/MM/<runId>`,
 * pairing each run's NDJSON log with its colocated note. The prefix is
 * `root + "/"`, or "" at the vault root, so the relative path is computed exactly
 * regardless of root (codex P2).
 */
export const groupRunFolders = (paths: VaultPath[], root: VaultPath): Map<string, RunFolder> => {
  const prefix = root === "" ? "" : `${root}/`;
  const folders = new Map<string, RunFolder>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const nd = NDJSON_PATTERN.exec(relative);
    if (nd) {
      const key = `${nd[1]}/${nd[2]}/${nd[3]}`;
      folders.set(key, { ...folders.get(key), ndjson: path });
      continue;
    }
    const sm = SUMMARY_PATTERN.exec(relative);
    if (sm) {
      const key = `${sm[1]}/${sm[2]}/${sm[3]}`;
      folders.set(key, { ...folders.get(key), summary: path });
    }
  }
  return folders;
};

/**
 * Resolves a run folder's ref+entry pairs. Prefers the NDJSON log, but falls back
 * to the colocated note when the log is unusable OR partially corrupt — empty,
 * all-skipped, or with any malformed/mid-line-truncated line (external corruption
 * or a partial write). Rebuilding from a truncated subset would silently drop the
 * run's later scenarios even though the note's `testrunner-scenarios` block can
 * still hold the full run (codex P2). A normal run never leaves an empty/partial
 * log: record writes the lines atomically or the zero-ref path deletes it.
 */
export const resolveRunEntries = async (
  vaultFs: VaultFileSystem,
  folder: RunFolder,
): Promise<RefEntry[]> => {
  const { ndjson, summary } = folder;
  if (ndjson) {
    const log = await entriesFromLog(vaultFs, ndjson);
    if ((log.entries.length === 0 || log.hadError) && summary) {
      return entriesFromNote(vaultFs, summary);
    }
    return log.entries;
  }
  if (summary) return entriesFromNote(vaultFs, summary);
  return [];
};

/**
 * Parses a per-run NDJSON log into ref+entry pairs. Reports `hadError` when a
 * non-empty line failed to parse or had the wrong shape (corruption or a mid-line
 * truncated write), so the caller can prefer the colocated note rather than
 * rebuild from a partial subset (codex P2).
 */
const entriesFromLog = async (
  vaultFs: VaultFileSystem,
  path: VaultPath,
): Promise<{ entries: RefEntry[]; hadError: boolean }> => {
  const read = await vaultFs.readFile(path);
  if (!read.ok) return { entries: [], hadError: true };
  const entries: RefEntry[] = [];
  let hadError = false;
  for (const raw of read.value.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isHistoryLine(parsed)) {
        entries.push({ ref: parsed.scenarioRef, entry: lineToEntry(parsed) });
      } else {
        // Parsed but violates the v1 schema (bad status union, missing runId/at,
        // unknown scope, …) — a hand-edited or sync-corrupted line. Mark errored
        // so the rebuild prefers the authoritative note instead of storing a
        // non-union status the roll-up would mis-read (codex P2).
        hadError = true;
      }
    } catch {
      // A hand-edited/corrupt/truncated line — the Markdown stays authoritative.
      hadError = true;
    }
  }
  return { entries, hadError };
};

/** Fallback rebuild source (D2): the note's `testrunner-scenarios` block. */
const entriesFromNote = async (vaultFs: VaultFileSystem, path: VaultPath): Promise<RefEntry[]> => {
  const read = await vaultFs.readFile(path);
  if (!read.ok) return [];
  const frontmatter = parseFrontmatter(read.value);
  const runId = asString(frontmatter.run_id) ?? "";
  // Prefer run_at (the run's completion time) so foldEntry's newest-wins ordering
  // matches the NDJSON history; created_at is the note/import time and would
  // mis-order a re-imported older run (codex P2). Older notes lack run_at.
  const at = asString(frontmatter.run_at) ?? asString(frontmatter.created_at) ?? "";
  const scope = (asString(frontmatter.scope) as ExecutionScope) ?? "all";
  return parseScenarioEvidenceBlock(read.value).map((block) => ({
    ref: block.ref,
    entry: {
      status: block.status,
      runId,
      at,
      ...(block.durationMs !== undefined ? { durationMs: block.durationMs } : {}),
      scope,
    },
  }));
};

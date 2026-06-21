import type { SettingsService } from "./settings-service";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { parseFrontmatter } from "../../shared/utils/frontmatter";

/**
 * One historical run, projected from its ADR-0016 evidence partition. The
 * path-derived fields (`runId`, `year`, `month`, `evidencePath`) are always
 * present; the frontmatter-derived fields are undefined when the note is
 * missing them or could not be read/parsed — the Markdown stays the single
 * source of truth, so an edited or corrupt note degrades, never errors.
 */
export interface RunHistoryEntry {
  runId: string;
  evidencePath: VaultPath;
  year: string;
  month: string;
  status?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  total?: number;
  createdAt?: string;
  scope?: string;
  target?: string;
}

export interface RunHistoryPage {
  entries: RunHistoryEntry[];
  /** True when older runs exist beyond `offset + limit`. */
  hasMore: boolean;
}

/** Read-only run history over the evidence partitions (Evidence Explorer). */
export interface RunHistoryService {
  /** Newest-first page of run history entries. */
  list(options: { offset: number; limit: number }): Promise<Result<RunHistoryPage>>;
  /**
   * Resolves a single run by its `runId` (WS-B4): the deep-link target
   * `{kind:"run", runId}` opens "the run that produced this evidence", and the
   * run history has no other by-id lookup. Returns `null` when no partition
   * carries that run id (renamed/deleted), so the navigator can fall through to
   * a graceful not-found — the same tolerance the UC-detail view has.
   */
  findByRunId(runId: string): Promise<Result<RunHistoryEntry | null>>;
}

/** `YYYY/MM/<runId>/summary.md` relative to the evidence root (ADR-0016). */
const SUMMARY_PATTERN = /^(\d{4})\/(\d{2})\/([^/]+)\/summary\.md$/;

interface Partition {
  path: VaultPath;
  relative: string;
  year: string;
  month: string;
  runId: string;
}

/** Frontmatter scalars parse as strings; arrays/blank values yield undefined. */
const str = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const num = (value: string | string[] | undefined): number | undefined => {
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Scans `Test Evidence/YYYY/MM/<runId>/summary.md` partitions for the Evidence
 * Explorer. The partition layout already encodes recency — months are
 * zero-padded and run ids timestamp-shaped — so the FULL history is ordered by
 * a descending string sort on the relative path; frontmatter is read only for
 * the requested page.
 */
export class DefaultRunHistoryService implements RunHistoryService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly logger: Logger,
  ) {}

  async list(options: { offset: number; limit: number }): Promise<Result<RunHistoryPage>> {
    const scanned = await this.partitions();
    if (!scanned.ok) return err(scanned.error);
    const partitions = scanned.value;

    const page = partitions.slice(options.offset, options.offset + options.limit);
    const entries: RunHistoryEntry[] = [];
    for (const partition of page) entries.push(await this.toEntry(partition));
    return ok({ entries, hasMore: options.offset + options.limit < partitions.length });
  }

  async findByRunId(runId: string): Promise<Result<RunHistoryEntry | null>> {
    const scanned = await this.partitions();
    if (!scanned.ok) return err(scanned.error);
    // The run id is the partition's third path segment (set on every Partition),
    // so a linear scan finds it without reading any frontmatter for the misses.
    const match = scanned.value.find((partition) => partition.runId === runId);
    if (!match) return ok(null);
    return ok(await this.toEntry(match));
  }

  /**
   * Scans the evidence tree into the recency-ordered run partitions (newest
   * first), the shared basis for both `list` (a page of them) and `findByRunId`
   * (a lookup over them). A fresh vault yields an empty list, not an error; a
   * listing fault surfaces as EVIDENCE_LIST_FAILED.
   */
  private async partitions(): Promise<Result<Partition[]>> {
    const settings = await this.settingsService.load();
    const root = settings.paths.evidencePath;
    // A fresh vault has no evidence folder yet — that is "no history", not an error.
    if (!(await this.fs.exists(root))) return ok([]);

    const listed = await this.fs.listFilesRecursive(root);
    if (!listed.ok) {
      return err(
        appError("EVIDENCE_LIST_FAILED", `Could not list evidence notes under "${root}".`, {
          cause: listed.error,
        }),
      );
    }

    const partitions: Partition[] = [];
    for (const path of listed.value) {
      const relative = path.slice(root.length + 1);
      const match = SUMMARY_PATTERN.exec(relative);
      // Artifacts and stray notes inside the evidence tree are not runs.
      if (!match) continue;
      partitions.push({ path, relative, year: match[1], month: match[2], runId: match[3] });
    }
    partitions.sort((a, b) => (a.relative < b.relative ? 1 : a.relative > b.relative ? -1 : 0));
    return ok(partitions);
  }

  private async toEntry(partition: Partition): Promise<RunHistoryEntry> {
    const base: RunHistoryEntry = {
      runId: partition.runId,
      evidencePath: partition.path,
      year: partition.year,
      month: partition.month,
    };
    const read = await this.fs.readFile(partition.path);
    if (!read.ok) {
      // A listed-but-unreadable note still earns a (degraded) row.
      this.logger.warn("Could not read evidence note for run history", {
        path: partition.path,
        reason: read.error.message,
      });
      return base;
    }
    const frontmatter = parseFrontmatter(read.value);
    return {
      ...base,
      status: str(frontmatter.status),
      passed: num(frontmatter.passed),
      failed: num(frontmatter.failed),
      skipped: num(frontmatter.skipped),
      total: num(frontmatter.total),
      createdAt: str(frontmatter.created_at),
      scope: str(frontmatter.scope),
      target: str(frontmatter.target),
    };
  }
}

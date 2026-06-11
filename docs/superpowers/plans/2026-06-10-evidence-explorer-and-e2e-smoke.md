# Evidence Explorer & E2E CI Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a main-area Evidence Explorer view that browses the full `Test Evidence/YYYY/MM/<runId>/summary.md` run history, and an opt-in GitHub Actions smoke workflow that installs the real generated `.testrunner` and runs the demo test end-to-end on Ubuntu + Windows.

**Architecture:** A new `RunHistoryService` (application layer) scans the ADR-0016 evidence partitions via the existing `VaultFileSystem` port — newest-first ordering is lexicographic on the partition path, frontmatter is read only for the displayed page. A pure `evidence-explorer-rows` projection feeds a thin `EvidenceExplorerView` (`ItemView`), wired in `main.ts` like the existing explorers. The smoke test is a standalone Node script that esbuild-bundles the real `buildRunnerTemplates` + demo content from `src/`, scaffolds a temp fake vault, runs `npm install` + the templates' own `test:ci` script, and asserts on the cucumber JSON report. A separate workflow triggers it on `workflow_dispatch` or the `e2e-smoke` PR label.

**Tech Stack:** TypeScript (strict), Obsidian plugin API, Vitest, esbuild, GitHub Actions, Cucumber/Playwright (inside the generated runner).

**Spec:** `docs/superpowers/specs/2026-06-10-evidence-explorer-and-e2e-smoke-design.md`

**Conventions you must follow (this codebase):**
- Fallible operations return `Result<T>` (`ok()`/`err()` from `src/shared/result/result.ts`), never throw.
- Errors are `appError(code, message, { details?, cause? })` with a code from the `ErrorCode` union in `src/shared/errors/errors.ts`.
- Views are thin: pure projection modules (`*-rows.ts`) hold the testable logic; views only paint and dispatch to `deps` callbacks. Views are NOT unit-tested; rows and services are.
- Run `npm run lint && npm run format:check && npm run typecheck && npm test` before every commit. Use `npm run format` to fix formatting.
- Comments explain constraints/why, not what. Match the existing density.

---

### Task 1: Record run scope/target in evidence frontmatter

The explorer shows each run's scope (`all`/`suite`/`use-case`/`feature`/`demo`) and target (suite name, UC id, …). Today `renderNote` only sees `evidence` + `report`; thread the `run` through and emit two new frontmatter fields.

**Files:**
- Modify: `src/application/services/evidence-generation-service.ts` (renderNote at ~line 303, call site at ~line 96)
- Test: `tests/evidence-generation-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/evidence-generation-service.test.ts`, inside the existing `describe` block that exercises `generate` (the file already defines `build()`, `run()`, `report()`, `seedUseCase()`, `EVIDENCE_PATH`):

```ts
it("records the run scope and target in evidence frontmatter", async () => {
  const { service, fs } = build();
  seedUseCase(fs);

  const result = await service.generate({
    run: run({ scope: "suite", target: "smoke" }),
    report: report(),
  });

  expect(result.ok).toBe(true);
  const frontmatter = parseFrontmatter(fs.files.get(EVIDENCE_PATH) ?? "");
  expect(frontmatter.scope).toBe("suite");
  expect(frontmatter.target).toBe("smoke");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/evidence-generation-service.test.ts -t "records the run scope"`
Expected: FAIL — `frontmatter.scope` is `undefined`.

- [ ] **Step 3: Implement**

In `src/application/services/evidence-generation-service.ts`:

(a) Change the `renderNote` call in `generate()` (~line 96) to pass the run:

```ts
      const written = await this.fs.writeFile(
        evidencePath,
        this.renderNote(evidence, report, ucNoteNames, noteStatus, run),
      );
```

(b) Extend `renderNote` — add the parameter and the two fields after `total`:

```ts
  /** Renders the evidence note (frontmatter TIS §10.3, body ADR-0005). */
  private renderNote(
    evidence: Evidence,
    report: ImportedReport,
    ucNoteNames: Map<UseCaseId, string>,
    noteStatus: TestRunStatus | "skipped",
    run: TestRun,
  ): string {
    const { result } = evidence;
    const screenshots = evidence.artifacts.filter((a) => a.type === "screenshot");
    const traces = evidence.artifacts.filter((a) => a.type === "trace");

    return buildNote(
      {
        type: "test-evidence",
        id: evidence.id,
        run_id: evidence.runId,
        status: noteStatus,
        created_at: evidence.createdAt,
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        total: result.total,
        // Scope + target let the Evidence Explorer say WHAT each historical run
        // covered without re-deriving it from linked Use Cases.
        scope: run.scope,
        target: run.target,
        linked_use_cases: evidence.linkedUseCases.length > 0 ? evidence.linkedUseCases : undefined,
        screenshots: screenshots.length > 0 ? screenshots.map((a) => a.path) : undefined,
        traces: traces.length > 0 ? traces.map((a) => a.path) : undefined,
      },
      this.renderBody(evidence, report, ucNoteNames, noteStatus),
    );
  }
```

- [ ] **Step 4: Run the full evidence test file**

Run: `npx vitest run tests/evidence-generation-service.test.ts`
Expected: ALL PASS (existing snapshot-ish assertions don't pin the full frontmatter, but if any other test asserts exact note content, update it to include the two new lines `scope: …` / `target: …`).

- [ ] **Step 5: Commit**

```bash
git add src/application/services/evidence-generation-service.ts tests/evidence-generation-service.test.ts
git commit -m "feat(evidence): record run scope and target in evidence frontmatter"
```

---

### Task 2: RunHistoryService — scan evidence partitions

**Files:**
- Create: `src/application/services/run-history-service.ts`
- Modify: `src/shared/errors/errors.ts:23` (add one error code)
- Test: `tests/run-history-service.test.ts` (new)

- [ ] **Step 1: Add the error code**

In `src/shared/errors/errors.ts`, in the `// report / evidence` group after `"EVIDENCE_WRITE_FAILED"`:

```ts
  | "EVIDENCE_LIST_FAILED"
```

(Adding a code is non-breaking per the file's header comment.)

- [ ] **Step 2: Write the failing tests**

Create `tests/run-history-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DefaultRunHistoryService,
  type RunHistoryEntry,
} from "../src/application/services/run-history-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { buildNote } from "../src/shared/utils/frontmatter";
import { err } from "../src/shared/result/result";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const ROOT = "Test Evidence";

const evidenceNote = (overrides: Record<string, string | number> = {}): string =>
  buildNote(
    {
      type: "test-evidence",
      id: "EV-X",
      run_id: "RUN-X",
      status: "passed",
      created_at: "2026-05-31T10:05:00.000Z",
      passed: 2,
      failed: 1,
      skipped: 0,
      total: 3,
      scope: "suite",
      target: "smoke",
      ...overrides,
    },
    "# Evidence\n",
  );

const seed = (fs: FakeVaultFileSystem, partition: string, content = evidenceNote()): void => {
  fs.folders.add(vp(ROOT));
  fs.files.set(vp(`${ROOT}/${partition}/summary.md`), content);
};

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultRunHistoryService(settings, fs, silentLogger);
  return { service, fs };
};

describe("DefaultRunHistoryService", () => {
  it("lists runs newest-first across year/month partitions without reading order from frontmatter", async () => {
    const { service, fs } = build();
    seed(fs, "2025/12/RUN-2025-12-01-090000");
    seed(fs, "2026/05/RUN-2026-05-31-100000");
    seed(fs, "2026/05/RUN-2026-05-30-080000");
    seed(fs, "2026/01/RUN-2026-01-15-120000");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries.map((e: RunHistoryEntry) => e.runId)).toEqual([
      "RUN-2026-05-31-100000",
      "RUN-2026-05-30-080000",
      "RUN-2026-01-15-120000",
      "RUN-2025-12-01-090000",
    ]);
    expect(result.value.hasMore).toBe(false);
  });

  it("maps frontmatter onto the entry, including the partition-derived year/month", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]).toEqual({
      runId: "RUN-2026-05-31-100000",
      evidencePath: "Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md",
      year: "2026",
      month: "05",
      status: "passed",
      passed: 2,
      failed: 1,
      skipped: 0,
      total: 3,
      createdAt: "2026-05-31T10:05:00.000Z",
      scope: "suite",
      target: "smoke",
    });
  });

  it("pages with offset/limit and reports hasMore", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-29-080000");
    seed(fs, "2026/05/RUN-2026-05-30-080000");
    seed(fs, "2026/05/RUN-2026-05-31-080000");

    const first = await service.list({ offset: 0, limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.entries.map((e) => e.runId)).toEqual([
      "RUN-2026-05-31-080000",
      "RUN-2026-05-30-080000",
    ]);
    expect(first.value.hasMore).toBe(true);

    const second = await service.list({ offset: 2, limit: 2 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.entries.map((e) => e.runId)).toEqual(["RUN-2026-05-29-080000"]);
    expect(second.value.hasMore).toBe(false);
  });

  it("ignores files in the evidence tree that are not partition summaries", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000");
    fs.files.set(vp(`${ROOT}/README.md`), "# notes");
    fs.files.set(vp(`${ROOT}/2026/05/RUN-2026-05-31-100000/screenshot.png`), "binary");
    fs.files.set(vp(`${ROOT}/2026/notes.md`), "stray");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries).toHaveLength(1);
  });

  it("returns an empty page when the evidence root does not exist (fresh vault)", async () => {
    const { service } = build();

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ entries: [], hasMore: false });
  });

  it("degrades an unreadable note to a path-only entry instead of failing the page", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000");
    fs.readFile = async () =>
      err({ code: "RUNNER_MISSING_FILE", message: "io error" });

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]).toEqual({
      runId: "RUN-2026-05-31-100000",
      evidencePath: "Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md",
      year: "2026",
      month: "05",
    });
  });

  it("treats a note without parsable frontmatter as a degraded entry", async () => {
    const { service, fs } = build();
    seed(fs, "2026/05/RUN-2026-05-31-100000", "no frontmatter here");

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0].status).toBeUndefined();
    expect(result.value.entries[0].runId).toBe("RUN-2026-05-31-100000");
  });

  it("surfaces a listing failure as EVIDENCE_LIST_FAILED", async () => {
    const { service, fs } = build();
    fs.folders.add(vp(ROOT));
    fs.listFilesRecursive = async () =>
      err({ code: "RUNNER_MISSING_FILE", message: "io error" });

    const result = await service.list({ offset: 0, limit: 50 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EVIDENCE_LIST_FAILED");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/run-history-service.test.ts`
Expected: FAIL — module `run-history-service` does not exist.

- [ ] **Step 4: Implement the service**

Create `src/application/services/run-history-service.ts`:

```ts
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
    const settings = await this.settingsService.load();
    const root = settings.paths.evidencePath;
    // A fresh vault has no evidence folder yet — that is "no history", not an error.
    if (!(await this.fs.exists(root))) return ok({ entries: [], hasMore: false });

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

    const page = partitions.slice(options.offset, options.offset + options.limit);
    const entries: RunHistoryEntry[] = [];
    for (const partition of page) entries.push(await this.toEntry(partition));
    return ok({ entries, hasMore: options.offset + options.limit < partitions.length });
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
```

Note on the second test's `toEqual`: entries with only the four base fields omit the optional keys, and `toEqual` treats `undefined` properties as absent — the exact-object assertions above are valid.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/run-history-service.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/application/services/run-history-service.ts src/shared/errors/errors.ts tests/run-history-service.test.ts
git commit -m "feat(evidence): RunHistoryService scans evidence partitions for run history"
```

---

### Task 3: Pure row projection for the Evidence Explorer

**Files:**
- Create: `src/presentation/views/evidence-explorer-rows.ts`
- Test: `tests/evidence-explorer-rows.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/evidence-explorer-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RunHistoryEntry } from "../src/application/services/run-history-service";
import {
  projectEvidenceGroups,
  projectEvidenceRow,
} from "../src/presentation/views/evidence-explorer-rows";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const entry = (overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry => ({
  runId: "RUN-2026-05-31-100000",
  evidencePath: vp("Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md"),
  year: "2026",
  month: "05",
  status: "passed",
  passed: 2,
  failed: 1,
  skipped: 0,
  total: 3,
  createdAt: "2026-05-31T10:05:00.000Z",
  scope: "suite",
  target: "smoke",
  ...overrides,
});

describe("projectEvidenceRow", () => {
  it("projects a full entry", () => {
    expect(projectEvidenceRow(entry())).toEqual({
      runId: "RUN-2026-05-31-100000",
      status: "passed",
      passed: "2",
      failed: "1",
      total: "3",
      scope: "suite: smoke",
      date: "2026-05-31 10:05",
      evidencePath: "Test Evidence/2026/05/RUN-2026-05-31-100000/summary.md",
      ariaLabel: "Open evidence for RUN-2026-05-31-100000 (passed)",
    });
  });

  it("renders a degraded (path-only) entry with placeholders and status unknown", () => {
    const degraded = projectEvidenceRow(
      entry({
        status: undefined,
        passed: undefined,
        failed: undefined,
        skipped: undefined,
        total: undefined,
        createdAt: undefined,
        scope: undefined,
        target: undefined,
      }),
    );
    expect(degraded.status).toBe("unknown");
    expect(degraded.passed).toBe("—");
    expect(degraded.scope).toBe("—");
    expect(degraded.date).toBe("—");
    expect(degraded.ariaLabel).toBe("Open evidence for RUN-2026-05-31-100000 (unknown)");
  });

  it("does not repeat the target when it equals the scope (demo runs)", () => {
    expect(projectEvidenceRow(entry({ scope: "demo", target: "demo" })).scope).toBe("demo");
  });
});

describe("projectEvidenceGroups", () => {
  it("groups consecutive entries by month, newest order preserved", () => {
    const groups = projectEvidenceGroups(
      [
        entry({ runId: "RUN-B", year: "2026", month: "05" }),
        entry({ runId: "RUN-A", year: "2026", month: "05" }),
        entry({ runId: "RUN-OLD", year: "2025", month: "12" }),
      ],
      "all",
    );
    expect(groups.map((g) => g.heading)).toEqual(["2026 / 05", "2025 / 12"]);
    expect(groups[0].rows.map((r) => r.runId)).toEqual(["RUN-B", "RUN-A"]);
  });

  it("filters loaded entries by status and drops empty groups", () => {
    const groups = projectEvidenceGroups(
      [
        entry({ runId: "RUN-B", status: "failed" }),
        entry({ runId: "RUN-A", status: "passed" }),
        entry({ runId: "RUN-OLD", year: "2025", month: "12", status: "passed" }),
      ],
      "failed",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.runId)).toEqual(["RUN-B"]);
  });

  it('the "unknown" pseudo-status of degraded entries only matches the all filter', () => {
    const degraded = entry({ status: undefined });
    expect(projectEvidenceGroups([degraded], "all")).toHaveLength(1);
    expect(projectEvidenceGroups([degraded], "passed")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/evidence-explorer-rows.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the projection**

Create `src/presentation/views/evidence-explorer-rows.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/evidence-explorer-rows.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/evidence-explorer-rows.ts tests/evidence-explorer-rows.test.ts
git commit -m "feat(evidence): pure row projection for the Evidence Explorer"
```

---

### Task 4: EvidenceExplorerView

Views in this codebase are thin and not unit-tested (the logic lives in Task 3's rows module); this task is implementation + typecheck only.

**Files:**
- Create: `src/presentation/views/evidence-explorer-view.ts`

- [ ] **Step 1: Implement the view**

Create `src/presentation/views/evidence-explorer-view.ts`:

```ts
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { RunHistoryService } from "../../application/services/run-history-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import {
  EVIDENCE_PAGE_SIZE,
  EVIDENCE_STATUS_FILTERS,
  projectEvidenceGroups,
  type EvidenceMonthGroup,
  type EvidenceStatusFilter,
} from "./evidence-explorer-rows";
import { RenderScheduler } from "./render-scheduler";

export const EVIDENCE_EXPLORER_VIEW_TYPE = "e2e-test-hub-evidence";

/**
 * Callbacks/services the explorer drives. `openEvidence` is the same callback
 * the dashboard's recent-run rows use, wired in main.ts — the view never opens
 * files itself.
 */
export interface EvidenceExplorerViewDeps {
  runHistory: RunHistoryService;
  eventBus: EventBus;
  openEvidence: (path: VaultPath) => void | Promise<void>;
}

/**
 * Main-area Evidence Explorer (EPIC-008): browses the FULL partitioned run
 * history (`Test Evidence/YYYY/MM/<runId>/summary.md`), unlike the dashboard's
 * Recent Runs which shows only the latest run per Use Case. Month-grouped,
 * status-filterable, paged via "Load older"; every row opens its evidence note.
 */
export class EvidenceExplorerView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly scheduler = new RenderScheduler(() => this.render());
  // Each render re-reads history fresh (same pattern as the other explorers);
  // visibleLimit only remembers how far "Load older" has extended the page.
  private visibleLimit = EVIDENCE_PAGE_SIZE;
  private filter: EvidenceStatusFilter = "all";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: EvidenceExplorerViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return EVIDENCE_EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Evidence Explorer";
  }

  getIcon(): string {
    return "history";
  }

  async onOpen(): Promise<void> {
    this.subscriptions.push(
      this.deps.eventBus.subscribe("evidence.generated", () => this.scheduler.schedule()),
    );
    await this.scheduler.schedule();
  }

  async onClose(): Promise<void> {
    // Unsubscribe BEFORE disposing the scheduler so a handler firing
    // mid-teardown can't schedule() on a disposed scheduler (PRES-M1 ordering).
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Evidence Explorer" });

    const result = await this.deps.runHistory.list({ offset: 0, limit: this.visibleLimit });
    if (!result.ok) {
      container.createEl("p", { text: `Could not load run history: ${result.error.message}` });
      return;
    }
    const { entries, hasMore } = result.value;
    // entries is the page from offset 0, so empty means no history at all.
    if (entries.length === 0) {
      container.createEl("p", { text: "No Test Runs yet. Run a Test Suite to see results here." });
      return;
    }

    this.renderFilter(container);

    const groups = projectEvidenceGroups(entries, this.filter);
    if (groups.length === 0) {
      container.createEl("p", {
        text: `No loaded runs with status "${this.filter}". Load older runs or change the filter.`,
      });
    }
    for (const group of groups) this.renderGroup(container, group);

    if (hasMore) {
      const button = container.createEl("button", {
        text: "Load older runs",
        cls: "e2e-test-hub-load-older",
        attr: { "aria-label": "Load older runs" },
      });
      button.addEventListener("click", () => {
        this.visibleLimit += EVIDENCE_PAGE_SIZE;
        void this.scheduler.schedule();
      });
    }
  }

  private renderFilter(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "e2e-test-hub-evidence-toolbar" });
    bar.createEl("label", { text: "Status: ", attr: { for: "e2e-test-hub-evidence-filter" } });
    const select = bar.createEl("select", {
      attr: { id: "e2e-test-hub-evidence-filter", "aria-label": "Filter runs by status" },
    });
    for (const option of EVIDENCE_STATUS_FILTERS) {
      select.createEl("option", { text: option === "all" ? "All" : option, value: option });
    }
    select.value = this.filter;
    select.addEventListener("change", () => {
      // The value space is exactly EVIDENCE_STATUS_FILTERS (options above).
      this.filter = select.value as EvidenceStatusFilter;
      void this.scheduler.schedule();
    });
  }

  private renderGroup(container: HTMLElement, group: EvidenceMonthGroup): void {
    container.createEl("h3", { text: group.heading });
    const table = container.createEl("table", { cls: "e2e-test-hub-runs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["Run", "Status", "Passed", "Failed", "Total", "Scope", "Date"]) {
      headRow.createEl("th", { text: label, attr: { scope: "col" } });
    }
    const body = table.createEl("tbody");
    for (const row of group.rows) {
      const tr = body.createEl("tr", {
        cls: "e2e-test-hub-run-row is-navigable",
        attr: { "aria-label": row.ariaLabel, role: "link", tabindex: "0" },
      });
      tr.createEl("td", { text: row.runId });
      // data-status + visible text mirrors the dashboard's colour-blind-safe
      // status cells (styles.css tints on data-status, the label always stays).
      tr.createEl("td", {
        text: row.status,
        cls: "e2e-test-hub-run-status",
        attr: { "data-status": row.status },
      });
      tr.createEl("td", { text: row.passed });
      tr.createEl("td", { text: row.failed });
      tr.createEl("td", { text: row.total });
      tr.createEl("td", { text: row.scope });
      tr.createEl("td", { text: row.date });
      const open = (): void => {
        void this.deps.openEvidence(row.evidencePath);
      };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    }
  }
}
```

Note: if `select.createEl("option", { …, value: option })` does not typecheck against Obsidian's `DomElementInfo` (the `value` shorthand exists, but verify), use `attr: { value: option }` instead.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/views/evidence-explorer-view.ts
git commit -m "feat(evidence): Evidence Explorer view over the partitioned run history"
```

---

### Task 5: Wire the explorer (main.ts, command, ribbon, dashboard link, styles)

**Files:**
- Modify: `src/main.ts` (field declarations ~line 107–129, service construction near `this.traceabilityService` ~line 323, view registrations ~line 348–453, ribbons ~line 467, dashboard deps ~line 428)
- Modify: `src/presentation/views/dashboard-view.ts` (deps interface ~line 58, render ~line 233)
- Modify: `src/presentation/commands/register-commands.ts` (after the `open-test-suites` command ~line 375)
- Modify: `styles.css`

- [ ] **Step 1: Construct the service and register the view in `main.ts`**

(a) Imports:

```ts
import {
  DefaultRunHistoryService,
  type RunHistoryService,
} from "./application/services/run-history-service";
import {
  EVIDENCE_EXPLORER_VIEW_TYPE,
  EvidenceExplorerView,
} from "./presentation/views/evidence-explorer-view";
```

(b) Field declaration next to the other services (~line 129):

```ts
  private runHistoryService!: RunHistoryService;
```

(c) Construction — directly after the `this.traceabilityService = …` assignment (~line 323; `vault` is the `ObsidianVaultAdapter` local from line 151):

```ts
    this.runHistoryService = new DefaultRunHistoryService(
      this.hubSettingsService,
      vault,
      this.logger,
    );
```

(d) View registration — after the `DASHBOARD_VIEW_TYPE` registration block (~line 453):

```ts
    this.registerView(
      EVIDENCE_EXPLORER_VIEW_TYPE,
      (leaf) =>
        new EvidenceExplorerView(leaf, {
          runHistory: this.runHistoryService,
          eventBus,
          openEvidence: (path) => this.openEvidenceNote(path),
        }),
    );
```

(e) Ribbon icon — after the dashboard ribbon (~line 487):

```ts
    this.addRibbonIcon(
      "history",
      "Open Evidence Explorer",
      () => void this.workspaceAdapter.openView(EVIDENCE_EXPLORER_VIEW_TYPE),
    );
```

(f) Dashboard dep — inside the `new DashboardView(leaf, { … })` deps object:

```ts
          openEvidenceExplorer: () =>
            void this.workspaceAdapter.openView(EVIDENCE_EXPLORER_VIEW_TYPE),
```

- [ ] **Step 2: Dashboard "View all runs" link**

In `src/presentation/views/dashboard-view.ts`:

(a) Add to `DashboardViewDeps` (after `openEvidence`):

```ts
  // EPIC-008: the Recent Runs header links into the full history explorer
  // (Recent Runs shows only the latest run per Use Case).
  openEvidenceExplorer: () => void | Promise<void>;
```

(b) In `render()`, immediately after `container.createEl("h3", { text: "Recent Runs" });`:

```ts
    container
      .createEl("button", {
        text: "View all runs",
        cls: "e2e-test-hub-doc-button",
        attr: { "aria-label": "Open the Evidence Explorer with the full run history" },
      })
      .addEventListener("click", () => {
        void this.deps.openEvidenceExplorer();
      });
```

- [ ] **Step 3: Command palette entry**

In `src/presentation/commands/register-commands.ts`, import the view type alongside the other `*_VIEW_TYPE` imports:

```ts
import { EVIDENCE_EXPLORER_VIEW_TYPE } from "../views/evidence-explorer-view";
```

and add after the `open-test-suites` command (~line 375):

```ts
  plugin.addCommand({
    id: "open-evidence-explorer",
    name: "Open Evidence Explorer",
    callback: () => void deps.workspace.openView(EVIDENCE_EXPLORER_VIEW_TYPE),
  });
```

- [ ] **Step 4: Minimal styles**

Append to `styles.css` (the tables/status cells reuse the existing `e2e-test-hub-runs-table` / `e2e-test-hub-run-status` rules):

```css
/* Evidence Explorer (EPIC-008) */
.e2e-test-hub-evidence-toolbar {
  margin: var(--size-4-2) 0;
}
.e2e-test-hub-load-older {
  margin-top: var(--size-4-3);
}
```

(If `styles.css` does not use `--size-*` variables elsewhere, match whatever spacing idiom it does use.)

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: all clean/green. The build catching a missed import or a wrong dep name is the point of this step.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/presentation/views/dashboard-view.ts src/presentation/commands/register-commands.ts styles.css
git commit -m "feat(evidence): wire Evidence Explorer (view, ribbon, command, dashboard link)"
```

---

### Task 6: E2E smoke script

**Files:**
- Create: `scripts/e2e-smoke-entry.ts`
- Create: `scripts/e2e-smoke.mjs`

No vitest here — the script is the test (it runs in the smoke workflow). Locally verify it executes end-to-end once (it downloads Chromium; allow a few minutes).

- [ ] **Step 1: Create the bundle entry**

Create `scripts/e2e-smoke-entry.ts`:

```ts
/**
 * Bundle entry for scripts/e2e-smoke.mjs: re-exports the REAL template builder
 * + demo content from src/, so the smoke run exercises exactly what the plugin
 * ships (no copies to drift). esbuild bundles this on the fly; it is never
 * part of the plugin build.
 */
export {
  DEMO_FEATURE_CONTENT,
  DEMO_FEATURE_FILE_NAME,
} from "../src/application/content/demo-content";
export { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
export { buildRunnerTemplates } from "../src/infrastructure/runner/templates/runner-templates";
```

- [ ] **Step 2: Create the smoke script**

Create `scripts/e2e-smoke.mjs`:

```js
#!/usr/bin/env node
/**
 * Opt-in E2E smoke test (run by .github/workflows/e2e-smoke.yml, or locally):
 * proves a `.testrunner` generated from the ACTUAL templates installs and the
 * demo test passes on a real OS — the class of failure unit tests can't catch
 * (npm.cmd quoting, cucumber config wiring, playwright install).
 *
 * Flow: bundle src/ exports → scaffold a temp fake vault (templates +
 * demo feature) → npm install → playwright install → npm run test:ci →
 * assert on the cucumber JSON report, not just the exit code (a silently
 * empty run must fail).
 */

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fail = (message) => {
  console.error(`\nE2E smoke FAILED: ${message}`);
  process.exit(1);
};

const run = (command, cwd) => {
  console.log(`\n$ ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
};

const vaultRoot = mkdtempSync(join(tmpdir(), "e2e-smoke-vault-"));
console.log(`Fake vault: ${vaultRoot}`);

try {
  // 1. Bundle the real template builder + demo content out of src/.
  const entryBundle = join(vaultRoot, "smoke-entry.mjs");
  await build({
    entryPoints: [join(ROOT, "scripts", "e2e-smoke-entry.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: entryBundle,
    logLevel: "silent",
    // The plugin API must never be reachable from the template/domain modules;
    // if it ever is, the dynamic import below fails loudly.
    external: ["obsidian"],
  });
  const { buildRunnerTemplates, DEFAULT_SETTINGS, DEMO_FEATURE_CONTENT, DEMO_FEATURE_FILE_NAME } =
    await import(pathToFileURL(entryBundle).href);

  // 2. Scaffold the fake vault: runner templates + the demo feature in the
  //    folder the runner's cucumber.mjs feature glob points at.
  const runnerRoot = join(vaultRoot, DEFAULT_SETTINGS.paths.testRunnerPath);
  for (const file of buildRunnerTemplates(DEFAULT_SETTINGS)) {
    const target = join(runnerRoot, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
  const featureDir = join(vaultRoot, DEFAULT_SETTINGS.paths.featureFilesPath);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, DEMO_FEATURE_FILE_NAME), DEMO_FEATURE_CONTENT, "utf8");

  // 3. Install + run, using only the templates' own package scripts so the
  //    smoke run cannot drift from what the plugin generates.
  run("npm install", runnerRoot);
  run("npm run install:browsers:ci", runnerRoot);
  run("npm run test:ci", runnerRoot);

  // 4. Assert on the report, not just the exit code.
  const reportPath = join(runnerRoot, "reports", "cucumber-report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const scenarios = report.flatMap((feature) =>
    (feature.elements ?? []).filter((element) => element.type === "scenario"),
  );
  if (scenarios.length === 0) fail("the run produced an empty report (no scenarios executed)");
  if (!report.some((feature) => (feature.uri ?? "").includes("UC-001-open-example-page"))) {
    fail("the demo feature is missing from the report");
  }
  const failingSteps = scenarios
    .flatMap((scenario) => scenario.steps ?? [])
    .filter((step) => step.result?.status !== "passed");
  if (failingSteps.length > 0) {
    fail(
      `${failingSteps.length} step(s) did not pass: ` +
        failingSteps.map((step) => `${step.name ?? "(hook)"} → ${step.result?.status}`).join(", "),
    );
  }
  console.log(`\nE2E smoke PASSED: ${scenarios.length} scenario(s), all steps passed.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  // Best-effort: the temp vault is large (node_modules); don't leave it behind.
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* the CI runner is ephemeral anyway */
  }
}
```

- [ ] **Step 3: Run it locally end-to-end**

Run: `node scripts/e2e-smoke.mjs`
Expected: prints the scaffold/install/test steps and ends with `E2E smoke PASSED: 1 scenario(s), all steps passed.` (exit code 0). This downloads Chromium — allow several minutes. If the sandbox/network blocks `npm install` or the browser download, note that in the task report and rely on the workflow run for end-to-end verification — but the bundle + scaffold portion must be seen working (it runs before any network use; you can temporarily comment the three `run(...)` lines to verify scaffolding, then restore them).

- [ ] **Step 4: Lint/format**

Run: `npm run lint && npm run format`
(`prettier --write` covers the two new files; re-run `npm run format:check` after.)
Note: `scripts/e2e-smoke-entry.ts` is bundled by esbuild, not compiled by `tsc` (`tsconfig.json` does not include `scripts/`) — that is fine and matches `scripts/test-build.mjs` precedent. If eslint complains about the `.ts` file being outside the TS project, add it to the eslint ignore the same way other scripts are handled (check `eslint.config.*` for how `scripts/` is treated).

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e-smoke-entry.ts scripts/e2e-smoke.mjs
git commit -m "feat(ci): standalone E2E smoke script over the real runner templates"
```

---

### Task 7: Smoke workflow

**Files:**
- Create: `.github/workflows/e2e-smoke.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/e2e-smoke.yml`:

```yaml
# Opt-in E2E smoke: installs the generated .testrunner for real and runs the
# demo test (scripts/e2e-smoke.mjs). Heavier than CI (npm install + Chromium
# download per OS), so it only runs on demand: manual dispatch or the
# `e2e-smoke` label on a PR.
name: E2E Smoke

on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize, reopened, labeled]

permissions:
  contents: read

jobs:
  smoke:
    if: github.event_name == 'workflow_dispatch' || contains(github.event.pull_request.labels.*.name, 'e2e-smoke')
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        # Windows is in scope: both recent runner regressions (npm.cmd quoting,
        # install paths) were Windows-specific.
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install plugin dependencies
        run: npm ci

      - name: Run E2E smoke
        run: node scripts/e2e-smoke.mjs
```

- [ ] **Step 2: Verify the repo test suite still passes**

Run: `npm test`
Expected: green (`tests/ci-workflow-content.test.ts` exercises the generated pipeline yaml, not this repo's workflows, so adding a workflow file is safe — this run confirms it).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-smoke.yml
git commit -m "feat(ci): opt-in E2E smoke workflow (dispatch or e2e-smoke label, ubuntu+windows)"
```

---

### Task 8: Final verification and push

- [ ] **Step 1: Full local gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage`
Expected: everything green, coverage thresholds met (the new service + rows modules have dedicated tests; the view is excluded from expectations like the other views — if coverage thresholds fail on the new view file, check how `vitest.config`/coverage excludes treat the existing `*-view.ts` files and align).

- [ ] **Step 2: Push and open a PR**

```bash
git push -u origin claude/repo-review-improvement-fa7b5s
```

Then create a ready-for-review PR for the branch (title: "Evidence Explorer and opt-in E2E CI smoke test"), with a body summarizing: the new view + service + frontmatter fields, the smoke script/workflow and how to trigger it (`e2e-smoke` label or manual dispatch), and a link to the design spec. Apply the `e2e-smoke` label (or trigger `workflow_dispatch` on the branch) so the smoke workflow validates itself on both OSes, and babysit it to green.

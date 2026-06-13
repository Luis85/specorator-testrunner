# Pre-V2 Phase 2 — Foundations the V2 Epics Assume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three code foundations of proposal §9 Phase 2 that the V2 epics build on — a `ReportParser` port (2.3), a `schemaVersion` envelope on `data.json` (2.1, scoped), and a version stamp on the generated `.testrunner` manifest (2.2, scoped) — without the heavy migration machinery the pre-announcement beta does not yet owe.

**Architecture:** Three independent, in-place additions. (2.3) Extract the cucumber-JSON parsing already living inside `DefaultReportImportService` behind a `ReportParser` port whose first implementation wraps it, so the service keeps the I/O + events and a future Cucumber Messages parser slots in beside it (ADR-0021/0022, opens EPIC-019). (2.1) Persist `data.json` as a `{ schemaVersion, ...settings }` envelope; on a present-but-mismatched version, reset to defaults with a logged report (beta: no migration). (2.2) Generate a tiny `.testrunner` manifest file carrying a version constant; validation reads it and flags an outdated/missing runner for repair — the detection rail Phase 3's playwright-bdd migration needs.

**Tech Stack:** TypeScript (strict), Vitest, Obsidian plugin API, fallow (blocking CI quality gate, coverage-fed), ESLint 10.

**Item 2.4 (the five V2 ADRs) is already delivered** in this session: `docs/adr/0021`–`0025` are authored and accepted, CONTEXT.md's *Scenario Reference* term is synced (commit `f05e181`), and the design spec is `docs/superpowers/specs/2026-06-13-v2-foundational-adrs-design.md`. Task 6 only cross-links and marks the proposal item done.

**Decisions locked in by this plan** (from the design spec; flag in review if any should change):

1. **`schemaVersion` is a persistence-envelope key, not a `TestHubSettings` field.** It lives in the saved `data.json` blob alongside the settings fields, handled entirely in `SettingsService.load`/`save`. The domain `TestHubSettings` type stays clean (it is the user-facing settings shape, not metadata).
2. **A present blob whose *effective* version differs from the code resets; first run is silent.** Absent `data.json` (`raw === undefined`) → defaults, no log (normal first run). For a present blob the **effective version** is its `schemaVersion` if numeric, else **1** (a pre-versioning V1 blob is treated as the version this envelope shipped at — *not* as "forever current"). Effective version **differs** from the code → reset to defaults **and** `logger.error` (beta break, no migration); effective version **matches** → merge + sanitize as today. So at v1 an unversioned blob still merges (keeping the existing unversioned fixtures valid), but when `DATA_SCHEMA_VERSION` is later bumped for an incompatible change those unversioned blobs correctly reset rather than merge as if current. (Both points raised by the codex review on PR #38.)
3. **`DATA_SCHEMA_VERSION = 1` and `TESTRUNNER_MANIFEST_VERSION = 1`.** The first stamped versions. For `data.json`, an *absent* version is treated as the envelope's introduction version (1, per Decision 2): merged while the code is at v1, reset once the code bumps past 1. For the `.testrunner` **manifest**, an absent/older/newer version means a version-mismatched runner → a Repair signal (Task 5); the manifest has no additive-merge story, so any non-equal version there is treated as outdated.
4. **The manifest file is `.testrunner/testrunner-manifest.json`**, content `{ "manifestVersion": <n> }`, generated like every other managed file (`overwrite: true`). It is validation-relevant but **not** added to `VALIDATED_RUNNER_FILES` (whose absence hard-fails a run); a missing/old manifest is a *repair* signal, not a run-blocker.
5. **The `ReportParser` port owns `ScenarioResult` and a new `ParsedReport`;** `ImportedReport` becomes `ParsedReport & { runId }`. The parser is pure (string in, `Result<ParsedReport>` out); all filesystem I/O and event emission stay in `DefaultReportImportService`.

**Conventions that apply to every task:**

- All commands run from the repo root `/home/user/specorator-testrunner` on branch `claude/specorator-v2-phase2-foundations` (already created off `origin/main`; the design spec + ADRs are already committed there).
- After every task: `npm run lint && npm run typecheck && npm test && npm run format:check`, then `npm run test:coverage` followed by `npx fallow audit --base origin/main` — the audit **needs the coverage dump present** to score CRAP correctly (the Phase-1 CI lesson: run `test:coverage` before the audit, both locally and in CI), and the verdict must stay exit 0. Coverage thresholds 93/80/93/93 must hold.
- **Gate-scope caveat (`.fallowrc.jsonc`):** any edit pulls the edited file's pre-existing complexity into the blocking audit's scope. If the audit flags a finding in a file a task touched, fix it inside the task (decompose below cognitive 15) — never suppress, never re-demote a rule. `report-import-service.ts` and `settings-service.ts` are both large; watch them.
- CHANGELOG entries go under `## [Unreleased]`. Line numbers cited are pre-plan; anchor edits on quoted code, not numbers.

---

### Task 1: Define the `ReportParser` port (item 2.3)

**Files:**
- Create: `src/application/ports/report-parser.ts`
- Test: `tests/report-parser-port.test.ts`

The port owns the parse contract and the result shapes. No behaviour yet — this task just establishes the types the next two tasks depend on, so they compile independently.

- [ ] **Step 1: Write the port + types**

Create `src/application/ports/report-parser.ts`:

```ts
import type { EvidenceArtifact } from "../../domain/entities/evidence";
import type { TestRunResult } from "../../domain/entities/test-run";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/** One scenario's rolled-up outcome (display + UC-linking fields). */
export interface ScenarioResult {
  feature: string; // human-readable feature name (display)
  featureUri?: string; // feature file path (e.g. features/UC-001-x.feature) for UC linking
  scenario: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  errorMessage?: string;
}

/** A parsed run report: counts, per-scenario rows, and artifact REFERENCES. */
export interface ParsedReport {
  result: TestRunResult;
  scenarioResults: ScenarioResult[];
  artifacts: EvidenceArtifact[];
}

/** Context a parser needs to build vault-relative artifact references. */
export interface ReportParseContext {
  runId: RunId;
  runnerPath: VaultPath; // the .testrunner root this run spawned in
  reportVaultPath: VaultPath; // vault-relative path of the report file itself
}

/**
 * Parses a runner report's raw text into a {@link ParsedReport}. Pure: no
 * filesystem, no events — `DefaultReportImportService` owns the I/O and the
 * `report.imported` / `report.import.failed` emissions. The first
 * implementation parses cucumber-JSON (ADR-0021); a Cucumber Messages parser
 * (ADR-0022) and others (EPIC-019) slot in beside it without touching the
 * service.
 */
export interface ReportParser {
  /** Returns `REPORT_PARSE_FAILED` (typed err) on malformed input. */
  parse(rawContent: string, ctx: ReportParseContext): Result<ParsedReport>;
}
```

- [ ] **Step 2: Pin the contract with a type-level test**

Create `tests/report-parser-port.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ParsedReport, ReportParser } from "../src/application/ports/report-parser";

describe("ReportParser port", () => {
  it("a conforming parser satisfies the interface and returns the ParsedReport shape", () => {
    const stub: ReportParser = {
      parse: () => ({
        ok: true,
        value: { result: { passed: 0, failed: 0, skipped: 0, total: 0 }, scenarioResults: [], artifacts: [] },
      }),
    };
    const parsed = stub.parse("", {
      runId: "RUN-x" as never,
      runnerPath: "TestHub/.testrunner" as never,
      reportVaultPath: "TestHub/.testrunner/reports/cucumber-report.json" as never,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const report: ParsedReport = parsed.value;
    expect(report.result.total).toBe(0);
    expect(report.scenarioResults).toEqual([]);
    expect(report.artifacts).toEqual([]);
  });
});
```

- [ ] **Step 3: Verify it compiles and passes**

Run: `npm run typecheck && npx vitest run tests/report-parser-port.test.ts`
Expected: typecheck clean; 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add src/application/ports/report-parser.ts tests/report-parser-port.test.ts
git commit -m "feat: define the ReportParser port (pre-V2 2.3)"
```

---

### Task 2: `CucumberJsonReportParser` — move the parsing into the first implementation (item 2.3)

**Files:**
- Create: `src/application/services/cucumber-json-report-parser.ts`
- Modify: `src/application/services/report-import-service.ts` (remove the moved parsing internals)
- Test: `tests/cucumber-json-report-parser.test.ts`

Move the cucumber-JSON parsing — the `Cucumber*` interfaces, `isRecord`, `nsToMs`, `FAILURE_STATUSES`/`isFailure`, `scenarioStatus`, and the `toImportedReport` body — out of the service and into a pure `ReportParser`. The service (Task 3) will call it.

- [ ] **Step 1: Create the parser by relocating the existing logic**

Create `src/application/services/cucumber-json-report-parser.ts` containing: the `CucumberStep` / `CucumberAttachment` / `CucumberScenario` / `CucumberFeature` interfaces, `isRecord`, `nsToMs`, `FAILURE_STATUSES`, `isFailure`, `scenarioStatus`, and the attachment/artifact-collection helpers currently in `report-import-service.ts` (lines ~36–230). Wrap them in the class:

```ts
import type {
  ParsedReport,
  ReportParseContext,
  ReportParser,
  ScenarioResult,
} from "../ports/report-parser";
import type { EvidenceArtifact } from "../../domain/entities/evidence";
import type { TestRunResult } from "../../domain/entities/test-run";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

// ... (the relocated Cucumber* interfaces + helpers, unchanged) ...

/**
 * Parses the cucumber-JSON report (`reports/cucumber-report.json`, the `json:`
 * formatter) defensively into typed results and artifact REFERENCES (US-033/034
 * — links, never copies, ADR-0016). Every field is optional so a malformed or
 * partial report degrades to skipped rather than throwing. The first
 * ReportParser implementation (ADR-0021).
 */
export class CucumberJsonReportParser implements ReportParser {
  parse(rawContent: string, ctx: ReportParseContext): Result<ParsedReport> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Invalid JSON.";
      return err(appError("REPORT_PARSE_FAILED", reason, { cause }));
    }
    if (!Array.isArray(parsed)) {
      return err(
        appError("REPORT_PARSE_FAILED", "Report root is not a Cucumber feature array."),
      );
    }
    return ok(this.toParsedReport(parsed, ctx));
  }

  /** Maps the parsed feature array into a {@link ParsedReport}. */
  private toParsedReport(features: unknown[], ctx: ReportParseContext): ParsedReport {
    // ... the existing `toImportedReport` body, verbatim, except:
    //   - it takes `features` + `ctx` instead of (runId, features, runnerPath, reportVaultPath)
    //   - read `ctx.runnerPath` / `ctx.reportVaultPath` where the old code used those params
    //   - it returns { result, scenarioResults, artifacts } WITHOUT runId
    //     (runId is re-attached by the service)
  }
}
```

Keep every comment that explains a Cucumber quirk (background folding, hook-failure rollup, undefined-step-is-failure, no-double-count) attached to the logic it explains — these are correctness notes.

- [ ] **Step 2: Delete the moved internals from `report-import-service.ts`**

Remove from `report-import-service.ts`: the `Cucumber*` interfaces, `isRecord`, `nsToMs`, `FAILURE_STATUSES`, `isFailure`, `scenarioStatus`, the attachment helpers, and the `toImportedReport` method. Leave `ReportImportService`, `ImportedReport`, the `REPORT_FILE` constant, and the `DefaultReportImportService` class shell (its `import`/`fail` methods stay; Task 3 rewires `import`). Re-export the result types from the port so existing importers keep working:

```ts
export type { ScenarioResult } from "../ports/report-parser";
// ImportedReport now extends the port's ParsedReport:
import type { ParsedReport } from "../ports/report-parser";
export interface ImportedReport extends ParsedReport {
  runId: RunId;
}
```

(The service does not compile between this deletion and Task 3's rewiring of `import()` — that is fine because **Tasks 2 and 3 share one commit**, made at the end of Task 3. No broken state is ever committed, and the after-task gate runs once, there.)

- [ ] **Step 3: Write the parser unit tests**

Create `tests/cucumber-json-report-parser.test.ts`. Port the parsing assertions from the existing `tests/report-import-service.test.ts` corpus that exercise *parsing* (status rollup, background folding, hook failure, malformed JSON, non-array root, artifact references) to call the parser directly:

```ts
import { describe, expect, it } from "vitest";
import { CucumberJsonReportParser } from "../src/application/services/cucumber-json-report-parser";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const ctx = {
  runId: "RUN-1" as never,
  runnerPath: vp("TestHub/.testrunner"),
  reportVaultPath: vp("TestHub/.testrunner/reports/cucumber-report.json"),
};
const parse = (json: string) => new CucumberJsonReportParser().parse(json, ctx);

describe("CucumberJsonReportParser", () => {
  it("returns REPORT_PARSE_FAILED on invalid JSON", () => {
    const r = parse("{ not json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("REPORT_PARSE_FAILED");
  });

  it("returns REPORT_PARSE_FAILED when the root is not an array", () => {
    const r = parse('{"features":[]}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("REPORT_PARSE_FAILED");
  });

  it("rolls a passing scenario into passed counts and a report artifact", () => {
    const json = JSON.stringify([
      {
        name: "F",
        uri: "features/UC-001-x.feature",
        elements: [
          { name: "S", type: "scenario", steps: [{ result: { status: "passed", duration: 2_000_000 } }] },
        ],
      },
    ]);
    const r = parse(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.result).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 });
    expect(r.value.scenarioResults[0]).toMatchObject({ scenario: "S", status: "passed", durationMs: 2 });
    expect(r.value.artifacts[0]).toMatchObject({ type: "report", path: ctx.reportVaultPath });
  });

  it("marks a scenario failed when a Before hook failed", () => {
    const json = JSON.stringify([
      {
        name: "F",
        elements: [
          { name: "S", type: "scenario", before: [{ result: { status: "failed" } }], steps: [{ result: { status: "skipped" } }] },
        ],
      },
    ]);
    const r = parse(json);
    expect(r.ok && r.value.result.failed).toBe(1);
  });
});
```

(Add cases mirroring whatever background-folding / undefined-step / attachment assertions the existing service test pins, so parsing coverage moves with the code.)

- [ ] **Step 4: Run the parser tests**

Run: `npx vitest run tests/cucumber-json-report-parser.test.ts`
Expected: all pass. (`report-import-service.ts` still won't compile — fixed in Task 3; that is fine for running this isolated test file only if it doesn't import the service. It doesn't.)

- [ ] **Step 5: Do NOT commit yet — Tasks 2 and 3 are one atomic extraction**

The deletion in Step 2 leaves `report-import-service.ts` non-compiling until Task 3 rewires `import()`. To never commit a broken state — and to satisfy the after-every-task gate — Tasks 2 and 3 share a **single commit** made at the end of Task 3, where the full gate runs once. Proceed to Task 3 without committing or running the project-wide gate.

---

### Task 3: Wire `DefaultReportImportService` to the port, then commit the whole extraction (item 2.3)

**Files:**
- Modify: `src/application/services/report-import-service.ts` (constructor + `import()`)
- Modify: `src/main.ts` (composition root — inject the parser)
- Test: `tests/report-import-service.test.ts` (construction helper only)

The service keeps the I/O (resolve cwd, read the report file) and the events, and delegates parsing to the injected port.

- [ ] **Step 1: Inject the parser and delegate**

In `report-import-service.ts`, add the port to the constructor and rewrite `import()` to delegate:

```ts
import type { ReportParser } from "../ports/report-parser";

export class DefaultReportImportService implements ReportImportService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly parser: ReportParser,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async import(run: TestRun): Promise<Result<ImportedReport>> {
    const runnerPath = run.workingDirectory;
    const reportFile = run.reportPaths.json
      ? relativeVaultPath(runnerPath, run.reportPaths.json)
      : REPORT_FILE;
    const reportVaultPath = run.reportPaths.json ?? joinVaultPath(runnerPath, REPORT_FILE);

    const cwd = await resolveRunnerCwd(this.absoluteFs, runnerPath);
    if (!cwd.ok) return err(cwd.error);
    const reportAbsPath = `${cwd.value.replace(/[/\\]$/, "")}/${reportFile}`;

    const read = await this.absoluteFs.readAbsolute(reportAbsPath);
    if (!read.ok) {
      return this.fail(run.id, reportVaultPath, read.error.message, "REPORT_NOT_FOUND");
    }

    const parsed = this.parser.parse(read.value, {
      runId: run.id,
      runnerPath,
      reportVaultPath,
    });
    if (!parsed.ok) {
      return this.fail(run.id, reportVaultPath, parsed.error.message, "REPORT_PARSE_FAILED", parsed.error.cause);
    }
    const report: ImportedReport = { runId: run.id, ...parsed.value };

    await this.eventBus.publish(
      createEvent(
        "report.imported",
        { runId: run.id, reportPath: reportVaultPath, scenarioResults: report.scenarioResults.length },
        { correlationId: run.id },
      ),
    );
    this.logger.info("Report imported", {
      runId: run.id,
      scenarios: report.scenarioResults.length,
      ...report.result,
    });
    return ok(report);
  }
  // `fail(...)` stays unchanged.
}
```

- [ ] **Step 2: Wire the parser in the composition root**

In `src/main.ts`, construct the parser once and pass it where `DefaultReportImportService` is built:

```ts
import { CucumberJsonReportParser } from "./application/services/cucumber-json-report-parser";
// ... at the construction site of DefaultReportImportService, add the parser arg:
const reportParser = new CucumberJsonReportParser();
// new DefaultReportImportService(settingsService, absoluteFs, reportParser, eventBus, logger)
```

(Grep `new DefaultReportImportService(` to find the exact call; insert `reportParser` as the third argument.)

- [ ] **Step 3: Update the test construction helper**

In `tests/report-import-service.test.ts`, find the helper that constructs `DefaultReportImportService` and insert `new CucumberJsonReportParser()` as the third arg. **Change only the construction** — every existing behavioural assertion must pass unmodified (the service's observable behaviour is identical; this proves the extraction was faithful).

```ts
import { CucumberJsonReportParser } from "../src/application/services/cucumber-json-report-parser";
// in the build helper:
const service = new DefaultReportImportService(settings, absoluteFs, new CucumberJsonReportParser(), bus, logger);
```

- [ ] **Step 4: Verify the whole suite + gate**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`
Expected: all green — `report-import-service.test.ts` passes with only the construction line changed.

Run: `npm run test:coverage && npx fallow audit --base origin/main`
Expected: audit exit 0. (The extraction *reduces* `report-import-service.ts` complexity; if the audit now flags `toParsedReport` in the new parser file as introduced complexity, decompose it below cognitive 15 — it was already large in the service, so this is the moment to split the feature/scenario loops if the gate asks.)

- [ ] **Step 5: CHANGELOG + single atomic commit (Tasks 2 + 3)**

Under `## [Unreleased]` add a `### Changed` entry:

```markdown
- Report import is now port-based: `DefaultReportImportService` delegates
  parsing to a `ReportParser` (first implementation `CucumberJsonReportParser`),
  so the V2 runner's Cucumber Messages output and other formats slot in beside
  it without touching the import pipeline (ADR-0021/0022; opens EPIC-019).
```

Commit the whole extraction at once — the parser, the rewired service, the composition-root wiring, and both test files — so the committed state compiles:

```bash
git add src/application/services/cucumber-json-report-parser.ts src/application/services/report-import-service.ts src/main.ts tests/cucumber-json-report-parser.test.ts tests/report-import-service.test.ts CHANGELOG.md
git commit -m "refactor: extract CucumberJsonReportParser behind the ReportParser port (pre-V2 2.3)"
```

---

### Task 4: `schemaVersion` envelope on `data.json` (item 2.1, scoped)

**Files:**
- Modify: `src/application/services/settings-service.ts` (`load`, the two `store.save` sites, a new constant + helper)
- Test: `tests/settings-service.test.ts`

Stamp a schema version into the persisted blob; on a present blob whose version **differs** from the code, reset to defaults with a logged report. An unversioned (V1) blob merges forward-compatibly — it is not reset. No migration framework (beta).

- [ ] **Step 1: Write the failing tests**

Add to `tests/settings-service.test.ts` (reuse the file's `FakeDataStore` + construction helpers):

```ts
describe("schemaVersion envelope (2.1)", () => {
  it("stamps schemaVersion into the persisted blob on save", async () => {
    const store = new FakeDataStore();
    const service = buildServiceWith(store);
    const result = await service.save(DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    const raw = (await store.load()) as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(1);
  });

  it("resets a present blob whose schemaVersion differs from the code, and logs it", async () => {
    const store = new FakeDataStore();
    const logger = recordingLogger();
    await store.save({
      schemaVersion: 0,
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "tampered" },
    });
    const service = buildServiceWith(store, logger);
    const settings = await service.load();
    expect(settings.ci.nodeVersion).toBe(DEFAULT_SETTINGS.ci.nodeVersion); // reset wins
    expect(logger.errorCalls.some((m) => m.includes("schema"))).toBe(true);
  });

  it("is silent and uses defaults on a fresh install (no data.json)", async () => {
    const store = new FakeDataStore(); // load() returns undefined
    const logger = recordingLogger();
    const service = buildServiceWith(store, logger);
    const settings = await service.load();
    expect(settings.ci.nodeVersion).toBe(DEFAULT_SETTINGS.ci.nodeVersion);
    expect(logger.errorCalls.some((m) => m.includes("schema"))).toBe(false); // first run is not a "reset"
  });

  it("loads a matching-version blob normally (sanitizers still run)", async () => {
    const store = new FakeDataStore();
    await store.save({
      schemaVersion: 1,
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "20" },
    });
    const service = buildServiceWith(store);
    const settings = await service.load();
    expect(settings.ci.nodeVersion).toBe("20"); // valid value preserved
  });

  it("merges an unversioned (V1) blob forward-compatibly instead of resetting it", async () => {
    const store = new FakeDataStore();
    const logger = recordingLogger();
    await store.save({
      // no schemaVersion — a pre-versioning V1 blob
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "20" },
    });
    const service = buildServiceWith(store, logger);
    const settings = await service.load();
    expect(settings.ci.nodeVersion).toBe("20"); // preserved, not reset
    expect(logger.errorCalls.some((m) => m.includes("schema"))).toBe(false); // not a reset
  });
});
```

(Adapt `buildServiceWith` / `recordingLogger` to the file's existing helpers — if the logger spy is shaped differently, match it; the assertion is "an error was logged mentioning schema".) The existing unversioned settings fixtures (scalar/sut/path repair, F2 serialization) stay green unchanged: an absent version is treated as v1, which equals the current `DATA_SCHEMA_VERSION`, so they flow through merge + sanitize exactly as today.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/settings-service.test.ts -t "schemaVersion envelope"`
Expected: the stamp test and the stale-reset test FAIL (no version handling yet).

- [ ] **Step 3: Implement the envelope**

In `settings-service.ts`, add the constant near the other module constants:

```ts
/**
 * The data.json schema version. Bumped when the persisted shape changes
 * incompatibly. Pre-announcement beta has no migration framework (proposal §9
 * Phase 2 scope): a present blob with a different version resets to defaults
 * with a logged report rather than being migrated.
 */
const DATA_SCHEMA_VERSION = 1;
```

Rewrite `load()` so the version gate runs before merge:

```ts
async load(): Promise<TestHubSettings> {
  const raw = await this.store.load();
  // A present blob whose EFFECTIVE version differs from the code → beta reset
  // (log + defaults, no migration). A present-but-unversioned blob is treated
  // as v1 (the version this envelope shipped at), so at v1 it still merges,
  // but a future incompatible bump resets it instead of merging stale data.
  // First run (no data.json) falls through to defaults silently.
  if (this.schemaVersionIsStale(raw)) {
    this.logger.error(
      "data.json schemaVersion differs from this build; resetting settings to defaults (beta: no migration).",
      undefined,
      { expected: DATA_SCHEMA_VERSION },
    );
    return DEFAULT_SETTINGS;
  }
  const settings = this.sanitizeScalarShapes(
    this.sanitizeRunnerEnvInputs(this.sanitizePaths(mergeWithDefaults(raw))),
  );
  return { ...settings, onboarding: repairOnboardingShape(settings.onboarding) };
}

/**
 * True for a present blob whose EFFECTIVE schema version differs from the
 * code. A present-but-unversioned (or non-numeric) blob predates the
 * envelope, so it is treated as version 1 — the version this envelope shipped
 * at, fixed forever, NOT `DATA_SCHEMA_VERSION` which moves on each bump. Thus
 * an unversioned blob merges while the code is at v1, but resets once the code
 * bumps past 1. `undefined` raw = first run, not stale.
 */
private schemaVersionIsStale(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const version = (raw as Record<string, unknown>).schemaVersion;
  // 1 = the schema version at which this envelope shipped (a constant, not
  // DATA_SCHEMA_VERSION); a pre-envelope blob is effectively v1.
  const effective = typeof version === "number" ? version : 1;
  return effective !== DATA_SCHEMA_VERSION;
}
```

Stamp the version at both persistence sites. Add a private helper and use it in `save()` and `reset()`:

```ts
/** Persists settings under the schema envelope (stamps the current version). */
private persist(settings: TestHubSettings): Promise<Result<void>> {
  return this.store.save({ schemaVersion: DATA_SCHEMA_VERSION, ...settings });
}
```

In `save()`, replace `const saved = await this.store.save(settings);` with `const saved = await this.persist(settings);`. In `reset()`, replace `const saved = await this.store.save(DEFAULT_SETTINGS);` with `const saved = await this.persist(DEFAULT_SETTINGS);`.

Confirm `mergeWithDefaults` ignores the extra `schemaVersion` key (it selects known `TestHubSettings` fields, so a sibling key is dropped) — read it and verify; if it spreads `raw` wholesale, add `schemaVersion` to the keys it strips.

Because `save()`/`reset()` now stamp `schemaVersion` into the persisted blob, grep `tests/settings-service.test.ts` for any assertion on the **exact** saved payload (e.g. `expect(await store.load()).toEqual(settings)` or a deep-equal on the `store.save` argument) and update it to expect the `schemaVersion: 1` key. Assertions that check the read-back *settings* (not the raw blob) are unaffected.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings-service.test.ts`
Expected: new tests pass; all pre-existing settings tests (F2 serialization, scalar repair, sut repair) unchanged and green — the envelope wraps, it does not alter the settings shape they assert.

- [ ] **Step 5: Verify, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check && npm run test:coverage && npx fallow audit --base origin/main`
Expected: all green; audit exit 0.

Under `### Added` add:

```markdown
- `data.json` now carries a `schemaVersion`; a stored blob whose version
  doesn't match the code resets to defaults with a logged report (the
  forward rail for V2 settings changes — pre-announcement beta deliberately
  resets rather than migrates).
```

```bash
git add src/application/services/settings-service.ts tests/settings-service.test.ts CHANGELOG.md
git commit -m "feat: schemaVersion envelope on data.json with beta reset-on-mismatch (pre-V2 2.1)"
```

---

### Task 5: `.testrunner` manifest version stamp (item 2.2, scoped)

**Files:**
- Modify: `src/application/content/runner-manifest.ts` (version constant + manifest filename/content)
- Modify: `src/infrastructure/runner/templates/runner-templates.ts` (generate the manifest file)
- Create: `src/application/content/runner-manifest-version.ts` (pure reader)
- Modify: `src/application/services/environment-validation-service.ts` (flag any version-mismatched manifest)
- Modify: `src/presentation/settings/settings-rows.ts` (surface advisory issues even when the runner is valid)
- Modify: `src/presentation/commands/register-commands.ts` (mention advisories in the validate notice)
- Test: `tests/runner-manifest-version.test.ts`, `tests/runner-templates.test.ts`, `tests/settings-rows.test.ts`, `tests/environment-validation-service.test.ts`

Stamp a version into the generated runner and let validation detect a version-mismatched/missing one — the rail Phase 3 uses to recognise a pre-playwright-bdd `.testrunner`. The signal is a non-blocking **warning** (the runner still runs), so it must be surfaced where validation results are shown even when `valid === true`.

- [ ] **Step 1: Add the version constant + manifest contract data**

In `src/application/content/runner-manifest.ts` add:

```ts
/**
 * The `.testrunner` manifest version. Stamped into `testrunner-manifest.json`
 * at generation; read back by validation to detect a runner produced by an
 * older plugin (the Phase 3 playwright-bdd migration keys on this). Bumped
 * whenever the generated runtime shape changes incompatibly.
 */
export const TESTRUNNER_MANIFEST_VERSION = 1;

/** The generated manifest file (vault-relative to the runner root). */
export const TESTRUNNER_MANIFEST_FILE = "testrunner-manifest.json";

/** Canonical manifest content for the current version. */
export const testrunnerManifestContent = (): string =>
  JSON.stringify({ manifestVersion: TESTRUNNER_MANIFEST_VERSION }, null, 2) + "\n";
```

- [ ] **Step 2: Generate the manifest file**

In `runner-templates.ts`, import the helpers and add an entry to the `buildRunnerTemplates` array (next to `package.json`):

```ts
import {
  TESTRUNNER_MANIFEST_FILE,
  testrunnerManifestContent,
} from "../../../application/content/runner-manifest";
// ... inside the returned array:
{
  path: unsafeVaultPath(TESTRUNNER_MANIFEST_FILE),
  content: testrunnerManifestContent(),
  overwrite: true,
},
```

- [ ] **Step 3: Write the pure reader (failing test first)**

Create `tests/runner-manifest-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseManifestVersion } from "../src/application/content/runner-manifest-version";

describe("parseManifestVersion", () => {
  it("reads the version from valid manifest content", () => {
    expect(parseManifestVersion('{"manifestVersion": 3}')).toBe(3);
  });
  it("returns null for missing, malformed, or non-numeric versions", () => {
    expect(parseManifestVersion("not json")).toBeNull();
    expect(parseManifestVersion("{}")).toBeNull();
    expect(parseManifestVersion('{"manifestVersion": "x"}')).toBeNull();
    expect(parseManifestVersion(undefined)).toBeNull();
  });
});
```

Run: `npx vitest run tests/runner-manifest-version.test.ts` → FAIL (module not found).

Create `src/application/content/runner-manifest-version.ts`:

```ts
/**
 * Reads the `manifestVersion` from a `testrunner-manifest.json` body. Returns
 * `null` when the file is absent (undefined), unparseable, or carries no
 * numeric version — all of which mean "older than the first stamped runner"
 * and signal a repair (the runner predates this manifest).
 */
export const parseManifestVersion = (content: string | undefined): number | null => {
  if (content === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const version = (parsed as Record<string, unknown>).manifestVersion;
  return typeof version === "number" && Number.isFinite(version) ? version : null;
};
```

Run: `npx vitest run tests/runner-manifest-version.test.ts` → PASS.

- [ ] **Step 4: Flag a version-mismatched/missing manifest in validation**

In `environment-validation-service.ts`, read the manifest from the runner and add a warning whenever its version is not exactly `TESTRUNNER_MANIFEST_VERSION`. Locate where the service reads runner files via the file system port; add (matching the file's existing read/validation idiom):

```ts
import {
  TESTRUNNER_MANIFEST_FILE,
  TESTRUNNER_MANIFEST_VERSION,
} from "../content/runner-manifest";
import { parseManifestVersion } from "../content/runner-manifest-version";
// ... inside the runner-files validation, after the required-files checks:
const manifestPath = joinVaultPath(settings.paths.testRunnerPath, TESTRUNNER_MANIFEST_FILE);
const manifestRead = await this.fs.readFile(manifestPath);
const manifestVersion = parseManifestVersion(manifestRead.ok ? manifestRead.value : undefined);
if (manifestVersion !== TESTRUNNER_MANIFEST_VERSION) {
  // Any non-equal version is a repair signal: null/older = a runner from an
  // older Test Hub; NEWER = a vault repaired by a newer plugin then opened
  // here (downgrade / Obsidian Sync), whose .testrunner shape may not match
  // this build. Warn on all three rather than only on older.
  issues.push({
    severity: "warning",
    message:
      "The .testrunner was produced by a different Test Hub version; run Repair installation to regenerate it.",
  });
}
```

This is a **warning**, so `valid` stays `true` for an otherwise-healthy runner (the manifest mismatch does not block a run). Use the service's actual issue/warning shape and its file-system port field name — read the surrounding validators and match them exactly. If the service has no `fs.readFile`-style reader, route the read through whatever port it already uses for runner files.

- [ ] **Step 5: Surface advisory (non-error) issues even when the runner is valid**

The manifest warning is invisible today: `runnerValidationRows` (`src/presentation/settings/settings-rows.ts`) returns only the ready row when `result.valid`, and the validate command's `Notice` (`register-commands.ts`) branches on `valid` alone. Render the advisories too.

In `settings-rows.ts`, change `runnerValidationRows` so a valid result still shows warning/info rows:

```ts
export const runnerValidationRows = (result: RunnerValidationResult): ChecklistRow[] => {
  if (result.valid) {
    // Healthy, but surface any non-error advisories (e.g. an outdated
    // .testrunner manifest → Repair) so a warning isn't swallowed.
    const advisories = result.issues.filter((issue) => issue.severity !== "error");
    return [
      checklistRow("ok", "Environment is ready."),
      ...advisories.map((issue) => checklistRow(issue.severity, issue.message)),
    ];
  }
  if (result.issues.length === 0) return [checklistRow("error", "Environment is not ready.")];
  return result.issues.map((issue) => checklistRow(issue.severity, issue.message));
};
```

In `register-commands.ts`, where the validate command surfaces its `Notice`, when `result.valid` but `result.issues` contains warnings, append a hint (e.g. `"Environment ready (N advisory: run Repair installation)."`) instead of a bare "ready" — match the file's existing Notice idiom. (`register-commands.ts` is coverage-excluded; the behaviour is pinned by the projection test below, and the command smoke test from PR #38 still passes.)

- [ ] **Step 6: Pin the generation, validation, and surfacing in tests**

Add to `tests/runner-templates.test.ts` (the file already asserts generated templates):

```ts
it("generates testrunner-manifest.json carrying the current manifest version", () => {
  const files = buildRunnerTemplates(DEFAULT_SETTINGS);
  const manifest = files.find((f) => f.path === "testrunner-manifest.json");
  expect(manifest).toBeDefined();
  expect(JSON.parse(manifest!.content)).toEqual({ manifestVersion: 1 });
});
```

Add validation tests to `tests/environment-validation-service.test.ts` (match its existing setup), covering all three mismatch directions and the equal case: manifest **absent** → warning present; manifest **older** (e.g. `manifestVersion: 0`) → warning present; manifest **newer** (e.g. `manifestVersion: 99`) → warning present; manifest at the **current** version → no manifest warning. (Mirror the file's existing "missing required file" warning test for shape.)

**First, fix the existing healthy fixture:** the file's `markFullyInstalled` helper seeds only `VALIDATED_RUNNER_FILES`, and the manifest is deliberately *not* in that list — so once an absent manifest is a warning, every existing "healthy environment has no issues" assertion would start failing with the absent-manifest warning. Update `markFullyInstalled` (or the healthy setup) to also seed a current `testrunner-manifest.json` body (`testrunnerManifestContent()`) before those assertions, so the only test that sees the manifest warning is the one that deliberately omits/staledates it.

Add a projection test to `tests/settings-rows.test.ts` proving the advisory is surfaced when valid:

```ts
it("surfaces a warning advisory alongside the ready row when the runner is valid", () => {
  const rows = runnerValidationRows({
    valid: true,
    issues: [{ code: "MANIFEST_OUTDATED", severity: "warning", message: "run Repair installation" }],
    // ...any other RunnerValidationResult fields the type requires
  } as RunnerValidationResult);
  expect(rows[0]).toMatchObject({ status: "ok" });
  expect(rows.some((r) => r.status === "warning" && /Repair/.test(r.label))).toBe(true);
});

it("still shows only the ready row when valid with no advisories", () => {
  const rows = runnerValidationRows({ valid: true, issues: [] } as RunnerValidationResult);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "ok" });
});
```

(Adapt the `RunnerValidationResult` literal to the type's required fields and the `ChecklistRow` shape — read `settings-rows.ts` and its existing tests; the row's text field may be `label` or `text`.)

- [ ] **Step 7: Verify, CHANGELOG, commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check && npm run test:coverage && npx fallow audit --base origin/main`
Expected: all green; audit exit 0. (Note: adding a generated file means the `e2e-smoke` surface — `runner-templates.ts` — changed, so that workflow auto-triggers on the eventual PR; the new file is inert at runtime, so the smoke run stays green.)

Under `### Added` add:

```markdown
- The generated `.testrunner` carries a versioned `testrunner-manifest.json`;
  environment validation flags a runner produced by a different Test Hub
  version for Repair (surfaced as an advisory even when the runner is
  otherwise ready) — the detection rail the V2 playwright-bdd migration keys
  on.
```

```bash
git add src/application/content/runner-manifest.ts src/application/content/runner-manifest-version.ts src/infrastructure/runner/templates/runner-templates.ts src/application/services/environment-validation-service.ts src/presentation/settings/settings-rows.ts src/presentation/commands/register-commands.ts tests/runner-manifest-version.test.ts tests/runner-templates.test.ts tests/environment-validation-service.test.ts tests/settings-rows.test.ts CHANGELOG.md
git commit -m "feat: versioned .testrunner manifest + advisory outdated-runner validation (pre-V2 2.2)"
```

---

### Task 6: Cross-link the ADRs and close proposal item 2.4

**Files:**
- Modify: `docs/proposals/2026-06-11 V2 Research and Proposal.md` (mark 2.4 delivered)
- Modify: `CHANGELOG.md`

The five ADRs and the CONTEXT sync are already committed (`f05e181`); this task records that 2.4 is delivered and points readers at the ADRs.

- [ ] **Step 1: Annotate the proposal's Phase 2 table**

In the §9 Phase 2 table row 2.4, append a delivered-marker to the item cell:

```markdown
| 2.4 | Write and accept the V2 ADRs: … **— delivered 2026-06-13 as ADR-0021…0025 (design spec: `docs/superpowers/specs/2026-06-13-v2-foundational-adrs-design.md`).** |
```

(Keep the existing cell text; append the bold marker.)

- [ ] **Step 2: CHANGELOG entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- Five accepted V2 foundational ADRs (ADR-0021…0025): playwright-bdd runner,
  scenario identity & history store, opt-in local MCP / no in-plugin AI,
  credentials via Obsidian `secretStorage`, and the Chromium-only default
  browser matrix (proposal §9 item 2.4).
```

- [ ] **Step 3: Verify docs format + commit**

Run: `npm run format:check`
Expected: exits 0 (run `npm run format` first if prettier flags the edited Markdown).

```bash
git add "docs/proposals/2026-06-11 V2 Research and Proposal.md" CHANGELOG.md
git commit -m "docs: mark proposal §9 item 2.4 delivered (ADR-0021..0025)"
```

---

### Task 7: Full gate, push, PR

- [ ] **Step 1: Full PR gate locally**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage`
Expected: all green; coverage thresholds (93/80/93/93) hold — the new pure modules (`report-parser` types, `cucumber-json-report-parser`, `runner-manifest-version`) carry their own tests; the `report-import-service` extraction keeps its behaviour tests.

- [ ] **Step 2: Final audit with coverage present**

Run: `npx fallow audit --base origin/main`
Expected: exit 0. The ReportParser extraction should *reduce* `report-import-service.ts`'s footprint; if any introduced finding remains, decompose it now (no suppressions).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin claude/specorator-v2-phase2-foundations
```

Open a ready-for-review PR against `main`, title: `Pre-V2 Phase 2 foundations: ReportParser port + version stamps + V2 ADRs (items 2.1–2.4)`. Body: one bullet per item (2.4 ADRs delivered, 2.3 ReportParser port, 2.1 schemaVersion envelope, 2.2 manifest version), the design-spec link, and the beta-scope note (heavy migration machinery deferred to a pre-announcement hardening phase per the design spec §7). Note the `e2e-smoke` workflow auto-triggers (Task 5 touched the runner-template surface) and must be green on both OS legs alongside the blocking quality gate.

- [ ] **Step 4: Watch CI**

Subscribe to PR activity; the blocking `quality` job (coverage-fed fallow audit), the build matrix, and the auto-triggered `e2e-smoke` (ubuntu + windows) must all go green.

---

## Phase 2 exit criteria (from the proposal §9)

- [ ] Five V2 ADRs authored and accepted (2.4) — **done this session**
- [ ] `ReportParser` port extracted; cucumber-JSON parser is its first implementation; import pipeline unchanged in behaviour (2.3)
- [ ] `data.json` carries `schemaVersion` with beta reset-on-mismatch (2.1, scoped — heavy migration framework deferred)
- [ ] `.testrunner` carries a versioned manifest; validation flags an outdated runner for repair (2.2, scoped — non-destructive guided upgrade deferred)
- [ ] Blocking quality gate + e2e-smoke green on the PR

**Deferred to a pre-announcement hardening phase** (design spec §7): item 2.1's tested migration-step framework and item 2.2's repair-driven non-destructive guided upgrades.

**Next increment after this gate:** §9 Phase 3 — the playwright-bdd migration (3.1 spike → 3.2 runner swap + repair-migrates V1 projects → 3.3 full validation incl. the Guided Tour against the migrated runner). Only after the Phase 3 gate does V2.0 feature work (§8 epics) begin.

# Design: Evidence Explorer (EPIC-008) & opt-in E2E CI smoke test

Date: 2026-06-10
Status: approved (design dialogue 2026-06-10)
Branch: `claude/repo-review-improvement-fa7b5s`

## Context

Two backlog items, designed together because both close gaps around the
generated `.testrunner` and its evidence trail:

1. **Evidence Explorer** (EPIC-008 — Reporting & Evidence): the only run-history
   surface today is the dashboard's "Recent Runs" table (US-038), which is
   projected from Use Case frontmatter and shows only the latest run per Use
   Case. Evidence notes are written to `Test Evidence/YYYY/MM/<runId>/summary.md`
   (ADR-0016) but there is no Test Hub surface to browse that partitioned
   history.
2. **Opt-in E2E CI smoke test**: this repository's CI runs unit/integration
   tests only. The runner templates are never actually installed and executed
   end-to-end, so bugs like the `npm.cmd` quoting break (e1ddb5b) and the
   `cucumber.mjs` profile-wrapper config discard (bdab4a3) shipped despite a
   green CI.

A third requested item — "all views in the main area, only the Test Console in
the sidepanel" — needs **no work**: `ObsidianWorkspaceAdapter.openView` already
defaults every work surface to a main tab and only the Test Console to the
right sidebar. Decision: keep the current behavior, including respecting leaves
the user has dragged elsewhere.

## Part 1 — Evidence Explorer

### Surface

A new dedicated main-area view, peer to the Use Case and Suite explorers:

- View type `e2e-test-hub-evidence`, class `EvidenceExplorerView`, file
  `src/presentation/views/evidence-explorer-view.ts`.
- Opens in the **main area** (default `openView` location), like the other
  explorers.
- Entry points: a ribbon icon (`history`), a command-palette command
  ("Open Evidence Explorer") in `register-commands.ts`, and a
  "View all runs" link under the dashboard's "Recent Runs" heading.

### Data source (approved approach: scan partitions)

No new index and no Obsidian metadataCache coupling. A new application service
reads history straight from the ADR-0016 partition layout via the existing
`VaultFileSystem` port:

- `src/application/services/run-history-service.ts`, `RunHistoryService` with
  `DefaultRunHistoryService(settingsService, fs, logger)`.
- `listFilesRecursive(settings.paths.evidencePath)` → keep only paths matching
  `<root>/YYYY/MM/<runId>/summary.md`.
- The path alone encodes month and run id, and run ids are
  timestamp-formatted (`RUN-…`), so **sorting newest-first is lexicographic on
  the path and requires no file reads**.
- Frontmatter (`parseNote`) is read only for the page of runs being displayed.

Contract:

```ts
interface RunHistoryService {
  /** Newest-first page of run history entries. */
  list(options: { offset: number; limit: number }): Promise<Result<RunHistoryPage>>;
}

interface RunHistoryPage {
  entries: RunHistoryEntry[];
  /** True when older entries exist beyond offset + limit. */
  hasMore: boolean;
}

interface RunHistoryEntry {
  runId: string;
  evidencePath: VaultPath;
  year: string;   // "2026" — from the partition path
  month: string;  // "05"  — from the partition path
  // From frontmatter; undefined when the note is missing fields or unparsable:
  status?: string;          // passed | failed | errored | cancelled | skipped
  passed?: number;
  failed?: number;
  skipped?: number;
  total?: number;
  createdAt?: string;       // ISO timestamp
  scope?: string;           // see frontmatter extension below
  target?: string;
}
```

Markdown remains the single source of truth: a deleted evidence note simply
disappears from the explorer; an edited one shows its edited values.

### Evidence frontmatter extension

`DefaultEvidenceGenerationService.renderNote` adds two fields to newly
generated notes (TIS §10.3 frontmatter):

- `scope`: the run's `ExecutionScope` as recorded on the `TestRun`
  (`all` | `suite` | `use-case` | `feature` | `demo`).
- `target`: the run target (suite name, UC id, feature path, …).

Pre-existing notes lack the fields; the explorer renders "—" for them. No
migration.

### View behavior

- **Grouping:** month headings (e.g. "2026 / 05"), newest month first, derived
  from the partition path. Rows within a month are newest-first.
- **Row content:** run id, status, `passed/failed/total` counts, scope +
  target, date. Status cell reuses the dashboard's `data-status` +
  text-label convention (color-blind safe, never color-only).
- **Row action:** clicking (or Enter/Space on the focused row) opens the run's
  `summary.md` via the same `openEvidence` callback the dashboard uses. Every
  row is navigable — the note's existence is what put it in the list. No
  re-run-from-history (explicitly descoped).
- **Filter:** a single status dropdown (All / passed / failed / errored /
  cancelled / skipped — the values evidence frontmatter can carry). Applied
  client-side to loaded entries; "Load older" loads the
  next page (page size 50) and the filter re-applies.
- **Degraded rows:** a `summary.md` with unparsable/missing frontmatter still
  renders (run id + date from the path, status "unknown") and stays clickable.
- **Refresh:** re-render on `evidence.generated` via the shared
  `render-scheduler` pattern the other views use.
- **Empty state:** "No Test Runs yet…" copy mirroring the dashboard.

Pure row projection lives in
`src/presentation/views/evidence-explorer-rows.ts` (pattern: `dashboard-rows.ts`)
so grouping, filtering, paging, and degraded-row logic are unit-testable
without Obsidian.

### Wiring (composition root)

`main.ts`: `registerView(EVIDENCE_EXPLORER_VIEW_TYPE, …)` with deps
`{ runHistory, workspace, eventBus, openEvidence }`; ribbon icon; command
registration; dashboard dep `openEvidenceExplorer` for the "View all runs"
link.

### Error handling

- `listFilesRecursive` failure → explorer shows the standard error notice
  pattern; logged via `Logger`.
- Missing evidence root folder → empty state (not an error).
- Individual note read/parse failure → degraded row, `logger.warn`, never
  aborts the page.

### Testing

- `tests/run-history-service.test.ts`: partition discovery, lexicographic
  ordering, paging/`hasMore`, frontmatter mapping, degraded entries, missing
  root → empty, fs error → err. Uses the existing `FakeVaultFileSystem`.
- `tests/evidence-explorer-rows.test.ts`: month grouping, status filter,
  degraded-row projection, aria labels.
- `tests/evidence-generation-service.test.ts`: extended for the new
  `scope`/`target` frontmatter fields.

## Part 2 — Opt-in E2E CI smoke test

### Goal

Prove, on a real OS with a real `npm install`, that a `.testrunner` generated
from the **actual templates** installs and the demo test runs and passes —
catching the class of bug unit tests structurally miss.

### Driver (approved approach: standalone script)

`scripts/e2e-smoke.mjs` (Node, no vitest):

1. Use **esbuild** (already a devDependency) to bundle a small TS entry that
   re-exports `buildRunnerTemplates`, `DEFAULT_SETTINGS`, and the demo content
   (`DEMO_FEATURE_CONTENT`, `DEMO_FEATURE_FILE_NAME`) from `src/`, then
   dynamic-import the bundle. The smoke run therefore exercises the **same
   code** the plugin ships, not a copy.
2. Create a temp directory acting as a fake vault root:
   - write every `TemplateFile` from `buildRunnerTemplates(DEFAULT_SETTINGS)`
     under `<tmp>/.testrunner/` (this includes the `example.html` fixture);
   - write the demo feature to
     `<tmp>/<DEFAULT_SETTINGS.paths.featuresPath>/<DEMO_FEATURE_FILE_NAME>`,
     where the runner's `cucumber.mjs` feature glob points.
3. With cwd `<tmp>/.testrunner`: `npm install`, then
   `npm run install:browsers:ci` (the templates' own
   `playwright install --with-deps chromium` script), then
   `npm run test:ci` (writes `reports/cucumber-report.json`). The demo drives
   the local `file://` fixture, so no `BASE_URL`/secrets are needed.
4. **Assertions** (beyond exit code 0): parse
   `reports/cucumber-report.json`; require at least one scenario, every step
   `passed`, and the demo scenario present — guarding against
   silently-empty runs (the bdab4a3 failure mode).
5. Non-zero exit with a precise message on any failure; always print the
   report summary for the CI log.

### Workflow

`.github/workflows/e2e-smoke.yml`:

- **Triggers:** `workflow_dispatch`, plus `pull_request`
  (`opened`/`synchronize`/`reopened`/`labeled`) gated by a job-level
  `if: github.event_name == 'workflow_dispatch' || contains(github.event.pull_request.labels.*.name, 'e2e-smoke')`.
- **Matrix:** `ubuntu-latest` + `windows-latest`, Node 22, `fail-fast: false`.
  Windows is in scope because both recent runner regressions were
  Windows-/install-path-specific.
- **Steps:** checkout → setup-node (npm cache) → `npm ci` →
  `node scripts/e2e-smoke.mjs`.
- `permissions: contents: read`. Does not touch the existing `ci.yml`.

### Testing

The script is itself the test; it is exercised by running the workflow (label
a PR `e2e-smoke` or dispatch manually). The smoke run invokes only scripts
defined in the runner templates' own `package.json` (`install:browsers:ci`,
`test:ci`), so the script and templates cannot drift — the script reads the
templates it scaffolds. The existing `tests/integration/ci-scenario.test.ts`
lockstep suite continues to guard `test:ci` against renames in fast CI.

## Out of scope

- Re-run from a history row (descoped in design dialogue).
- Rich filters (suite/scope filter, date range) — only the status filter ships.
- Any run-index persistence or migration of pre-existing evidence notes.
- Scenario-level identity/history (deferred concept, see CONTEXT.md).
- Changes to view placement (current behavior confirmed as desired).

## Decision log

| Decision | Choice |
| --- | --- |
| View placement item | No change — current main-tab default + sidebar console is the desired behavior |
| Explorer surface | Dedicated main-area view, dashboard links into it |
| Row content | Status + counts + date, scope/target, click-to-open evidence (no re-run) |
| Find & filter | Month grouping + status filter, page size 50 with "Load older" |
| Explorer data source | Scan `Test Evidence` partitions, frontmatter read per displayed page |
| Smoke trigger | `workflow_dispatch` + PR label `e2e-smoke` |
| Smoke platforms | Ubuntu + Windows |
| Smoke assertions | Exit code **and** parsed cucumber JSON report (demo scenario passed) |
| Smoke driver | Standalone script + dedicated workflow (not vitest-gated) |

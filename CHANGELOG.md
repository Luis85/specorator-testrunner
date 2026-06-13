# Changelog

All notable changes to the Specorator Testrunner are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Report import is now port-based: `DefaultReportImportService` delegates
  parsing to a `ReportParser` (first implementation `CucumberJsonReportParser`),
  so the V2 runner's Cucumber Messages output and other formats slot in beside
  it without touching the import pipeline (ADR-0021/0022; opens EPIC-019).

## [1.0.1] — 2026-06-13

### Changed

- A Gherkin step's argument is modelled as a sum type (data table OR text
  block, TD-002): the serializer can no longer emit a step with both, which
  Cucumber — and the V2 playwright-bdd runner — refuse to parse.
- Structural Feature validation has one implementation shared by the
  Validate action and the editor's live strip (TD-003); whitespace-only
  feature names are now flagged on both surfaces, and an orphan filename is
  consistently an error (ADR-0012).
- One domain predicate decides "is this scenario an Outline" everywhere
  (TD-005, lenient semantics): suite/tag match counts, the validation strip,
  and the editor's Examples grid can no longer disagree.
- Command registration is covered by a smoke test (unique ids, full surface,
  callbacks invocable), and the vault adapter's existence checks now resolve
  through the Vault API first, keeping adapter access to the documented
  unindexed-path cases only.
- The six event-driven views now share one `LiveRefresh` helper for the
  subscribe/coalesce/teardown lifecycle instead of six hand-copied
  implementations; V2's new views build on the same helper.
- `runInitialization` is decomposed into per-phase step methods (behaviour
  unchanged), retiring the known complexity hot spot that tripped the
  blocking quality gate on any edit to `initialization-service.ts`.
- The hand-rolled persistence chains in `SettingsService` and
  `PostRunCoordinator` now share one `SerialQueue` utility
  (`src/shared/async/serial-queue.ts`), extracted now that per-note Use Case
  write serialization is its third user.
- `SettingsService`'s repair/validation hot spots (`repairSutShape`,
  `validate`, `sanitizeRunnerEnvInputs`, `detectSiblingTestHub`) are
  decomposed into focused helpers, clearing the remaining complexity findings
  the blocking quality gate would attribute to any future edit of the file.
- The Feature Editor always re-renders on commit and restores focus/caret
  via stable control keys (TD-004): edit handlers no longer classify
  changes as structural vs field-level, eliminating the stale-DOM and
  focus-steal bug class the flag invited.
- The pre-existing complexity of the hand-rolled Gherkin parser/serializer
  is recorded as explicit debt (TD-007) behind visible audit suppressions;
  its resolution rides the V2 playwright-bdd parser replacement rather than
  a throwaway decomposition now.
- The settings tab now renders a fully usable legacy UI on Obsidian builds
  older than 1.13 (reachable via BRAT, which does not enforce `minAppVersion`
  while 1.13 is still in development) instead of the "requires Obsidian 1.13+"
  notice added in 1.0.0. `minAppVersion` stays 1.13.0; the 1.13 declarative
  `getSettingDefinitions()` implementation is unchanged for 1.13+, and the
  legacy path renders those same definitions through the imperative `Setting`
  API, so the two cannot drift. Destructive buttons fall back from the 1.13
  `setDestructive()` to `setWarning()` when the newer API is absent.

### Fixed

- Gherkin table cells support the official escapes (`\|`, `\\`, `\n`): a
  literal pipe in table data round-trips through the structured editor
  instead of being silently rewritten to `/`, and files already using the
  standard escape are no longer locked out of structured mode (TD-001).
- Path plumbing hardening: the vault base path is normalized (no trailing
  separator) at its single source, and `joinVaultPath` rejects absolute and
  `..` segments outright — closing the gaps before the V2 migration and MCP
  server mint new paths.
- Settings repair on load now also screens `ci.*` and `automation.*` scalars
  (provider/workflow/node-version strings, automation booleans, evidence
  retention), so a tampered or synced `data.json` falls back to defaults
  instead of crashing or silently flipping automation behaviour.
- Concurrent writers to the same Use Case note (post-run evidence linking,
  the edit modal, feature linking) are now serialized per note path, so
  overlapping read-modify-write updates can no longer drop each other's
  frontmatter changes.
- Streamed runner output events are now chained per run and drained before
  the terminal run event, so a late output line can no longer arrive after
  the completed/failed/cancelled banner.

## [1.0.0] — 2026-06-12

### Added

- Installation documentation: GitHub releases + BRAT are the official
  distribution channel (community-marketplace submission deferred
  indefinitely, per the V2 proposal §5.3).
- Evidence Explorer over the partitioned run history (ADR-0016), wired to
  the command palette and dashboard (its default ribbon icon was later
  trimmed — see Changed).
- E2E smoke workflow (`workflow_dispatch` or the `e2e-smoke` PR label,
  ubuntu + windows) over the real runner templates (later extended to
  auto-trigger on runner-template changes — see Changed).
- Run-execution hardening: SIGTERM→SIGKILL escalation for stuck runners,
  terminal `testrun.failed` event on unexpected faults, child-process cleanup
  on plugin unload.
- Release safety: the release workflow verifies the tag against
  `manifest.json` and runs lint/typecheck/tests before publishing;
  `versions.json` consistency is asserted by the release-validation suite.
- Quality harness: fallow codebase intelligence as a devDependency with
  repo-tuned config (`.fallowrc.jsonc`), `quality:*` npm scripts, a
  changed-code audit job in CI (advisory at launch; now blocking — see
  Changed/TD-006), and agent-facing surfaces (`.mcp.json` MCP server,
  `.claude/skills/fallow` pointer skill, `AGENTS.md`).
- Quality harness: ESLint upgraded to v10 with the `eslint-plugin-obsidianmd`
  plugin-guideline rules scoped to `src/`; the sentence-case rule is
  configured with the CONTEXT.md glossary as brand terms so UI copy is
  enforced glossary-consistent in both directions.
- Quality harness: typescript-eslint `strictTypeChecked` +
  `stylisticTypeChecked` (tuned to the codebase's defensive-guard and
  null-object idioms) and `@vitest/eslint-plugin` test hygiene
  (no-focused-tests as error).

- `.feature` files now open inside Obsidian: the extension is registered to a
  new Feature Editor view with a structured mode (scenario cards, step rows
  with guided keywords, Examples grids, tag chips with vault-wide
  suggestions, step autocomplete from the scraped step definitions, and an
  inline ✓/✗/! validation strip) plus a raw-text mode. Files containing
  constructs the editor cannot preserve (comments, `Rule:` blocks) open as
  raw text behind a lossless round-trip guard.
- The Gherkin parser/serializer now models Scenario Outlines with Examples
  tables, per-step data tables, doc strings, and description lines, so
  programmatic Feature updates no longer drop them.

### Changed

- The plugin is now named **Specorator Testrunner** (formerly "E2E Test
  Hub") — manifest name, docs, and UI brand terms renamed; the plugin id
  (`e2e-test-hub`) is unchanged, so existing installs keep their settings.
- The E2E smoke workflow is now a dependable pre-release gate: Playwright
  browsers are cached per OS, and the suite triggers automatically on PRs
  that change the runner-template surface (in addition to manual dispatch
  and the `e2e-smoke` label).
- The quality gates are now blocking (TD-006): the fallow changed-code audit
  fails CI on findings a changeset introduces (new-only attribution), and
  `vitest/no-disabled-tests` is an error.
- Default ribbon chrome trimmed from six icons to two — Dashboard and Test
  Console (2026-06-11 review §4 product call). All other views remain
  reachable via the command palette and the dashboard's quick actions.
- Requires Obsidian 1.13+ (`minAppVersion` 1.8.0 → 1.13.0); destructive
  buttons use the 1.13 `setDestructive()` API.
- The settings tab is built on the Obsidian 1.13 declarative
  `getSettingDefinitions()` API (settings become searchable in Obsidian's
  settings search); all behavior — debounced saves, inline errors, two-click
  confirms — is unchanged.
- All devDependencies upgraded to latest (TypeScript 6, vitest 4, esbuild
  0.28, ESLint 10); `npm audit` is clean.
- Background note writes go through the atomic `Vault.process` instead of
  `Vault.modify` (Obsidian plugin guidelines).

### Fixed

- Popout-window-unsafe `setTimeout`/`clearTimeout` in the create-suite modal
  now use the window-bound timers.
- ~25 UI strings normalized to Obsidian sentence-case while preserving
  glossary capitalization (e.g. "Create Feature" → "Create feature",
  "test runs" → "Test Runs").
- A corrupt `data.json` no longer prevents the plugin from loading; it
  degrades to default settings with a logged error.
- Settings saves are serialized and disk failures surface as Notices instead
  of unhandled rejections; closing the settings dialog no longer loses the
  last debounced edit.
- Credential redaction hardened: log message text and nested error details are
  scrubbed; the settings logger receives the redaction set and configured
  level.
- A cancel racing run completion can no longer relabel a finished Test Run as
  cancelled.
- Numerous Test Hub UX fixes: confirmation for "Reset Test Hub", retry buttons
  on error states, accessible run-history tables, Notices for failed
  note-opens, mid-run Test Console state, and glossary-consistent copy.
- The generated runner sets a 60s cucumber timeout: the Before hook launches
  Chromium, and a cold first launch (notably on Windows) blew the 5s default,
  failing the demo test on first run.
- Scoped runs (single Feature / Use Case) select a `scoped` cucumber profile
  instead of merging CLI paths with the config glob, removing cucumber's
  deprecation warning from the Test Console output; the e2e-smoke workflow now
  exercises the scoped invocation shape. Runners generated before this version
  don't define the profile yet — the Test Hub detects that and omits it (the
  old warning remains) until Repair installation regenerates the config.
- The generated `.testrunner` typechecks cleanly in IDEs: `tsconfig.json`
  uses `Preserve`/`Bundler` module resolution (tsx resolves extensionless
  imports like a bundler; `NodeNext` flagged every generated relative import
  with ts2835) and `@types/node` is now a declared devDependency instead of
  leaking in from a parent `node_modules`; the e2e-smoke workflow typechecks
  the generated runner to keep IDE parity locked.
- The settings tab no longer crashes (`display is not a function`) on Obsidian
  apps older than 1.13 (reachable via BRAT, which does not enforce
  `minAppVersion`): it now shows a "requires Obsidian 1.13+" notice instead.

### Security

- `release.yml` (the only workflow with `contents: write`) pins its actions to
  full commit SHAs instead of tags; Dependabot keeps the pins current.

## [0.0.1] — unreleased development version

Initial V1 feature set: Initialization Wizard, `.testrunner` generation and
maintenance, Use Case / Specification / Test Suite management, streaming test
execution with the Test Console, report import + Evidence notes, dashboard
KPIs, and GitHub Actions workflow generation.

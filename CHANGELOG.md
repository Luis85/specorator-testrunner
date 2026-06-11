# Changelog

All notable changes to the Obsidian E2E Test Hub are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Evidence Explorer over the partitioned run history (ADR-0016), wired to the
  ribbon, command palette, and dashboard.
- Opt-in E2E smoke workflow (`workflow_dispatch` or the `e2e-smoke` PR label,
  ubuntu + windows) over the real runner templates.
- Run-execution hardening: SIGTERM→SIGKILL escalation for stuck runners,
  terminal `testrun.failed` event on unexpected faults, child-process cleanup
  on plugin unload.
- Release safety: the release workflow verifies the tag against
  `manifest.json` and runs lint/typecheck/tests before publishing;
  `versions.json` consistency is asserted by the release-validation suite.
- Quality harness: fallow codebase intelligence as a devDependency with
  repo-tuned config (`.fallowrc.jsonc`), `quality:*` npm scripts, an advisory
  changed-code audit job in CI, and agent-facing surfaces (`.mcp.json` MCP
  server, `.claude/skills/fallow` pointer skill, `AGENTS.md`).
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

## [0.0.1] — unreleased development version

Initial V1 feature set: Initialization Wizard, `.testrunner` generation and
maintenance, Use Case / Specification / Test Suite management, streaming test
execution with the Test Console, report import + Evidence notes, dashboard
KPIs, and GitHub Actions workflow generation.

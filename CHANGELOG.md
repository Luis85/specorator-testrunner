# Changelog

All notable changes to the Obsidian E2E Test Hub are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] — 2026-06-12

### Added

- Installation documentation: GitHub releases + BRAT are the official
  distribution channel (community-marketplace submission deferred
  indefinitely, per the V2 proposal §5.3).
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

### Security

- `release.yml` (the only workflow with `contents: write`) pins its actions to
  full commit SHAs instead of tags; Dependabot keeps the pins current.

## [0.0.1] — unreleased development version

Initial V1 feature set: Initialization Wizard, `.testrunner` generation and
maintenance, Use Case / Specification / Test Suite management, streaming test
execution with the Test Console, report import + Evidence notes, dashboard
KPIs, and GitHub Actions workflow generation.

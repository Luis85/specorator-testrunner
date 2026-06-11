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

### Fixed

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

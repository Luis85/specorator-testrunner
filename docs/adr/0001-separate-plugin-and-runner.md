---
type: adr
id: ADR-0001
status: accepted
title: Separate Plugin and Runner
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Building Block View]]"
---

# Separate Plugin and Runner

The Obsidian plugin and the test runtime are two independently shippable systems. The plugin lives in `src/` and provides the UI, orchestration, and scaffolding. The runtime lives in `.testrunner/` and is a self-contained Node project (Playwright + Cucumber-JS + TypeScript). They communicate only via the file system: the plugin spawns the runner as a child process and observes its reports.

The decision exists because the runner must be executable without Obsidian (the same suite has to run inside GitHub Actions, see [[0006-runner-must-be-ci-compatible]]). Coupling the runner to the plugin's process model would make CI execution impossible.

## Considered alternatives

- Run Playwright in-process inside the Obsidian plugin. Rejected: makes CI execution impossible and ties test execution to the Electron renderer's quirks.
- Ship a Playwright Test runner driven directly by the plugin. Rejected: same CI problem, plus loses Cucumber's living-documentation value.

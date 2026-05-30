---
type: adr
id: ADR-0006
status: accepted
title: Runner Must Be CI-Compatible
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Building Block View]]"
  - "[[0001-separate-plugin-and-runner]]"
---

# Runner Must Be CI-Compatible

The runner is a constraint, not a goal: every change to `.testrunner/` must preserve the property that `cd .testrunner && npm ci && npm run test:ci` produces a passing run on a vanilla GitHub Actions Ubuntu image with no Obsidian installed.

This constrains a number of downstream choices:

- No Obsidian APIs in the runner (only the plugin uses them).
- All inputs (feature files, fixtures) reachable via paths inside the same git checkout.
- Browser install via `playwright install --with-deps` — no manual Chromium setup.
- Generated CI workflow (`.github/workflows/e2e.yml`) is itself the proof: regenerating it and re-running CI is the regression check.

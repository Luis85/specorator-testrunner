---
type: adr
id: ADR-0005
status: accepted
title: Use Markdown Evidence
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Event Catalog]]"
---

# Use Markdown Evidence

Every Test Run produces a Markdown note under `Test Evidence/` with frontmatter (`type: test-evidence`, `run_id`, `linked_use_cases`, etc.) and a body that **links** to artifacts in `.testrunner/reports/` rather than duplicating them. The Markdown note is the durable record; the runner's JSON/HTML reports are the raw source.

This keeps the vault searchable, Dataview-queryable, and git-friendly, while keeping vault size bounded (screenshots and traces remain inside `.testrunner/reports/`).

## Consequences

- Deleting `.testrunner/reports/` breaks evidence links. Mitigated by treating `.testrunner/reports/` as part of the repo or by exporting evidence bundles before clean-up.
- Cross-vault sync (Obsidian Sync, iCloud) skips dotfolders by default, so screenshots and traces stay machine-local unless the user explicitly opts in.

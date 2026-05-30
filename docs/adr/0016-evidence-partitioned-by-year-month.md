---
type: adr
id: ADR-0016
status: accepted
title: Evidence Partitioned by Year/Month
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
  - "[[0005-use-markdown-evidence]]"
---

# Evidence Partitioned by Year/Month

Evidence notes are written under `Test Evidence/YYYY/MM/<runId>/summary.md` instead of a flat `Test Evidence/<runId>/summary.md`. This bounds the file-tree fan-out under any one folder so the vault stays navigable even after years of runs, without deleting any data by default.

A flat `Test Evidence/` folder works fine while there are a few dozen runs and degenerates around the low hundreds: Obsidian's file tree slows down, search becomes noisy, and Dataview queries fan out across hundreds of sibling notes. Partitioning by year/month gives Obsidian and Dataview a natural pivot, keeps each leaf folder small, compresses cleanly in git, and never forces a user to choose between "lose data" and "lose navigation."

## Considered alternatives

- **Flat folder (status quo of the original V1 sketch).** Rejected: degenerates with a few hundred runs.
- **Per-Use-Case folder** (`Test Evidence/<UC-id>/<runId>/summary.md`). Rejected: still grows linearly per-UC; UC rename breaks the tree; UC-deletion semantics get weird.
- **Per-Suite folder.** Rejected: same issues as per-UC plus a scenario can be in two Suites.
- **Daily partitioning** (`YYYY/MM/DD/...`). Rejected: too granular — ~365 folders per year is itself a navigation problem.
- **Time-based deletion as the primary mechanism** (option 2 in the grilling session). Rejected as the *default*: data loss should be explicit. Retained as an opt-in setting (SDD AD-11).

## Consequences

- `EvidenceGenerationService` creates `Test Evidence/YYYY/MM/` lazily before writing.
- `UseCase.evidence` paths store the partitioned form. Dashboard "Recent Runs" walks the tree depth-first by date.
- Dataview queries that iterate `Test Evidence` must recurse into subfolders. Example queries in the docs are updated.
- Per ADR-0014, evidence still **links** to artifacts under `.testrunner/reports/` — no copy.
- The optional retention sweeper (SDD AD-11) walks the same partitioned tree and deletes entire month folders when empty.

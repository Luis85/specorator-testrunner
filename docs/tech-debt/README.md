---
type: index
title: Tech Debt Register
---

# Tech Debt Register

Deliberate deferrals with a nameable future cost. Each item records the
current state, why it was deferred, and the intended direction — so picking
one up later starts from the decision, not from re-discovery.

Source convention: items reference the review that surfaced them (PR, date).
Status lifecycle: `open` → `in-progress` → `resolved` (note the resolving
commit/PR in the item before closing).

## Open items

| Id | Title | Area | Effort |
| --- | --- | --- | --- |
| [[TD-011]] | Post-run evidence orchestration + scattered Use Case frontmatter writes | application/evidence | large |

## Resolved items

| Id | Title | Area | Resolved |
| --- | --- | --- | --- |
| [[TD-007]] | gherkin.ts parser/serializer complexity is suppressed, not solved | gherkin | decompose-in-place; all three suppressions dropped (2026-06-19) |
| [[TD-010]] | test-execution-service runner complexity — execute() suppression dropped | runner | execute() decomposed into prepareRun/finalizeRun (2026-06-19) |
| [[TD-009]] | pipeline-generation-service.generate() exceeds complexity thresholds | ci | TD-009 decomposition increment (2026-06-16) |
| [[TD-008]] | Stale cucumber-js comments deferred in fallow-flagged files | quality | TD-008 refactor increment (2026-06-14) |
| [[TD-001]] | Support escaped pipes (`\|`) in Gherkin table cells | gherkin | pre-V2 Phase 1 increment (2026-06-12) |
| [[TD-002]] | Enforce the one-argument-per-step rule in the domain model | gherkin | pre-V2 Phase 1 increment (2026-06-12) |
| [[TD-003]] | Single source of truth for structural Feature validation | specifications | pre-V2 Phase 1 increment (2026-06-12) |
| [[TD-005]] | Unify the "is this scenario an Outline" predicate | specifications | pre-V2 Phase 1 increment (2026-06-12) |
| [[TD-004]] | Replace the Feature Editor's `commit(structureChanged)` flag | feature-editor | pre-V2 Phase 1 increment (2026-06-12) |
| [[TD-006]] | Flip the advisory quality gates to blocking and tighten them | quality | pre-V2 Phase 0 increment (2026-06-12) |

## Minor notes (not worth an item yet)

- Several Feature Editor container classes (`-body`, `-add`, `-steps`,
  `-validation`, `-examples`, `-examples-head`, `-tag-chip`) are emitted but
  unstyled in `styles.css` — intentional today, listed here so the next
  styling pass knows they exist.

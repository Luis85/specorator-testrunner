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
| [[TD-002]] | Enforce the one-argument-per-step rule in the domain model | gherkin | medium |
| [[TD-003]] | Single source of truth for structural Feature validation | specifications | medium |
| [[TD-004]] | Replace the Feature Editor's `commit(structureChanged)` flag | feature-editor | large |
| [[TD-005]] | Unify the "is this scenario an Outline" predicate | specifications | small |

## Resolved items

| Id | Title | Area | Resolved |
| --- | --- | --- | --- |
| [[TD-001]] | Support escaped pipes (`\|`) in Gherkin table cells | gherkin | pre-V2 Phase 1 increment (2026-06-12) |
| [[TD-006]] | Flip the advisory quality gates to blocking and tighten them | quality | pre-V2 Phase 0 increment (2026-06-12) |

## Minor notes (not worth an item yet)

- `SpecificationService.listStepPatterns` returns `Result` but has no
  reachable error path (`loadStepDefinitions` collapses failures to `[]`);
  the `patterns.ok ? … : []` fallback in `detectMissingSteps` is dead code.
  Revisit if step scraping ever gains a real failure mode.
- `listKnownTags` seeds the `@smoke`/`@wip` conventions as string literals;
  if the tag vocabulary grows, extract shared constants (a `WIP_TAG` constant
  already exists privately in `feature-insight-service.ts`).
- Several Feature Editor container classes (`-body`, `-add`, `-steps`,
  `-validation`, `-examples`, `-examples-head`, `-tag-chip`) are emitted but
  unstyled in `styles.css` — intentional today, listed here so the next
  styling pass knows they exist.

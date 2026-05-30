---
type: adr
id: ADR-0012
status: accepted
title: Use Case to Feature Specification Is 1:N
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
  - "[[UC-006]]"
  - "[[UC-011]]"
---

# Use Case to Feature Specification Is 1:N

Each Use Case owns 0..N Feature Specifications; each Feature Specification belongs to exactly one Use Case. The filename convention `<UC-id>-<slug>.feature` carries the back-reference; the Use Case's `featureFiles` array carries the forward list.

A 1:1 model was the cheaper default — single file per UC, simpler dashboard logic, run scopes "use-case" and "feature" collapse. But real test coverage of a single Use Case decomposes naturally into multiple concerns (happy path, failure modes, edge cases, platform-specific behaviour), and a single `.feature` file grows into something nobody wants to edit or diff. Splitting via tags inside one file loses file-level isolation: independent editing, separate validation, independent run scoping, and granular git diffs.

The 1:N relationship is intentionally strict: no orphan Features, no shared Features across Use Cases. Sharing test logic across Use Cases happens via step definitions and Cucumber `Background`, not via shared `.feature` files.

## Considered alternatives

- **1:1 strict.** One Feature per UC, scenarios within. Rejected: forces large UCs into either a growing single file or a contrived UC split.
- **M:N via tags.** Maximum flexibility. Rejected: weakest navigation, hardest mental model, undermines the FR-017 traceability wedge.
- **0..1 both ways (the TIS's original draft).** Rejected: silently produces orphan Features and breaks the dashboard's `automatedUseCases` KPI.

## Consequences

- `UseCase.featureFile?: VaultPath` becomes `UseCase.featureFiles: VaultPath[]` (empty array = not yet automated).
- `FeatureSpecification.useCaseId?: UseCaseId` becomes `FeatureSpecification.useCaseId: UseCaseId` (required).
- Filename convention `<UC-id>-<slug>.feature` enforced by `SpecificationService.create()`. Features in `Specifications/features/` without a `UC-NNN-` prefix surface as `specification.validation.completed` errors.
- UC-006 Generate Feature is non-destructive: first invocation creates `<UC-id>-happy-path.feature`; subsequent invocations prompt for a slug and add a new file. Existing files are never overwritten.
- UC-011 Execute Use Case runs every Feature under the UC in declaration order. UC-012 Execute Feature targets a single file.
- A deprecated UC (`status: "deprecated"`) excludes all its Features from `Run All`; evidence history is preserved.

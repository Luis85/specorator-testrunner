---
type: adr
id: ADR-0011
status: accepted
title: CI Reads Base URL From GitHub Actions Variables
date: 2026-05-30
related:
  - "[[0006-runner-must-be-ci-compatible]]"
  - "[[0013-sut-modeled-as-named-environments]]"
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
---

# CI Reads Base URL From GitHub Actions Variables

The generated workflow at `.github/workflows/e2e.yml` is **environment-agnostic**: it reads the SUT base URL from `${{ vars.E2E_BASE_URL }}` at job time rather than from a value baked in at workflow-generation time.

Without this, the workflow becomes a snapshot of whichever Environment was active when the user last clicked **Generate CI Pipeline** (UC-019). The moment the user switches Environments in the plugin without regenerating, the workflow tests against the wrong URL silently. Repository variables keep the workflow honest: promoting staging → production is a one-click change of `E2E_BASE_URL`, not a workflow regen + commit.

## Considered alternatives

- **Hardcode the active Environment's URL into the workflow at generation time.** Simpler but drifts the moment the user switches Environments and forgets to regenerate.
- **`workflow_dispatch` with an `environment` input.** Fine for ad-hoc runs but does not fire for automatic PR runs, which is the primary CI path.
- **Matrix over every defined Environment.** Honest but multiplies CI cost and noise with each Environment the user adds.

## Consequences

- `EnvironmentValidationService.validateCiReadiness()` adds a check for `vars.E2E_BASE_URL`; the dashboard's CI Readiness tile deep-links to GitHub repo settings when the variable is missing.
- `PipelineGenerationService` no longer needs the active Environment URL at workflow-generation time.
- `RunnerCommandBuilder` receives `BASE_URL` as an environment variable for local runs too — sourced from the Active Environment in settings — so local and CI use the same contract.
- Establishes the pattern that auth and other per-Environment secrets will follow (`secrets.E2E_AUTH_*`); that pattern will be its own ADR once auth is designed.

# Architectural Decision Records

Long-form architectural decisions for the Obsidian E2E Test Hub. Format and authoring guidance live in [`.claude/skills/grill-with-docs/ADR-FORMAT.md`](../../.claude/skills/grill-with-docs/ADR-FORMAT.md).

ADRs here are **architectural shape** decisions: hard to reverse, surprising without context, and the result of a real trade-off. Tactical V1 configuration choices (package manager, browser matrix, fixture path, etc.) live inline in [Solution Design §25](../architecture/Solution%20Design.md#25-architectural-decisions) as AD-1…AD-N.

## Index

| ID | Title |
| --- | --- |
| [ADR-0001](./0001-separate-plugin-and-runner.md) | Separate Plugin and Runner |
| [ADR-0002](./0002-store-runner-in-dot-testrunner.md) | Store Runner in `.testrunner` |
| [ADR-0003](./0003-use-gherkin-as-specification-format.md) | Use Gherkin as Specification Format |
| [ADR-0004](./0004-use-playwright-as-browser-automation-engine.md) | Use Playwright as Browser Automation Engine |
| [ADR-0005](./0005-use-markdown-evidence.md) | Use Markdown Evidence |
| [ADR-0006](./0006-runner-must-be-ci-compatible.md) | Runner Must Be CI-Compatible |
| [ADR-0007](./0007-runtime-eventbus-not-event-sourcing.md) | Use Runtime EventBus, Not Full Event Sourcing |
| [ADR-0008](./0008-relative-vault-paths.md) | Use Relative Vault Paths |
| [ADR-0009](./0009-provide-out-of-the-box-demo-test.md) | Provide Out-of-the-box Demo Test |
| [ADR-0010](./0010-restrict-custom-shell-commands.md) | Restrict Custom Shell Commands in V1 |
| [ADR-0011](./0011-ci-reads-base-url-from-github-actions-variables.md) | CI Reads Base URL From GitHub Actions Variables |
| [ADR-0012](./0012-use-case-to-feature-is-one-to-many.md) | Use Case to Feature Specification Is 1:N |
| [ADR-0013](./0013-sut-modeled-as-named-environments.md) | SUT Modeled as Named Environments with One Active |
| [ADR-0014](./0014-v1-auth-transport-is-environment-variables.md) | V1 Auth Transport Is Environment Variables |
| [ADR-0015](./0015-one-project-per-vault.md) | One Project Per Vault |
| [ADR-0016](./0016-evidence-partitioned-by-year-month.md) | Evidence Partitioned by Year/Month |
| [ADR-0017](./0017-use-case-automation-rollup-with-wip-exclusion.md) | Use Case Automation Status Rolls Up From Features With `@wip` Exclusion |
| [ADR-0018](./0018-at-most-one-active-test-run.md) | At Most One Active Test Run |
| [ADR-0019](./0019-error-handling-and-logging-model.md) | Error Handling and Logging Model |

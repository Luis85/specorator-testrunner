---
type: adr
id: ADR-0013
status: accepted
title: SUT Modeled as Named Environments with One Active
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[Technical Interface Specification]]"
  - "[[0011-ci-reads-base-url-from-github-actions-variables]]"
  - "[[0014-v1-auth-transport-is-environment-variables]]"
---

# SUT Modeled as Named Environments with One Active

The System Under Test is not a single URL — it is a named list of **Environments** (e.g. `staging`, `production`) with exactly one **Active Environment** at a time. Switching between Environments is a single action; URLs are never edited inline at test time.

Real QA work always involves more than one Environment. A single `sutUrl` setting would force the user to edit-and-re-save on every promotion (staging → production), which they will forget and silently test the wrong system. Encoding the URL per Use Case in frontmatter splits SUT identity across N notes and makes "Run All" against a chosen Environment impossible.

## Considered alternatives

- **Single global `sutUrl` in settings.** Simplest. Rejected: doesn't match how QA users work — they always have multiple Environments.
- **Per-Use-Case URL in UC frontmatter.** Maximum flexibility. Rejected: splits SUT identity across notes and breaks "Run All" semantics.
- **Free-text `--base-url` in `defaultRunCommand`.** Invisible, unvalidated, easy to mess up. Rejected.

## Consequences

- `TestHubSettings` gains `sut: SutSettings` containing `active: string` and `environments: Record<string, SutEnvironment>`.
- The demo Environment is implicit and locked to `file://` per ADR-0009; it bypasses `sut.*` entirely.
- The dashboard's top bar shows the Active Environment and offers a one-tap switcher.
- ADR-0011 cascades from this: the generated CI workflow reads `vars.E2E_BASE_URL` rather than baking in the active URL.
- ADR-0014 cascades from this: per-Environment auth credentials are part of the same shape.

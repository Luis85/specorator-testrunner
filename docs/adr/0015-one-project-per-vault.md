---
type: adr
id: ADR-0015
status: accepted
title: One Project Per Vault
date: 2026-05-30
related:
  - "[[Solution Design]]"
  - "[[0006-runner-must-be-ci-compatible]]"
  - "[[0013-sut-modeled-as-named-environments]]"
---

# One Project Per Vault

A Test Hub installation manages exactly one **Project**: one Obsidian vault = one git repo = one `.testrunner/` = one set of Use Cases, Specifications, Suites, Evidence. A user who wants to test two different applications uses two separate vaults.

Multi-project support inside a single vault cascades through every layer: per-project Environments, a project switcher in the UI, per-project file watchers, per-project CI workflows, per-project runner installations, a `Project[]` array in settings, ~10 new backlog stories. The benefit serves a narrow audience — power users with one mega-vault who want to test several applications — at a cost that distorts the V1 design. Users with that need today are already well-served by Obsidian's own per-vault model (vaults open as separate windows; switching is one click).

The plugin defensively rejects loading when it finds a sibling `Test Hub/` folder elsewhere in the vault and surfaces the conflict through `settings.validated` — prevents accidental ambiguity if a user copies another project's content into their vault.

## Considered alternatives

- **Multiple Test Hubs per vault via "projects".** Maximum flexibility. Rejected: cascades through every layer; benefit narrow.
- **One runner, multiple `Use Cases/` and `Specifications/` folders sharing one `.testrunner/`.** Partial isolation. Rejected: ambiguous mental model; tag-based scoping introduces a new kind of namespace that competes with Suites.
- **Allow free relocation of the Test Hub folder** (option 2 in the grilling session). Accepted as part of option 1: the `paths.*` settings already permit relocation within the "one Test Hub" envelope.

## Consequences

- The Settings model stays flat — no `Project[]` array, no per-project section.
- The dashboard has no project switcher; one Active Environment, one runner, one CI workflow per vault.
- The plugin rejects loading on detecting sibling `Test Hub/` folders, with a `settings.validated` error pointing to the conflict. _Amended for V1 — see below._
- Common Test Hub variants (multi-environment, multi-suite, mobile-vs-desktop split) are expressed via Environments and Suite tag expressions, not via projects.
- V2 may relax this if a real demand surfaces; the model can evolve into multi-project without rewriting the runner or CI templates — only the Settings + dashboard would change.

### Amendment (2026-06-09): V1 implements warning-level detection, not rejection

What V1 actually ships (`SettingsService.detectSiblingTestHub`): a sibling/duplicate `Test Hub` folder is surfaced through `settings.validated` as a **WARNING** on `paths.testHubPath` — never a hard error, so the plugin always loads. A warning is the right severity for what this check guards against (an advisory data-hygiene accident: a user syncing/copying another project's content into the vault), and the check itself is advisory — any folder-listing failure is a silent no-op rather than a validation failure.

Matching is deliberately conservative to avoid false positives:

- Only folders that are **siblings** of the configured Test Hub — sharing its parent directory — are considered. This catches both the top-level case and a relocated `testHubPath` (a sync conflict for `QA/Test Hub` lands beside it as `QA/Test Hub copy`); a folder named "Test Hub" under a different parent is ignored.
- A sibling collides only when its base name **equals** the configured folder's base name or differs by a **sync/copy-style suffix** ("Test Hub copy", "Test Hub 2", "Test Hub (1)"). A folder that merely shares a prefix word ("Test Hub Notes") is not flagged.
- The configured folder itself is excluded; only an additional match triggers the warning.

Hard rejection-on-load (the consequence as originally written) is **deferred beyond V1**.

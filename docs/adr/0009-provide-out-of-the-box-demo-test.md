---
type: adr
id: ADR-0009
status: accepted
title: Provide Out-of-the-box Demo Test
date: 2026-05-30
related:
  - "[[Specorator Testrunner]]"
  - "[[Solution Design]]"
  - "[[UC-001]]"
---

# Provide Out-of-the-box Demo Test

The initialization wizard generates a runnable demo: a Use Case (`UC-001 Open Example Page`), a feature, a local static HTML fixture under `.testrunner/src/fixtures/`, step definitions, and the Smoke + Regression suites. The demo runs against `file://` — no internet dependency, no fixture HTTP server.

This decision is the spine of the product promise: the user installs the plugin, clicks **Initialize**, then **Run Demo Test**, and sees green within five minutes. Without a working demo on first run, the onboarding cliff is too steep for the personas the product targets (PO, BA, QA, delivery).

## Considered alternatives

- Skip the demo and ship the plugin empty. Rejected: the user can't verify the install worked without authoring a real test, which contradicts the "works out of the box" goal (PRD G6).
- Demo against a public example URL. Rejected: internet dependency breaks the "works offline" non-functional requirement and introduces third-party flake.
- Demo via an HTTP fixture server. Rejected: an extra process the user must reason about; `file://` is sufficient for the demo scope.

---
type: adr
id: ADR-0010
status: accepted
title: Restrict Custom Shell Commands in V1
date: 2026-05-30
related:
  - "[[Technical Interface Specification]]"
  - "[[Solution Design]]"
---

# Restrict Custom Shell Commands in V1

The plugin spawns only commands that match an allowlist (`npm install`, `npm ci`, `npm run test`, `npm run test:smoke`, `npm run test:ci`, `npx playwright install …`). Arbitrary user-supplied shell commands are not accepted. Working directory is locked to `<vault root>/.testrunner`. Shell metacharacters that imply destructive operations (`rm`, `&&`, `;`, redirects) are rejected by `RunnerExecutionPolicy`.

A plugin that spawns child processes is a soft attack surface: a malicious vault sync, a clipboard-paste of a "helpful" config snippet, or a compromised dependency could otherwise lead to arbitrary code execution under the user's identity. The allowlist is the cheapest mitigation that does not break the legitimate execution paths.

## Consequences

- Power-user runner extensions (custom test scripts, alternative test frameworks) are not possible in V1.
- Settings that previously hinted at "configurable runner commands" (PRD §11) are read-only in V1; revisit if the allowlist proves too restrictive in practice.

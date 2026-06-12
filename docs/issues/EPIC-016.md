---
id: EPIC-016
type: epic
title: Agent Integration via Local MCP
status: proposed
increment: V2-final
stories:
  - "[[US-067]]"
  - "[[US-068]]"
  - "[[US-069]]"
  - "[[US-070]]"
  - "[[US-071]]"
  - "[[US-089]]"
use-cases:
  - "[[UC-034]]"
---

# EPIC-016 Agent Integration via Local MCP

> The plugin's **only** AI surface: one opt-in, local MCP server the user can
> activate. No AI chat, no bundled or BYO-API-key model calls, no AI-generated
> content produced by the plugin itself — all AI work is performed by the
> user's own agents (Claude Code, Copilot, …) *through* the MCP. Alongside
> it: optionally installable, **provider-selectable agent skills** (US-089) —
> static instruction files rendered per provider format, never model calls —
> so each agent learns the hub's workflows natively. Deterministic
> tests remain the output. Deliberately scheduled **last**, so the MCP and
> skills expose a stabilized V2 feature set instead of chasing a moving API.
> New ADR: "Opt-in local MCP exposure; no in-plugin AI runtime."

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *opt-in, last on the roadmap*.

## Outcome

By 2026, natural-language test generation, repair-time healing, and AI
failure triage are table stakes — but every commercial AI-testing competitor
is cloud-bound and quote-priced, locking out privacy-sensitive users. Our
privileged position (proposal §5.2, bet 3) is to be the **spec layer + MCP
surface that the user's own agents plug into**: the vault's Use Cases and
Gherkin are exactly the Markdown spec artifact the Playwright Test Agents /
Spec Kit wave standardized on. After this epic, a user's coding agent can
plan in Use Cases, formulate in Features, implement steps, run suites, and
triage failures through the same loop a human uses — with the plugin itself
never calling a model.

## Stories

| Story | Title | Increment |
| --- | --- | --- |
| [[US-067]] | Local MCP server for the Test Hub | V2-final |
| [[US-068]] | Agent context generation | V2-final |
| [[US-069]] | Step implementation through the MCP | V2-final |
| [[US-070]] | Failure triage through the MCP | V2-final |
| [[US-071]] | Repair-time healing through the MCP | V2-final |
| [[US-089]] | Installable agent skills with provider selection | V2-final |

## Use cases

- [[UC-034]] — Drive the Test Hub from a coding agent via MCP

## Dependencies & sequencing

- Deliberately the **last roadmap item** (proposal §8): the MCP tool surface
  and the skills are derived from the V1/V2 use case catalog, so the feature
  set they expose must be stable first.
- Workflow stories ([[US-069]]–[[US-071]], [[US-089]]) depend on the server
  ([[US-067]]); healing additionally assumes native traces ([[EPIC-013]])
  and triage assumes failure context from [[EPIC-014]].
- Pre-V2 groundwork it assumes (§9): path plumbing hardening (1.5 — the MCP
  server mints paths).

## Definition of done

- ADR "Opt-in local MCP exposure; no in-plugin AI runtime" accepted.
- Server is **off by default**, stdio-based, local-only, and generated into
  `.testrunner` so it also works without Obsidian (CI/agent use).
- Mutations are restricted to the vault's testing folders (path-safety
  policy); run access respects ADR-0018; redaction applies to everything
  served.
- Agent-authored content is always reviewable (drafts/diffs, labeled
  sections) — never auto-committed, and `.feature` business wording never
  changes without explicit confirmation.
- Skills render from one source of truth per provider format, install/
  uninstall cleanly, and degrade to documented command workflows where a
  provider lacks MCP support.
- All six stories accepted; the in-plugin-AI non-goal (§5.3) verifiably
  holds: zero model calls in the plugin.

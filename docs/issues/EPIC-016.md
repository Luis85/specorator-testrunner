---
id: EPIC-016
type: epic
title: Agent Integration via Local MCP
status: proposed
priority: v2-final
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

## Stories rolled up

- [[US-067]] — Local MCP server for the Test Hub
- [[US-068]] — Agent context generation
- [[US-069]] — Step implementation through the MCP
- [[US-070]] — Failure triage through the MCP
- [[US-071]] — Repair-time healing through the MCP
- [[US-089]] — Installable agent skills with provider selection

## Use cases

- [[UC-034]] — Drive the Test Hub from a coding agent via MCP

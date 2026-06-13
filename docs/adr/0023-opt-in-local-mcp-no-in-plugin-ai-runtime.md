---
type: adr
id: ADR-0023
status: accepted
title: Opt-In Local MCP Exposure; No In-Plugin AI Runtime
date: 2026-06-13
related:
  - "[[0010-restrict-custom-shell-commands]]"
  - "[[0018-at-most-one-active-test-run]]"
  - "[[2026-06-11 V2 Research and Proposal]]"
  - "[[2026-06-13-v2-foundational-adrs-design]]"
---

# Opt-In Local MCP Exposure; No In-Plugin AI Runtime

The plugin's only AI surface is one opt-in, local MCP server the user activates; all AI work happens through the user's own agents (Claude Code, Copilot, …) *through* that server (EPIC-016, deliberately last on the V2 roadmap). The plugin itself ships **no in-plugin AI**.

## No in-plugin AI runtime (the explicit no)

No chat UI, no bundled or BYO-API-key model calls, no plugin-generated AI content, and no runtime-AI test steps (Momentic-style runtime interpretation is out). Determinism is the product's moat; runtime AI trades it away. This is a deliberate boundary, recorded so the next contributor does not "add a quick chat box."

## The one AI surface

A single **opt-in, in-plugin localhost HTTP/SSE MCP server**. It runs inside the plugin (Obsidian must be open) so it can route through live plugin services rather than re-reading files. Trust controls are mandatory and scale with the exposure boundary: **token-based auth, localhost-only binding, and explicit per-session opt-in.**

## Exposure boundary: read + write + execute

- **Read** — specs, evidence, scenario history, flakiness, traceability, readiness as MCP resources/tools.
- **Write** — create/update Feature specs and step definitions **through the plugin**, forced through the same structural validation as the editor (`structuralIssues`, the one-argument-per-step and escaped-pipe Gherkin rules), so an agent cannot persist invalid Gherkin.
- **Execute** — trigger runs through the **single-run coordinator (ADR-0018)** and read results/traces: the full agentic loop (write a spec, run it, read the trace, iterate).

## Considered alternatives

- **Standalone `.testrunner` stdio server (agent-spawned, reads vault files).** Rejected for hosting: it cannot see live plugin state or route through the single-run coordinator and validation, so it could not safely offer the execute boundary.
- **Read-only boundary.** Rejected as the target: forgoes the authoring and agentic-loop value that is the point of EPIC-016; the chosen guardrails make write+execute defensible.
- **Read + write, no execute.** Rejected as the target, though it is the natural intermediate milestone.

## Consequences

- This is the **largest trust surface** in the plugin. The execute path leans hard on ADR-0010 (command-safety allowlist) and on the auth handshake; the localhost port is an attack surface the token + binding must contain.
- EPIC-016 stays **last** so the spec, evidence, and history surfaces it exposes have stabilized first. A **read → read+write → execute** staging within EPIC-016 is the build order, each stage gated on its guardrails.
- Writes reuse the application-layer validation, not a parallel path — the MCP is a thin, validated façade over existing services.

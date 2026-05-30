---
type: adr
id: ADR-0007
status: accepted
title: Use Runtime EventBus, Not Full Event Sourcing
date: 2026-05-30
related:
  - "[[Event Catalog]]"
  - "[[Solution Design]]"
---

# Use Runtime EventBus, Not Full Event Sourcing

The plugin uses a single in-process `EventBus` for both domain events and UI-integration events. Events are **not** persisted. State is derived from the vault's Markdown (evidence notes, frontmatter, dashboard tiles) — the Markdown is the durable record.

Event sourcing was considered and rejected for V1: persisted event logs require versioning, replay tooling, and a migration story that is disproportionate to V1's complexity. The Markdown-first principle already gives us a queryable, git-friendly state store with zero infrastructure.

An append-only NDJSON event log under `Test Evidence/events/` remains an option for V2+ if post-hoc analysis becomes valuable (see Event Catalog §16).

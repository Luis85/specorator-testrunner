---
id: EPIC-017
type: epic
title: Discovery & Non-Technical Collaboration
status: proposed
priority: P2
features:
  - "[[FEAT-030]]"
stories:
  - "[[US-072]]"
  - "[[US-073]]"
  - "[[US-074]]"
  - "[[US-075]]"
  - "[[US-081]]"
  - "[[US-082]]"
  - "[[US-083]]"
  - "[[US-093]]"
  - "[[US-097]]"
use-cases:
  - "[[UC-035]]"
  - "[[UC-036]]"
  - "[[UC-037]]"
---

# EPIC-017 Discovery & Non-Technical Collaboration

> Meet POs/BAs where they are: they review, not write, Gherkin. Bridge
> discovery (Example Mapping) → formulation (features) → checklists →
> automation. No competitor connects an example map to executable scenarios.

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P2*.

## Outcome

The #1 BDD abandonment cause is authoring friction: POs resist writing
Gherkin ("too technical"), teams invent near-duplicate steps, and discovery
output never connects to executable specs. This epic closes the whole
pipeline inside the vault: Example Maps capture discovery next to the
requirement and convert agreed examples into draft scenarios; a Step Library
with autocomplete makes the team's vocabulary reusable (the authoring aid
the competitive research ranked best-in-market); a quality lint keeps specs
business-readable; a guided Use Case Editor plus linked Actor/domain entity
notes make well-formed requirements creatable without knowing the house
format; and the checklist on-ramp lets solo devs adopt gradually instead of
all-in BDD.

## Stories

| Story | Title | Priority | Increment |
| --- | --- | --- | --- |
| [[US-072]] | Example Map notes | P2 | V2.x |
| [[US-073]] | Generate scenarios from an Example Map | P2 | V2.x |
| [[US-074]] | Scenario quality lint | P2 | V2.x |
| [[US-075]] | Checklist on-ramp | P2 | V2.x |
| [[US-081]] | Step Library with autocomplete | P2 | V2.1 |
| [[US-082]] | Use Case Editor | P2 | V2.1 |
| [[US-083]] | Linked entity notes (Actors and shared concepts) | P2 | V2.1 |
| [[US-097]] | Runner transparency — show the files behind a Use Case | P2 | V2.x |

## Features

- [[FEAT-030]] — Exploratory Session Notes *(P3, V2.x — story drafted:
  [[US-093]])*

## Use cases

- [[UC-035]] — Facilitate discovery with an Example Map
- [[UC-036]] — Promote a checklist item to an automated Scenario
- [[UC-037]] — Author a Use Case with the guided editor (incl. linked Actor notes)

## Dependencies & sequencing

- [[US-081]]/[[US-082]]/[[US-083]] land in V2.1; the discovery stories
  ([[US-072]]–[[US-075]]) follow in V2.x.
- Pre-V2 groundwork it assumes (§9): single source of structural Feature
  validation (1.10/TD-003 — the quality lint layers rules on it) and the
  focus-preserving editor re-render (1.12/TD-004 — the Use Case Editor and
  the Feature Editor's new lint strip/autocomplete build on it).
- The Step Library indexes typed step definitions, so it assumes
  [[US-052]] ([[EPIC-013]]).
- Entity-note properties stay plain YAML so they remain Bases-queryable
  ([[US-076]], [[EPIC-018]]).

## Definition of done

- Example Map → draft scenario round trip works without overwriting
  anything; drafts are tagged `@draft` and link back to their map entry.
- Step Library view lists steps with usage counts and dead steps; the
  Feature Editor suggests existing steps while editing.
- Use Case Editor round-trips the UC-001 house format losslessly with
  raw-mode fallback; actor/domain fields are pick-or-create entity notes
  with a one-shot, non-destructive migration for existing free-text values.
- Scenario lint follows BRIEF guidance, is configurable, and never blocks
  running.
- All seven stories accepted; Guided Tour (ADR-0020) extended for the new
  authoring workflows.

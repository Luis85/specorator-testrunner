---
id: EPIC-018
type: epic
title: Obsidian-Native Experience
status: proposed
priority: P2
stories:
  - "[[US-076]]"
  - "[[US-077]]"
  - "[[US-078]]"
---

# EPIC-018 Obsidian-Native Experience

> Ride the platform — mobile read access, graph hygiene, queryable metadata —
> while the Test Hub's dashboards remain our **own custom views**. Building
> them on Obsidian Bases was evaluated and rejected for now: the Bases view
> environment is too restrictive for what the dashboards need to do. Custom
> Bases views (`registerBasesView`) are explicitly out of scope and may be
> revisited later.

Proposed in the [V2 Research and Proposal](../proposals/2026-06-11%20V2%20Research%20and%20Proposal.md) §6 — *P2*.

## Outcome

Obsidian power users are a first-class persona: they expect data ownership,
clean vaults, and queryability — and the platform moved favorably under us
(Bases shipped as a core plugin; the community migrated off Dataview). After
this epic, every run/spec/use-case fact lives in typed, documented,
release-stable frontmatter properties — exactly the surface Bases filters
and formulas read — so users build their own `.base` views over Test Hub
data with zero plugin support; dashboards, evidence, and specs are readable
on mobile; and the plugin keeps search, graph, and sidebar clean instead of
polluting the vault.

## Stories

| Story | Title | Priority | Increment |
| --- | --- | --- | --- |
| [[US-076]] | Bases-friendly metadata | P2 | V2.1 |
| [[US-077]] | Mobile read-only degradation | P2 | V2.x |
| [[US-078]] | Vault & chrome hygiene | P2 | V2.1 |

## Dependencies & sequencing

- [[US-076]] is a cross-cutting constraint on the other epics: evidence
  stamps ([[US-060]]), history rollups ([[US-057]]), and entity notes
  ([[US-083]]) must all write the properties it documents — land it in V2.1
  before those surfaces multiply further.
- The ribbon trim itself ships pre-V2 with the V1 release (§9 Phase 0.1);
  [[US-078]] covers the remaining hygiene.
- [[US-077]] starts as an investigation (execution stays desktop-only per
  §2.2); the read-only split is the stretch goal.

## Definition of done

- Property names are documented and stable across releases; dates are
  dates, counts are numbers, links are links; the plugin's own views read
  the same properties (one source of truth); no dependency on Bases or
  Dataview.
- Documentation includes paste-ready `.base` snippets over the documented
  properties.
- All generated artifacts are plain Markdown that renders on mobile; sync
  behavior is documented.
- All artifacts stay under the configured evidence/`.testrunner` folders; no
  stray files at vault root; documented `.gitignore`/Obsidian-exclude
  guidance; new V2 views register without default ribbon icons.
- All three stories accepted.

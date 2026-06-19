---
type: adr
id: ADR-0027
status: accepted
title: Story Map as a PRD-Sibling Overlay
date: 2026-06-19
related:
  - "[[0026-prd-hierarchy-artifact-model]]"
  - "[[0012-use-case-to-feature-is-one-to-many]]"
  - "[[0008-relative-vault-paths]]"
---

# Story Map as a PRD-Sibling Overlay

The **Domain → PRD → Use Case → Feature → Scenario** hierarchy (ADR-0026, ADR-0012) is a single-parent *logical decomposition*. By design it encodes neither **user-journey sequence** (a backbone is an *ordered* narrative; a PRD's `scope_in` is an unordered *set*) nor **release slicing across capabilities** (a slice deliberately mixes Use Cases from *different* PRD branches into one end-to-end increment — the walking skeleton). There was no artifact for either fact. This ADR introduces a **Story Map** to hold exactly those two facts, and fixes *where* it sits and *how* it is represented.

A Story Map is a **sibling overlay to the PRD, not a layer inserted into the tree**. It anchors to the product via a `product` field (a PRD id, e.g. `PRD-000`) and addresses Use Cases **by `UC-NNN` id only** — it never contains or copies Use Case content. The Use Case's `prd-id` (ADR-0026) remains its single, unambiguous parent; the map parents nothing. This keeps **one source of truth**: the map owns *only* the backbone order and slice membership (the two facts that exist nowhere else), and everything renderable (title, status, automation roll-up) is resolved live from the referenced Use Cases.

Story Maps are a **flat set** (not a tree): ids are immutable `SM-NNN`, allocated sequentially, with sibling order carried by a separate `display_order` field. Each map is stored **one folder per map** at `<storyMapsPath>/<id>-<slug>/<id>-<slug>.md` (relative vault paths, per ADR-0008), so a map can grow supporting notes without colliding with siblings.

All Story Map frontmatter uses **only parser-safe forms** — string scalars and block-sequence arrays, **no inline arrays, no block scalars, no literal `null`** (matching ADR-0026) — so the lenient vault parser reads it and Bases can query it. The two new axes are flat lists: `activities` (ordered backbone labels) and `slices` (ordered release bands, first = walking skeleton). Each placement is a single parser-safe **string scalar** `"UC-NNN | activity | slice"` in a `cards` block sequence, so the queryable membership stays flat while still encoding the 2-D coordinate.

The note body carries a **managed grid block** (delimited by HTML-comment markers) rendered from the cards: a Markdown table of slices × activities whose cells are **resolved, aliased wikilinks** `[[<note name>\|UC-NNN]]` — because generated Use Case notes are titled `UC-NNN <Title>.md`, a bare `[[UC-NNN]]` would not resolve (the same resolution the evidence renderer performs). A `Rebuild grid` action regenerates only that block from the authoritative `cards` frontmatter, preserving hand-written body sections.

A Story Map **composes with, and sits above, Example Maps** (EPIC-017): the map selects and sequences the Use Cases for a slice; Example Mapping then drills each selected Use Case into rules/examples that generate scenarios. They share the `UC-NNN` seam and are distinct `type:` values (`story-map` vs `example-map`) — never conflated.

## Considered alternatives

- **A new layer between PRD and Use Case.** Insert Story Map as a fourth containment level. Rejected: it breaks the single-parent invariant ADR-0026/ADR-0012 defend, forces every Use Case to re-home, and still cannot model a slice that spans PRD branches.
- **A pure ephemeral view over existing frontmatter.** Compute the map with no new stored state. Rejected: the two facts a map adds (activity sequence, slice membership) exist nowhere in current frontmatter, and a view can only render data that exists.
- **Embedding/forking storymaps.io.** Rejected: it is AGPL-3.0-only (network copyleft would relicense the whole plugin) and server-dependent (Node + WebSocket + Yjs/LevelDB, no offline mode) — incompatible with the local-first, no-bundled-runtime principles. Its plain JSON/YAML *model* is reimplemented clean-room instead (formats are not copyrightable). See the [Story Mapping Integration proposal](../proposals/2026-06-19%20Story%20Mapping%20Integration%20Research%20and%20Proposal.md).
- **A bespoke drag-drop canvas.** Rejected per the V2 non-goal "no visual/drag-drop builder": the grid renders as a semantic HTML table / Markdown table, and authoring is via structured fields, not a canvas.

## Consequences

- The hierarchy gains **journey sequence** and **cross-capability release slices** without disturbing the single-parent tree — the map is an overlay, `prd-id` stays the one true parent.
- **One source of truth**: the map stores only `UC-NNN` references plus `(activity, slice)` coordinates; broken references are detectable (a future dangling-reference lint can flag a card pointing at a deleted/deprecated Use Case).
- A new `storyMapsPath` setting (default `Story Maps/`) and `storymap.created` / `storymap.deleted` domain events are added (ADR-0028 adds `storymap.updated` for rich-card authoring); the feature mirrors the PRD vertical slice (entity → content → service → builder → explorer) end to end.
- Optional interop: because the model is a clean-room reimplementation of a plain JSON/YAML schema, a later import/export adapter could round-trip with storymaps.io's YAML/CLI.

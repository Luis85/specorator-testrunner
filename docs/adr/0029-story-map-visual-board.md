---
type: adr
id: ADR-0029
status: accepted
title: Story Map Visual Board
date: 2026-06-19
related:
  - "[[0027-story-map-prd-sibling-overlay]]"
  - "[[0028-story-map-rich-model]]"
---

# Story Map Visual Board

ADR-0028 rendered a Story Map as a Markdown table in the note and made authoring
"edit frontmatter + rebuild"; the V2 proposal listed "no visual/drag-drop
builder" as a non-goal. The product owner has decided a **storymaps.io-style
interactive visual board** is the primary surface for working a map.

This ADR supersedes ADR-0028 §Rendering's "no canvas" stance and overrides that
non-goal **for Story Maps only**. The Markdown note frontmatter remains the
single source of truth; the board is an editable view over it, and the managed
Markdown table is **kept**, regenerated on every board edit so the note stays
readable/diffable and works on mobile / without the plugin.

The board renders in the **main workspace view** (not the sidebar). It is built
on **SVG/DOM** (not a canvas engine): SVG keeps per-element DOM (events,
accessibility, Obsidian CSS theming, native inline text editing) while allowing
vector zoom/pan. Card/column/slice geometry and all edit operations live in
**pure, unit-tested modules** behind a thin `ItemView`.

Phased work adds the plugin's **first runtime dependencies**, recorded here;
each is small, permissive, and version-pinned. P1 (read-only board) added none.

**P2 spike outcome (drag library).** The design first chose
`@atlaskit/pragmatic-drag-and-drop` (Apache-2.0). The P2 spike retired that
choice: Pragmatic-DnD — like native HTML5 drag-and-drop — requires an
`HTMLElement`, but the board renders cards as SVG `<rect>`s (`SVGRectElement`),
so neither can attach to them. P2 therefore adopts **`interact.js`** (MIT), a
**pointer-event** library that works on SVG and, being pointer-based, is also
robust over the CSS-transformed (zoomed) surface P5 introduces — so it doubles
as the drag substrate for later phases. It is the spec's named fallback. The
drag library is isolated behind a one-function adapter
(`story-map-board-dnd.ts`), the sole importer, so it stays swappable.

**P5** will add `panzoom` (MIT) for zoom/pan.

## Considered alternatives
- **Keep the table-only model (ADR-0028).** Rejected by the product owner: the
  visual board is the requested experience.
- **Canvas/WebGL engine (Konva/Fabric/PixiJS) or a diagram engine
  (maxGraph/X6).** Rejected: canvas loses native text editing/theming and a
  generic diagram model fights a fixed column/row grid; SVG/DOM + two micro-libs
  is the smallest, best-fitting substrate (see the 2026-06-19 library research).

## Consequences
- The board supersedes the table as the primary authoring surface; the table is
  a kept, always-in-sync secondary rendering.
- All board logic is pure and tested; the `ItemView` stays thin (complexity gate).
- The plugin gains its first runtime dependency in P2 (`interact.js`) and a second
  in P5 (`panzoom`); both sit behind thin, swappable adapters.
- Zoom/pan and focus are ephemeral view state, never written to the note.
- P3 widens `saveMap` to persist the whole structure (not just cards) under a
  whole-map signature baseline (optimistic concurrency), so the board can reorder
  activities/slices; the note frontmatter stays the single source of truth.

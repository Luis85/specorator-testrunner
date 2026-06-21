---
type: adr
id: ADR-0030
status: accepted
title: Story Map Cards and Personas as First-Class Notes
date: 2026-06-20
related:
  - "[[0027-story-map-prd-sibling-overlay]]"
  - "[[0028-story-map-rich-model]]"
  - "[[0029-story-map-visual-board]]"
---

# Story Map Cards and Personas as First-Class Notes

ADR-0028 encoded cards as a nine-field pipe-delimited scalar in the Story Map
note's `cards` frontmatter list. This was sufficient for a Markdown-table
rendering, but the interactive board (ADR-0029) introduced a new requirement:
**a card carries a hand-written body** (description, acceptance notes, links) that
a board save must never overwrite. A board save carries only placement and
planning attributes — it has no body to write back. Keeping cards in the map's
frontmatter would silently destroy that body on every save.

This ADR supersedes the inline `cards` encoding of ADR-0028 and formalises the
note-backed model that was implemented in its place. Personas (the `users` lane
audience chips, previously plain strings) are extended by the same logic: a
persona is a reusable library artifact that merits its own note.

## Decisions

**1. Cards are their own notes.** Each Story Map card persists as a separate
`type: story-map-card` note under the owning map's `cards/` folder, e.g.
`Story Maps/SM-001-end-to-end-authoring/cards/SMC-001-search-by-name.md`. The
card note's frontmatter carries placement (`activity`, `step`, `slice`, `order`)
and all planning attributes (`card_type`, `status`, `points`, `tags`, `color`,
`title`, `ref`). Its Markdown body is free text and is **never touched by the
board save path**. The map note's `cards` frontmatter field is removed entirely;
the map note holds only structure (activities, steps, slices, users). On every
read `loadCards` scans the `cards/` folder into the board model; on every board
save `reconcileCards` upserts the desired notes and deletes the notes of removed
cards — preserving each note's hand-written body via `readBody` before
rebuilding the frontmatter.

**2. Card ids are allocated client-side.** `addCard` assigns the `SMC-NNN` id
to a new card immediately (in the pure domain layer), rather than waiting for a
disk write. This is necessary because the board suppresses the `storymap.updated`
event tagged with its own origin, so it never reloads its own save. If the id
were assigned only at write time, the board's in-memory card would remain id-less;
the next save's `storyMapSignature` baseline would diverge from the now-id'd
on-disk card and produce a false stale conflict, dropping the edit. An
already-stale board (baseline mismatch from another editor) reloads before any
save lands, so id collision between concurrent sessions is impossible.

A monotonicity invariant is enforced on top of this: `addCard` accepts a
`reservedIds` list — every `SMC-NNN` the board has seen in its session, including
ids of cards deleted before the debounce save fires. The id counter is seeded
past those reserved ids so a freed id is never re-minted within a session.
Without this guard, deleting the highest-numbered card then immediately adding
one would reuse the freed id; `reconcileCards` would graft the deleted note's
body onto the new card and skip the deletion, producing ghost content.

**3. Card types drive the colour legend.** Each card carries a `card_type`
field from a fixed set of five — `task`, `note`, `question`, `edge-case`,
`design` — each mapped to a distinct pastel colour via `CARD_TYPE_COLORS`
(yellow, blue, green, pink, purple respectively, matching storymaps.io). The
board renders cards as pastel sticky-notes with dark ink for contrast and
displays a static Legend showing all five types. An optional `color` override
field on the card overrides the type colour for individual cards. The card-type
picker is exposed in the card modal (`StoryMapCardModal`).

**4. Create-time rollback respects pre-existing folders.** When creating a map
that reuses a folder (e.g. a prior failed create left it), `cards/` may already
exist. The `cardsDirPreexisted` flag is captured before `reconcileCards` runs so
that if the initial-card write fails, rollback only deletes a `cards/` folder
**this create attempt created** — it never deletes a pre-existing `cards/`
that may hold unrelated notes.

**5. Personas are a shared library.** Each entry in the map's `users` lane is a
reference to a `type: persona` note (`PER-NNN`) stored at the shared `personasPath`
(default `Personas/`). Personas are reusable across maps. On create and on every
board save, `ensurePersonas` materialises a persona note for each user name as a
best-effort side-effect; a failure is logged but does not fail the map write.

## Consequences

- The `cards` frontmatter field is removed from Story Map notes (clean break;
  the inline nine-field codec is deleted). Boards and grids read from the composed
  `cards/` folder; the managed Markdown table is re-sourced from the same read
  model and stays in sync.
- Card notes are queryable via Dataview/Bases by `type: story-map-card`; they
  carry a `map` field for the owning map's id.
- Each card carries a hand-written Markdown body that survives board saves,
  enabling description and acceptance notes per card.
- Ids are stable across the board session; the monotonicity invariant prevents
  id reuse within a session even across the debounce window.
- Personas become a shared, Bases-queryable library (`Personas/PER-NNN-*.md`),
  enabling reuse across maps and persona-level notes (goals, context).
- The plugin's existing `KeyedSerialQueue` per-path serialisation carries over
  to card-note writes so concurrent board edits never race on the same file.

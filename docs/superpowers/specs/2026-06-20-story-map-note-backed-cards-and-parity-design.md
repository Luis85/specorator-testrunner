# Story Maps: Note-Backed Cards & storymaps.io Parity — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorming) — pending implementation plan
**Branch:** `claude/storymaps-prd-tooling-k9tpnx` (PR #68)
**Supersedes (in part):** ADR-0028 (inline rich-card encoding) — to be recorded in a new ADR-0030.

## 1. Summary

This pass makes every Story Map **card** and every **user/persona** a first-class
vault note (frontmatter + markdown body), brings the interactive board view to
**visual parity** with storymaps.io, and gives the Story Maps **side panel**
(explorer view) a dedicated polish. It remains **local-only and single-user** —
no collaborative features.

Three workstreams:

1. **Data model** — cards and personas become notes; the card-note is the source
   of truth for its placement and attributes; personas are a shared, reusable
   library; the inline `cards`/`users` frontmatter model is removed (clean break).
2. **Board visual parity** — typed/colour-coded cards + Legend, story-point and
   tag chips, per-slice progress + points roll-up, and a USERS lane rendered as
   persona cards. Canvas zoom/pan and focus mode (P5) are **deferred** to a later
   pass.
3. **Side panel redesign** — native styling, status pills, an icon stat-strip,
   and decluttered actions.

## 2. Decisions (locked)

| # | Decision |
|---|----------|
| D1 | A card-note is a **new note type** `type: story-map-card`, distinct from a Use Case. It optionally references a Use Case via `ref` (`UC-NNN`). ADR-0027/0028 separation (planning placement ≠ tested spec) is preserved. |
| D2 | The journey **structure** (activities, steps, slices) stays as Story Map frontmatter — only *cards* and *users* become notes. |
| D3 | **Personas** are a **shared library** at a new `personasPath` (default `Personas/`). A map holds an ordered list of persona **refs** for its USERS lane. |
| D4 | The **card-note is the source of truth**. Cards live in the owning map's `…/cards/` folder; folder membership defines the map's card set. The Story Map note **no longer carries a `cards` list**. |
| D5 | IDs follow the existing global-sequential convention: **`SMC-NNN`** for cards, **`PER-NNN`** for personas (mirroring `UC-NNN`/`PRD-NNN`/`SM-NNN`). |
| D6 | **No migration tooling. Clean break:** the inline `cards`/`users` code paths are removed entirely; the board reads only note-backed cards + persona refs. The single existing demo map (SM-001) is recreated in the new model; inline-format fixtures are rewritten. |
| D7 | **Parity scope:** visual parity only this pass (dark-theme polish, typed cards + Legend, point/tag chips, per-slice progress + points, USERS lane as persona cards). **Zoom/pan + focus mode + control cluster (P5) are deferred.** |
| D8 | `card_type` drives the card colour via the Legend; an optional `color` override field remains but is no longer primary. |
| D9 | The Legend is a **fixed set of five types** this pass (`task`, `note`, `question`, `edge-case`, `design`); an editable/custom legend is a future pass. |
| D10 | The **in-note managed grid block is kept**, but re-sourced from the composed read-model (it renders card-notes as the markdown table). |
| D11 | The side panel **may** include a lightweight **Personas** section listing the shared library; included only if it stays simple. |

## 3. Vault layout

```
Story Maps/
  SM-001-end-to-end-authoring/
    SM-001-end-to-end-authoring.md      # map note: identity + structure + user refs
    cards/
      SMC-001 search-by-name.md          # type: story-map-card
      SMC-002 ingredients-list.md
      …
Personas/
  PER-001 home-cook.md                   # type: persona (shared, reusable)
  PER-002 content-creator.md
```

A map's folder is self-contained (its cards live under it). Personas are shared
across maps.

## 4. Note schemas (parser-safe: block sequences, no inline arrays)

### 4.1 Card-note (`type: story-map-card`)

```yaml
type: story-map-card
id: SMC-001
map: SM-001            # owning map id (folder implies it; explicit for queryability/repair)
card_type: task        # task | note | question | edge-case | design  → drives Legend colour
status: planned        # planned | in-progress | done | blocked
points: 3              # optional non-negative integer (fractional rejected)
tags:                  # optional block sequence
  - frontend
ref: UC-003            # optional UC-NNN link (single source of truth still holds)
color: ""              # optional explicit colour override (usually empty; type drives colour)
activity: Find & Cook Recipes
step: Browse Recipes   # optional (empty for no-step activities)
slice: MVP
order: 0               # ordering within its cell (activity×step×slice)
title: Search by name  # free text
```

Body = free markdown (description / acceptance notes / links). A real note.

**Validation** (mirrors current rules): unknown `card_type`/`status` reject or
fall back to a default; `points` must be a non-negative integer (fractional
rejected, not truncated); `ref` must match `UC-NNN` shape (invalid refs rejected);
`activity`/`slice` required, `step` optional and filtered against the normalised
backbone.

### 4.2 Persona-note (`type: persona`)

```yaml
type: persona
id: PER-001
name: Home Cook
color: ""              # optional, for the USERS-lane card
```

Body = persona description (goals, context). Reusable across maps.

### 4.3 Story Map note (after clean break)

```yaml
type: story-map
id: SM-001
title: End to End Authoring
status: draft
product: PRD-000
users:                 # ordered persona refs (PER-NNN) for the USERS lane
  - PER-001
  - PER-002
activities:
  - …
steps:
  - …
slices:
  - …
display_order: 0
# NO `cards` field; NO inline `users` strings
```

## 5. Read-model composition

`StoryMapService` composes the `StoryMap` read-model the board and grid consume:

1. Parse the map note frontmatter → identity + structure + ordered persona refs.
2. Scan `…/cards/*.md` (recursive, best-effort, filtered by `type: story-map-card`)
   via the existing `collectReadableMarkdown` pattern → `StoryMapCard[]`, each
   carrying its `id` (`SMC-NNN`).
3. Resolve `users` refs against the persona library → `Persona[]` (id, name,
   colour); unresolved refs are surfaced (not silently dropped).

The `StoryMap` entity the renderers receive keeps a shape close to today (a
`cards` array + resolved `users`), so **the board and grid renderers change their
*source*, not their *shape*.** `StoryMapCard` gains `id` and `cardType`; `users`
becomes resolved personas rather than plain strings.

## 6. Mutations (per-note CRUD)

All card writes serialise through a `KeyedSerialQueue` keyed by **card-note path**;
persona-library and map-note writes keep their existing per-path serialisation.

| Action | Behaviour |
|--------|-----------|
| Add card | Allocate `SMC-NNN`, write a card-note in the map's `cards/` folder with placement + attributes; board re-reads. |
| Move card (drag) | Update the moved card-note's `activity`/`step`/`slice`/`order`. |
| Edit card (modal) | Update the card-note's attributes; `expected`-style stale guard keyed on the card id. |
| Delete card | Delete the card-note. |
| Add user | Pick an existing persona from the library **or** create a new `PER-NNN` persona note; append its ref to the map's `users`. |
| Reorder / remove user | Update the map's `users` ref list. |

The board's save loop changes from "rewrite the map's `cards` list" to
"upsert/delete the affected card-note(s)"; the conflict/abort semantics fixed in
`cb2585e` carry over.

## 7. Board view — visual parity (P5 deferred)

- **Typed cards + Legend.** Card background derives from `card_type`
  (`task`=yellow, `note`=blue, `question`=green, `edge-case`=pink, `design`=purple,
  matching storymaps.io). A **static** Legend block shows the five types + colours.
- **Chips.** A story-point chip (dot + number) and tag chips per card; the UC
  `ref` renders as a small aliased link/badge.
- **Per-slice roll-up.** Each slice row shows progress (done/total cards) and a
  points sum (the "14/14 · 30 pts" treatment).
- **USERS lane as persona cards.** Each persona renders as a card in the top lane
  with a `+ user` affordance beneath (replacing today's single
  `**Users:** a · b` line).
- **Polish.** Dark-theme-aware styling on the existing CSS-var system; restyle the
  existing `+ card` / empty-cell affordances to match.
- **Out of scope (deferred P5):** canvas zoom/pan, focus mode, and the
  bottom-right control cluster (zoom %, theme, Legend/Notes/Log panel).

## 8. In-note managed grid block

Kept, but re-sourced from the composed read-model: it renders the card-notes as
the markdown table (with resolved UC wikilinks and per-slice points) and stays a
useful reading-view / Bases summary. It no longer reads inline scalars.

## 9. Side panel (explorer) redesign

- Native `nav-header` styling; "New Story Map" as the primary CTA.
- Each map as a clean row: title + muted `SM-NNN`, a **status pill**, a compact
  **icon stat-strip** (users / activities / steps / slices / cards), and the
  product link.
- Actions decluttered: primary **Open board**; an overflow **⋯** menu for
  Refresh tables / Delete (replacing today's flat inline button row).
- Friendly **empty state** + CTA; proper hover/selection states.
- Optional lightweight **Personas** section listing the shared library (D11).

## 10. Clean-break removals

- The inline 9-field `encodeCard`/`parseCard` codec and the `cards` frontmatter
  path.
- The `users` string-list path on the map note.
- Any UI, content, and tests that depend on the inline encoding.

New code replaces these with the note schemas (§4), composition (§5), and CRUD
(§6).

## 11. Testing

- **New tests:** card-note and persona parse/build; `SMC-`/`PER-` id allocation;
  read-model composition (folder scan + ref resolution, incl. unresolved refs);
  colour-by-`card_type`; per-slice points + progress roll-up; users-as-cards
  rendering; side-panel row rendering (status pill, stat-strip, actions).
- **Rewrites:** inline-format fixtures and the many inline-card tests across the
  suite convert to note-backed equivalents.
- The board *view* itself stays untested at the unit level (consistent with the
  project's test-the-pure-logic pattern); its logic lives in pure modules
  (`board-layout`, `board-scene`, and new composition/colour/roll-up helpers)
  which **are** tested.
- The full-suite + coverage + fallow-audit gate is held green.

## 12. Docs

- **CONTEXT.md** glossary: add `story-map-card` note, `persona` note,
  `personasPath`; update the Story Map Card entry (no longer an inline scalar).
- **ADR-0030** (new): "Story Map cards and users as first-class notes" — records
  D1–D11 and marks the inline-encoding portions of **ADR-0028** superseded.
- Recreate the SM-001 demo map in the new model (fixture / manual data).
- Settings: add `personasPath`; include it in the reset content-path guard
  (mirrors the existing Story Maps guard).

## 13. Sequencing (becomes plan phases)

- **A — Data model:** card-note & persona entities + content (build/parse),
  `SMC-`/`PER-` id allocation, `personasPath` setting + reset guard.
- **B — Service + clean break:** read-model composition (scan + resolve), card &
  persona CRUD, removal of inline paths, fixture/test rewrite.
- **C — Board parity:** render from the new model; typed-card colours + Legend;
  point/tag chips; per-slice progress + points; USERS lane as persona cards.
- **D — Grid re-source:** in-note managed grid block renders from the read-model.
- **E — Side panel:** explorer redesign (pills, stat-strip, actions, empty state,
  optional Personas section).
- **F — Docs & demo:** CONTEXT.md, ADR-0030, recreate SM-001.

## 14. Non-goals (this pass)

- Canvas zoom/pan, focus mode, control cluster (P5 — separate pass).
- Editable/custom Legend types.
- Any collaborative / multi-user / cloud-sync features.
- Migration tooling for inline-format maps (clean break instead).

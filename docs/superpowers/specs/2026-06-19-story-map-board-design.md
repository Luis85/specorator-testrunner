# Story Map Visual Board — Design

_Date: 2026-06-19. Status: proposed (awaiting review → implementation plan)._

A storymaps.io-style **interactive visual board** for Story Maps, rendered in the
**main workspace view** as the primary surface for working a single map. The
sidebar **Story Maps explorer stays** as the map list / launcher (it gains an
"Open board" action); the board is the per-map editing surface. The Markdown note
frontmatter stays the single source of truth; the board is a rich, editable view
over it.

This **reverses two earlier decisions** and therefore needs a new ADR
(**ADR-0029**, drafted as part of P1):

- ADR-0028 §Rendering ("render the grid as a Markdown table … no canvas;
  authoring by editing frontmatter + rebuild"). The board supersedes this as the
  primary authoring surface; the Markdown table is **kept** as a secondary,
  always-in-sync rendering.
- The V2 non-goal "No test recorder / visual test builder" / "no drag-drop
  builder" — explicitly overridden by the product owner for Story Maps.

ADR-0029 also records the first **runtime dependencies** the plugin takes on (it
has had none): see §7.

## 1. Goal & scope

A `StoryMapBoardView` (Obsidian `ItemView`, main area) that renders one map as a
zoom/pan board: a **users/personas lane** on top, **columns** = activities → their
steps, **rows** = release slices, **card tiles** in the (column, slice) cells with
title, status, points, tags, and color. Full storymaps.io interaction parity:
drag cards between cells, drag-reorder columns/rows, inline-edit cards, recolor,
add/remove structure on the board, infinite zoom/pan, and focus mode.

**In scope (this spec):** everything above, delivered in phases P1–P5 (§9).
**Deferred to a follow-up spec:** **partials** (reusable card-group templates) —
the highest-cost, lowest-certainty feature; it needs its own storage design and
must not block the board. (Recommended deferral; flag for the reviewer.)

## 2. Substrate (decided)

SVG/DOM, no rendering framework, plus two small permissive libraries:

- **`panzoom`** (anvaka, MIT, ~6 KB gzip) — zoom/pan over the board's SVG/DOM
  root; exposes the current transform so drag hit-testing can compensate for
  scale.
- **`@atlaskit/pragmatic-drag-and-drop`** (Atlassian, Apache-2.0, ~5 KB gzip) —
  headless, framework-agnostic drag/drop for cards and column/row reordering.
  - **Risk to retire in P2 first:** it builds on the native HTML drag-and-drop
    API, which can behave oddly over a CSS-transformed (zoomed) surface. P2
    begins with a spike; if it misbehaves under transform, fall back to
    pointer-based **`interact.js`** (MIT). The board's drag logic is isolated
    behind our own pure target-resolution module (§4), so the library is a thin,
    swappable adapter.

Rejected: tldraw/GoJS/JointJS+ (license), Excalidraw/React-Flow/Svelte-Flow
(framework), Konva/Fabric/PixiJS (canvas → no structured-board model, DOM-overlay
text editing, larger bundle), maxGraph (~170 KB, verbose, pre-1.0). See the
2026-06-19 library research in the session record.

## 3. Architecture

The view is a **thin renderer + event wirer**; all logic lives in pure,
unit-tested modules. This is mandatory: views get no unit tests (AGENTS.md), and
the blocking fallow complexity gate would otherwise flag an interactive view.

| Layer | Module | Responsibility |
| --- | --- | --- |
| domain | `story-map.ts` (extend) | **Pure board ops** over `StoryMap`: `moveCard`, `reorderCardInCell`, `reorderActivity`/`reorderStep`/`reorderSlice`, `recolorCard`, `editCard`, `editUsers`, `addCard`/`addActivity`/`addStep`/`addSlice`/`remove*`. Each returns a new `StoryMap`. |
| presentation | `story-map-board-layout.ts` | Pure scene geometry: `StoryMap` → column x-ranges (activities→steps), row y-ranges (slices), card rects, users-lane rects. Plus **hit-testing** and **drag-target resolution** (board point → cell / column / row). |
| presentation | `story-map-board-viewport.ts` | Pure zoom/pan math: clamp, fit-to-content, focus-to-region (used by focus mode); converts pointer deltas by scale. |
| presentation | `story-map-board-scene.ts` | Pure: layout → a list of SVG element **specs** (tag + attrs + text), so the rendered scene is testable as data, not DOM. |
| presentation | `story-map-board-view.ts` | The `ItemView` (main area): builds SVG from the scene specs, wires `panzoom` + Pragmatic-DnD to the pure modules, owns the in-memory working model and the debounced save. |
| application | `story-map-service.ts` (extend) | **`saveMap(id, model)`** — persist the whole map (§5). |
| wiring | `register-views`, `main`, `register-commands`, explorer | Register the main-area view; "Open board" on each explorer row + a command/ribbon; open with the map id in view state. |

No new persisted data model: the board edits the existing `StoryMap` fields.
Zoom/pan and focus are **ephemeral view state** (kept in the leaf's view state,
never written to the note).

## 4. Interactions

| Interaction | Pure op | Persist |
| --- | --- | --- |
| Drag card → another cell | `moveCard(model, cardIndex, activity, step, slice, indexInCell)` (target via `layout` hit-test, scale-compensated) | debounced `saveMap` |
| Reorder card within a cell | `reorderCardInCell` | debounced |
| Drag column header | `reorderActivity` / `reorderStep` | debounced |
| Drag row header | `reorderSlice` | debounced |
| Inline edit (title + small attribute/color popover; double-click → full card modal) | `editCard` / `recolorCard` | on commit (blur) |
| Edit users lane | `editUsers` | on commit |
| `+` add card / column / row | `addCard` / `addActivity` / `addStep` / `addSlice` | immediate |
| Zoom (wheel toward cursor), pan (drag empty), fit/reset | `viewport` | none (ephemeral) |
| Focus mode (isolate/zoom an activity) | `viewport.focusToRegion` + dim others | none (ephemeral) |

## 5. Persistence: `saveMap(id, model)`

Generalizes the existing `writeCards`/`rebuildGrid` pipeline. Under
`STORY_MAP_MUTATE_KEY`:

1. Re-read the note (CRLF-safe normalize, as `rebuildGrid` does).
2. **Validate** the model: every card via `validateCardPlacement` against the
   normalized axes; labels parser-safe; reject otherwise (`Result` error).
3. Rewrite the `users` / `activities` / `slices` / `steps` / `cards` frontmatter
   via `updateNoteFrontmatter`, **preserving** hand-written body sections.
4. **Regenerate the managed grid block** (`renderStoryMapGridTable`) so the
   in-note Markdown table stays in sync for free.
5. Write; publish `storymap.updated`.

On failure the view shows a `Notice` and **reverts** to the last-saved model.
Debounced (~300 ms) so a drag/inline-edit burst yields one write.

**Self-event guard:** `saveMap` publishes `storymap.updated`, which the board
also listens to (to reflect external edits). The board ignores updates it
caused (track the last-saved revision / its own write) and reloads only on
*external* `storymap.updated` when not mid-edit; `storymap.deleted` closes the
board. (Detailed in the plan; a revision counter on the model is the likely
mechanism.)

## 6. Error handling · testing · accessibility

- **`Result`-based** saves; revert-on-failure; `renderLoadError` on load failure;
  no throws across boundaries.
- **Concurrency:** `saveMap` serializes under the mutation lock with the card
  modals / rebuild / delete (re-read under lock; abort if the note was deleted).
- **Testing:** `layout`, `viewport`, `scene`, and the domain `ops` are pure and
  **heavily unit-tested** (geometry, hit-testing, reorder, scene specs, save
  validation). The `ItemView` stays thin (delegates everything) → passes the
  complexity gate. `saveMap` tested for frontmatter rewrite, table regen, CRLF
  safety, validation, and the event.
- **Accessibility:** SVG nodes carry `role`/`aria-label`; a keyboard path
  (focus a card, arrow-keys move, Enter edit) is a dedicated late sub-phase
  (storymaps.io is mouse-first). Board themed via Obsidian CSS variables.
- **Mobile:** desktop-first (consistent with the plugin); the board degrades to
  the read-only note table on mobile.

## 7. Dependencies (new — first runtime deps)

`package.json` gains `panzoom` and `@atlaskit/pragmatic-drag-and-drop`, bundled
by esbuild into `main.js` (~11 KB gzip total). ADR-0029 records the rationale,
the licenses (MIT / Apache-2.0), and the supply-chain posture (pin versions;
both are small and auditable). This is a deliberate departure from the
zero-runtime-deps posture, justified by the board scope.

## 8. New/changed files (summary)

New: `story-map-board-layout.ts`, `story-map-board-viewport.ts`,
`story-map-board-scene.ts`, `story-map-board-view.ts` (+ tests for the first
three and the domain ops); `docs/adr/0029-story-map-visual-board.md`.
Changed: `story-map.ts` (board ops), `story-map-service.ts` (`saveMap`),
`register-views.ts` / `main.ts` / `register-commands.ts` / the explorer (open
the board), `styles.css` (board theme), `package.json` (deps), CONTEXT.md (board
term), README.

## 9. Phasing (each increment ships gate-green)

- **P1 — Read-only board + ADR.** SVG board (users lane + activity/step columns +
  slice rows + card tiles + colors), opened in the main view from the explorer
  ("Open board"). Pure `layout`/`scene` + tests. ADR-0029. **Ships the visual
  board.**
- **P2 — Drag cards + `saveMap`.** Pragmatic-DnD spike first; `moveCard` /
  `reorderCardInCell`; debounced `saveMap`; self-event guard.
- **P3 — Reorder & edit structure on the board.** Reorder activities/steps/slices;
  add/remove cards/columns/rows.
- **P4 — Inline editing + color.** Inline title + attribute/color popover; reuse
  the card modal for full edit.
- **P5 — Zoom/pan + focus mode.** `panzoom` wiring; fit/reset; focus to activity.
- **(Follow-up spec) Partials.** Reusable card-group templates + storage.

## 10. Risks / open questions

1. **Pragmatic-DnD over a zoomed canvas** — retire in the P2 spike; interact.js
   fallback.
2. **`saveMap` whole-frontmatter rewrite** vs concurrent hand-edits — the mutation
   lock + read-under-lock + debounce mitigate; single-user makes conflicts rare.
3. **Self-`storymap.updated` loop** — the revision-guard must be airtight so a
   save doesn't trigger a reload that drops an in-flight edit.
4. **Partials deferral** — confirm with the reviewer that P6 is out of this spec.

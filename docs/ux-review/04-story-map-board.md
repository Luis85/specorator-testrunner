# UX/Design Review 04 — Story Map Board & Satellites

**Scope:** the Story Map Board (the interactive SVG/DOM authoring surface, ADR-0029)
and its satellites — the Story Map Card Modal, Story Map Builder Modal, Story Map
Explorer view, and Story Map Settings Modal. Read against CONTEXT.md and ADR-0027/
0028/0029/0030. Mandate: a **bold redesign**, "native + light identity", with the
board as one of the three highest-weighted focus areas, and ADR-0029's remaining
phase being **zoom/pan + focus mode** (panzoom, not yet built).

Language used throughout: Story Map, Backbone, Release Slice, Story Map Card, Card
Type, Persona, Planning Status, Story Map Board.

---

## 1. Current state — the board & every interaction available today

### 1.1 The canvas

The board renders in the **main workspace view** as a single flat `<svg>` whose
`viewBox`/`width`/`height` are the full computed content size
(`story-map-board-view.ts:767-778`). The container is a plain scroll box
(`styles.css:1272 .sm-board-container { overflow:auto }`). There is **no zoom, no
pan transform, no fit-to-screen, no minimap, no focus mode** — `getScreenCTM` math
exists (`story-map-board-view.ts:993-1006`) but is "identity-ish at P2"; the whole
board is one tall, wide, scrollable bitmap-like vector. The grep for
`panzoom|minimap|fit-to|focus` finds **only the layout module** (a `BoardPoint`
comment promising "pan/zoom math arrives in P5"), confirming the phase is unbuilt.

Geometry is pure and fixed-pixel (`story-map-board-layout.ts:10-48 BOARD_METRICS`):
`colWidth:200`, `cardHeight:56`, `rowHeaderWidth:140`, `laneHeight:40`, etc. Layout
is computed once per paint; the scene is a flat list of `SvgNodeSpec`s
(`story-map-board-scene.ts`), rendered recursively by a thin `appendSpec`
(`story-map-board-view.ts:783-788`). The ItemView is genuinely thin — all geometry,
hit-testing, and edit ops live in pure tested modules (`story-map-board-layout.ts`,
`story-map.ts`), which is exactly the ADR-0029 invariant.

Structure top-to-bottom: a **users (Persona) lane** (`usersLaneSpecs`), **activity
group headers**, **step (column) headers**, **slice row headers** with a per-slice
roll-up (done/total + points + a thin progress bar, `sliceProgressSpecs`), the
**card tiles**, per-cell `+ card` affordances, the `+ activity`/`+ slice`/`+ step`/
`+ user` add controls, and a **static Card Type legend** band at the very bottom
(`legendSpecs`, `story-map-board-scene.ts:248-268`).

### 1.2 Card rendering

Each card is a `<g class="sm-board-card-group">` at absolute coordinates
(`cardGroupSpec`, `story-map-board-scene.ts:127-177`). It carries: a pastel fill
(type colour from `CARD_TYPE_COLORS`, or per-card `color` override —
`story-map-board-layout.ts:113`), a bold **title** in fixed dark ink (`#1a1a22`,
because pastels stay light in both themes — `styles.css:1325-1333`), an optional
**ref** line (`UC-NNN`, raw text — see pain points), a **points chip** + one chip
per **tag** (`chipSpecs`), a hover-revealed **remove ×**, **edit ✎**, a clickable
**colour swatch** (bottom-left), and a clickable **status chip** showing the
Planning Status or `—`. Card box is 56px tall × ~184px wide — cramped: title +
ref + chips + swatch + status all share that box.

### 1.3 Interactions available today

- **Inline title rename:** double-click a card (or Enter/F2 when focused) →
  `<input>` in a `<foreignObject>` over the tile (`onEditCardTitle`,
  `mountInlineEditor`, `story-map-board-view.ts:684-693`).
- **Swatch cycle:** click the swatch → `nextColor` advances a hardcoded 6-colour
  palette, wrapping to "" (clear) (`onCycleColor`, `CARD_PALETTE`
  `story-map-board-view.ts:210-219`). Keyboard: `c`.
- **Status cycle:** click the status chip → `nextStatus` cycles
  planned→in-progress→done→blocked→"" (`STATUS_CYCLE:212`). Keyboard: `s`.
- **Full edit:** click ✎ → `StoryMapCardModal` (points, tags, ref, card type,
  colour, coordinate dropdowns, **Promote to Use Case**). The board flushes its
  pending save first, then the modal's `updateCard` republishes `storymap.updated`
  which the board reloads (`openCardEditor:709-724`).
- **Card drag-and-drop:** drag a card to any (activity, step, slice) cell; live
  translate follows the pointer, a transient overlay highlights the target cell +
  an insertion line (`onCardDragMove`, `paintDropCell:836-862`). Keyboard: arrows
  move a focused card cell-to-cell (`neighborCell`).
- **Structure DnD:** drag activity / slice / step headers to reorder (insertion
  line preview, `onHeaderDrop`/`onStepDrop`). Steps only reorder within their own
  activity.
- **Create structure:** `+ activity`, `+ slice`, `+ step` (per activity), `+ card`
  (per cell), `+ user` — all insert a placeholder renamed in place.
- **Rename structure:** double-click any header (activity/slice/step/Persona chip)
  → inline editor.
- **Remove structure:** hover-revealed `×` on cards; faint-default `×` on headers.
  Activity/slice removal is rejected when a card references it (pure op returns the
  same model). Keyboard: Delete/Backspace.
- **Persistence:** every edit runs through an optimistic in-memory model →
  debounced (300ms) signature-guarded `saveMap` with origin suppression + a
  serialized save loop + conflict reload (`scheduleSave`/`runSaveLoop`).

### 1.4 Satellites

- **Explorer** (`story-map-explorer-view.ts`): a flat card-list of maps; title
  button opens the board, a status pill, id + product anchor, count chips
  (users/activities/steps/slices/cards), and an icon action bar (settings, open
  note, refresh tables, delete). Clean and serviceable.
- **Builder** (`story-map-builder-modal.ts`): a 6-step wizard (title+product,
  users, activities, steps, slices, review) with a "Create now" fast-path and
  PRD-000 auto-seed. Collects only the skeleton — no cards.
- **Card Modal** (`story-map-card-modal.ts`): 11 stacked `Setting` rows. The full
  attribute surface, including Promote-to-Use-Case.
- **Settings Modal** (`story-map-settings-modal.ts`): title / status / product,
  raw `createEl` inputs (not `Setting` rows — visually inconsistent with the
  others).

---

## 2. Pain points (evidence-backed, by severity)

### Critical

- **C1 — No zoom/pan/focus: the board does not scale past a toy map.** The canvas
  is one flat SVG at fixed pixels (`BOARD_METRICS`, `renderSvg:767`). A realistic
  map (8 activities × 3 steps × 5 slices) is ~`140 + 8*3*212 ≈ 5200px` wide and
  many thousands tall, navigated only by raw scrollbars. There is no overview, no
  way to frame one slice or one activity, no fit-to-screen. This is the headline
  gap and the explicitly-scheduled ADR-0029 phase.

- **C2 — Full repaint on every edit destroys interaction continuity.** Every
  inline edit, cycle, add, remove, and drop calls `this.paint(this.contentEl)`,
  which does `container.empty()` and rebuilds the entire SVG + re-wires all DnD
  (`paint:428-447`, called from `onAdd`, `onRemove`, `applyCardEdit`, every drop).
  On a large board this is a visible flash, **resets scroll position**, drops
  hover state, and (post-zoom) would reset the viewport every keystroke-cycle.
  This is the single biggest structural blocker to a polished feel and to C1.

- **C3 — The card box is too small for what it must show.** 56px tall ×~184px wide
  (`cardHeight:56`, `colWidth:200`) must hold title (1 line, clips), ref, a chip
  row, swatch, status chip, and three hover controls (`cardGroupSpec:127-177`).
  Titles are single-line `<text>` with no wrap/ellipsis; `card.title` longer than
  ~22 chars overflows the tile silently. The board reads as a dense spreadsheet,
  not the tactile sticky-note wall the Card Type pastel language promises.

### Major

- **M1 — The `ref` renders as a raw `UC-NNN` string, not a resolved wikilink.**
  `cardGroupSpec` writes `box.card.ref` verbatim as `<text>` (scene.ts:135-137).
  CONTEXT.md's Story Map Card definition explicitly says a referenced card should
  render "its title plus a resolved, aliased wikilink `[[<note name>|UC-NNN]]`".
  On the board the ref is **not clickable, not aliased, not resolved** — you can't
  jump to the Use Case from its card. (The managed Markdown table does resolve it;
  the board, the *primary* surface, does not.)

- **M2 — Discoverability rests entirely on one dense hint sentence.** A single
  `.sm-board-hint` paragraph crams seven affordances into one run-on line
  (`paint:435-438`). Hover-only controls (✎ swatch status ×, `styles.css:1491`)
  are invisible until you happen to hover; the swatch/status are tiny 12px squares
  with `<title>` tooltips only. A first-time user cannot tell the board is
  editable, what double-click does, or that `+ card` lives at the bottom of a cell.

- **M3 — The Persona lane is a flat strip of identical grey chips with no identity.**
  `usersLaneSpecs` renders fixed-width 132px grey rects (`styles.css:1315`). There
  is no avatar/colour/initial, no link to the `PER-NNN` persona note, no way to tell
  one persona from another at a glance, and no association between a persona and the
  cards/columns it owns. Personas are a first-class shared library (ADR-0030) but
  the board treats them as throwaway labels.

- **M4 — Two parallel quick-edit palettes that disagree.** The board's inline swatch
  cycles a **hardcoded hex palette** (`CARD_PALETTE`, 6 reds/oranges/etc,
  view.ts:210) that has **no relationship to the five Card Type colours**
  (`CARD_TYPE_COLORS`, yellow/blue/green/pink/purple). So a quick swatch click can
  paint a card a colour that means nothing in the legend, while the *type* (which
  drives the legend) is only changeable in the modal. The two colour systems
  visibly contradict each other.

- **M5 — The legend is a static dead block at the canvas bottom.** `legendSpecs`
  pins the legend below the grid (`scene.ts:248`), so on any non-trivial map it is
  scrolled far off-screen and never co-visible with the cards it explains. It is
  also inert — not a filter, not a type picker, not a swatch you can drag onto a
  card.

- **M6 — Status is a tiny text chip, not a visual state.** Planning Status shows as
  10px muted text in a 56×12 grey chip (`scene.ts:159-165`, `styles.css:1577`).
  `blocked` and `done` look identical at a glance; there is no colour, icon, or
  border treatment to read slice health across the board. The slice roll-up bar
  (`sliceProgressSpecs`) uses a single accent colour for "done" with no blocked
  signal.

- **M7 — Empty / first-run states are weak.** A brand-new map (skeleton only, no
  cards) shows one italic line of `<text>` in the first row
  (`scene.ts:402-411`); a map with **no slices/activities** shows nothing centered
  and no guidance. The board-with-no-`storyMapId` state is a bare `<p>` (view.ts:404).
  None of these scaffold the "add your first card / activity" path.

### Minor

- **m1 — Add affordances are scattered and inconsistent.** `+ activity` floats to
  the right of the last group, `+ slice` below the last row, `+ step` is a tiny
  16px `+` jammed inside the activity header next to its `×` (scene.ts:384-391),
  `+ card` sits at each cell's bottom. Five different shapes/positions for "add".
- **m2 — Settings Modal uses raw inputs, not `Setting` rows** (`settings-modal.ts:48-78`)
  — visually inconsistent with the Card Modal and Builder.
- **m3 — Builder review step is plain `<p>` lines** (`renderReview:252-258`); no
  preview of the resulting board shape.
- **m4 — No undo affordance for board edits.** Removal/move/cycle are immediate and
  debounce-saved; the only recovery is Obsidian's note-level history. A destructive
  `×` (even though it's reject-guarded for referenced activities/slices) has no
  in-board undo.
- **m5 — Card chips truncate by char-count math, not measured width**
  (`chipSpecs`/`scene.ts:113`), so tag chips mis-size with proportional fonts.
- **m6 — The board title is a plain `<h2>` + the run-on hint**; no toolbar, no
  breadcrumb back to the map/product, no view controls region to host the coming
  zoom/focus chrome.

---

## 3. Redesign opportunities — bold + concrete

Direction: **native + light identity**. Keep Obsidian CSS variables as the base,
add a thin, deliberate Story-Map identity layer (the five pastel Card Types are
already a strong motif — lean into them) and a real **board canvas** with a
viewport, an overview, and a focus model. Keep every bit of logic in the pure
modules; the ItemView stays a thin renderer/wirer.

### 3.1 The zoom/pan/focus phase (the marquee win — ADR-0029 remaining)

Introduce a **viewport transform** as ephemeral view state (never written to the
note, per ADR-0029 consequence). Concretely:

- **A pan/zoom layer via `panzoom` behind a one-function adapter** mirroring
  `story-map-board-dnd.ts` — e.g. `story-map-board-viewport.ts` exposing
  `mountViewport(svg) → { setTransform, fit, getTransform, toBoardPoint, destroy }`.
  The view applies the transform to a single wrapper `<g>`. **Hit-testing must be
  re-pointed at the transformed group, not the outer SVG** (reviewer catch, Codex
  2026-06-21): `toBoardPoint` today calls `getScreenCTM()` on the **outer `<svg>`**
  (`toBoardPoint:993`), which maps screen→viewport but does **not** invert the
  child wrapper's pan/zoom transform — so under zoom/pan, drag and hover would
  resolve against the wrong cell. The viewport adapter must therefore own the
  screen→board conversion (invert the **wrapper group's** `getScreenCTM()`), and
  `toBoardPoint` must route through it. interact.js was *chosen* to stay robust
  over the CSS-transformed surface (ADR-0029), but the coordinate inversion is real
  work this phase must do, not a freebie.
- **Fit-to-screen** + **zoom 100% / +/−** controls in a persistent board toolbar
  (top-right). `fit()` computes scale from `layout.width/height` vs the viewport —
  a pure helper in the layout module (`computeFitTransform(layout, viewport)`),
  unit-tested, returning `{scale, x, y}`.
- **A minimap** (bottom-right): a down-scaled, non-interactive second render of the
  same `SvgNodeSpec` scene (or just the row/column/card rects) with a draggable
  viewport rectangle. Because the scene is already pure data, the minimap is "render
  the same specs at a tiny scale into a fixed box" — cheap and consistent.
- **Focus mode** as the headline interaction: **focus a Release Slice or an
  Activity**. Clicking a slice/activity header's new "focus" control (or pressing
  `f` on a focused header) animates the viewport to frame just that band/column and
  dims the rest (an overlay scrim with a cut-out, or reduced opacity on non-focused
  groups). This is *the* story-mapping move — "let's talk about the walking
  skeleton" / "let's work Activity 3" — and it is a pure `frameForSlice(layout, i)`
  / `frameForActivity(layout, i)` computation feeding the viewport adapter.
- **Keyboard nav of the viewport:** `+`/`-` zoom, `0` reset, `f` focus
  selection, arrow-pan when nothing is focused, Esc to clear focus. Routed through
  the existing `wireKeyboard` plumbing; the key→action table stays a pure map.

### 3.2 Stop the full-repaint (prerequisite for everything above)

C2 must be addressed or zoom/focus will flicker. Move from "empty + rebuild" to a
**reconciling render**: keep node identity and, on an edit, update only the changed
element's attributes/text rather than `container.empty()`. **Key the differ by
stable model identifiers, not positional indices** (reviewer catch, Codex
2026-06-21): `data-card-index` and header indices **shift** whenever cards/
activities/slices/steps are added, removed, or reordered, so reusing them as keys
would re-attach focus/hover/inline-editor state to the *wrong* card after a reorder.
The scene specs must therefore carry a stable `data-key` derived from the
persistent **`StoryMapCard.id`** (`src/domain/entities/story-map.ts:63`, minted by
`addCard`) for cards and a stable composite key (e.g. `activity\|step\|slice` names,
or a minted structural id) for headers. `buildBoardScene` already returns data; the
differ ("apply spec list to existing SVG, keyed by the stable `data-key`") lives in
the view layer but is mechanical and testable as a pure function over two spec
lists. This preserves scroll/zoom/hover across every cycle and inline edit, and is
the foundation a 60fps board needs.

### 3.3 Card & canvas visual language

- **Bigger, breathing cards.** Raise `cardHeight` to ~72–80, widen columns, give
  cards rounded corners + a soft type-tinted left spine (a 4px bar in the Card Type
  colour) so the *type* is always readable even when a `color` override or status
  treatment changes the body. Title gets **two-line wrap with ellipsis** (a
  `<foreignObject>`/`tspan` measured wrap helper, pure).
- **Make the type the colour system; demote raw hex.** Reconcile M4: the inline
  swatch should cycle **Card Types** (which is what the legend means), not an
  unrelated hex palette; keep the free-text `color` override in the modal only, as
  an "advanced" escape hatch. One colour language end to end.
- **Status as a visual state**, not text: a coloured dot/pill (e.g. green=done,
  amber=in-progress, slate=planned, red=blocked) with an icon, plus a subtle
  card-edge treatment for `blocked` (a red hairline) and a check affordance for
  `done`. The slice roll-up bar gains a blocked segment.
- **Make the ref clickable by BINDING, not by rendering a wikilink string (M1).**
  **The board is an SVG scene, not Markdown preview** (reviewer catch, Codex 2026-06-21):
  a literal `[[note|UC-NNN]]` in an SVG `<text>` node is inert — Obsidian won't resolve or
  make it clickable. Instead, carry a **resolved display label** (the aliased note title,
  computed via a resolver port — the managed table's existing resolution, exposed purely) and
  **bind the card/ref node's pointer handler to the A4 port with the union artifact target —
  `navigate({ kind: "artifact", id: ref })`** (NOT a revived id-only `openArtifact("UC-NNN")`
  overload, so the board stays consistent with the Feature/Suite/Evidence/Run targets — Codex
  catch) (the A4 deep-link
  port, now available) so the click opens the Use Case. A referenced card should also show a
  tiny "linked" glyph; a reference-less card a "story" glyph — the discovery distinction
  ADR-0028 cares
  about.
- **Light identity layer:** a gentle paper/grain texture or a faint dot-grid
  background for the canvas (storymaps.io's wall feel), slice rows as alternating
  banded backgrounds, activity headers as bold "section" bars. All via CSS vars so
  themes still drive it.

### 3.4 Interaction model

- **A persistent board toolbar** (replacing the run-on hint, M2/m6): left =
  breadcrumb (Product ▸ Map title, map title inline-editable); center = view
  controls (fit, zoom, focus selector, "show Markdown table"); right = "Add card",
  legend toggle, settings. This gives the coming zoom/focus chrome a home and makes
  the board read as an app surface, not a diagram.
- **Make the legend a live tool (M5):** dock it in the toolbar/side panel as (a) a
  **filter** (click a type → dim other types) and (b) a **palette** (drag a type
  swatch onto a card, or onto an empty cell to create a typed card). Co-visible,
  not scrolled off.
- **One consistent "add" affordance (m1):** a single ghost "+" that appears on
  hover at the relevant edge (end-of-row for activities, end-of-column for slices,
  in-cell for cards), same shape everywhere, plus the toolbar "Add card".
- **In-board undo (m4):** a lightweight undo stack of pure-model snapshots (the ops
  already return new immutable `StoryMap`s — push the prior model, `Ctrl-Z` pops).
  Pure and cheap; the view just swaps `this.model` and reconciles.

### 3.5 Side panel — the new home for full editing

Replace (or complement) the modal-per-card with a **right-docked card inspector**
that opens on card-select and edits in place: title, type (as swatches), status,
points, tags, ref (with Promote), and — critically — the card's **Markdown body**
(description/acceptance notes, which exist on disk per ADR-0030 but are *invisible
on the board today*). Selecting a card highlights it; the panel edits live through
the same debounced save loop. **Editing the body needs NEW read/write plumbing — it
is not free in the current save loop** (reviewer catch, Codex 2026-06-21): the board
model **drops** the body — `StoryMapCard` has no `body` field, `noteToCard` discards
`StoryMapCardNote.body`, and `reconcileCards` *preserves* the on-disk body while
writing only placement/planning metadata. So the inspector can edit
title/type/status/points/tags/ref through the existing loop, but **loading and
persisting the Markdown body requires extending the card model + read path (carry
the body into the board model) and the write path (let a body edit flow through
reconcile instead of being preserved-only)**. The Card Modal can remain as the "open
in modal" fallback, but the inspector makes the rich note-backed model finally
visible where the work happens. A second panel tab can host **Personas** (M3): real persona
chips with colour/initial, linking to `PER-NNN`, and showing which activities each
owns.

### 3.6 Discoverability & first-run (M2, M7)

- A real **empty state**: when a map has no cards, a centered card-shaped dropzone
  ("Drag a type here, or click + to add your first story") and, when there's no
  structure at all, a 1-2-3 scaffold ("Name an activity → add a slice → add a
  card"). When no map is open, a friendlier panel that links to the explorer/builder.
- **Onboarding affordance:** a dismissible "what can I do here" coachmark layer that
  points at the toolbar, a cell's `+ card`, and a header (double-click to rename) —
  replacing the dense hint sentence.

---

## 4. Prioritized recommendations

Flag: ★ = keeps the ItemView thin (logic lands in pure modules / a thin adapter).

| # | Recommendation | Impact | Effort | Risk | Dependencies | Thin? |
|---|----------------|--------|--------|------|--------------|-------|
| R1 | **Reconciling render** — replace full `empty()`+rebuild with a spec-differ **keyed by stable `StoryMapCard.id` / structural keys** (not positional indices) so edits don't reset scroll/zoom/hover or misattach state on reorder (C2) | H | M | M (touches the hottest path; needs careful DnD re-wire) | none (enables R2/R3) | ★ differ is a pure fn over two spec lists |
| R2 | **Zoom/pan via `panzoom` adapter** + fit-to-screen + zoom controls (C1, ADR-0029 phase). Adapter **owns screen→board conversion** (invert the wrapper group's CTM); `toBoardPoint` routes through it | H | M | M (new runtime dep; coordinate inversion is real work, not free) | R1 strongly preferred | ★ adapter mirrors dnd.ts; `computeFit` pure |
| R3 | **Focus mode** — frame a Slice/Activity, dim the rest; `f`/Esc keys (C1) | H | M | L | R2 | ★ `frameForSlice/Activity` pure |
| R4 | **Minimap** overview with draggable viewport rect | M | M | L | R2 | ★ re-renders the same pure specs at scale |
| R5 | **Bigger cards + type spine + 2-line wrapped titles + status-as-visual-state** (C3, M6) | H | M | L | metrics are pure; check tests | ★ all in `BOARD_METRICS`/scene/CSS |
| R6 | **Make the card `ref` clickable** — resolved display label + **bind the node to the A4 union port `navigate({kind:"artifact", id: ref})`** (not an id-only overload — Codex catch), NOT a literal `[[ ]]` string (inert in SVG) (M1) | M | S | L | A4 union nav port; a pure resolver for the display label | ★ resolution pure; view binds the pointer handler |
| R7 | **Reconcile the two colour systems** — inline swatch cycles Card *Types*; hex override modal-only (M4) | M | S | M (changes a documented P4 behaviour — confirm w/ owner) | — | ★ swap `CARD_PALETTE` for `CARD_TYPES` |
| R8 | **Board toolbar** (breadcrumb + view controls + add + legend toggle), replacing the hint line (M2, m6) | H | M | L | hosts R2/R3/R9 | view chrome; handlers call pure ops |
| R9 | **Live legend = filter + type palette**, docked & co-visible (M5) | M | M | L | R1 (filter = re-render), R8 | ★ filter/palette state pure |
| R10 | **Right-docked card inspector** incl. the card **body**, replacing modal-first editing (3.5) | H | H | M | R1; **new card-note body read/write plumbing** (model drops body: `StoryMapCard` has no body field, `noteToCard` discards it, reconcile preserves-only — Codex catch) | view panel; body needs model + read/write path changes, not just the existing save loop |
| R11 | **In-board undo stack** of model snapshots (m4) | M | S | L | ops already return immutable maps | ★ snapshot stack is pure |
| R12 | **Persona lane identity** — colour/initial chips linking to `PER-NNN`, activity ownership (M3) | M | M | L | persona notes exist (ADR-0030) | ★ lane spec + resolution pure |
| R13 | **Real empty / first-run states + coachmarks** (M2, M7) | M | S | L | — | ★ empty-state specs pure |
| R14 | **Polish satellites** — Settings Modal → `Setting` rows; Builder review board-shape preview (m2, m3) | L | S | L | — | thin |
| R15 | **Light identity layer** — dot-grid canvas, banded slices, section-bar activities, type-tinted accents (3.3) | M | S | L | R8 for cohesion | ★ CSS + scene only |

Suggested sequencing: **R1 → R2 → R3/R4 (the marquee zoom/pan/focus phase) → R8
(toolbar to host it) → R5/R6/R7 (card language) → R9/R10/R12 (panels) → R11/R13/
R14/R15 (polish)**. R1 is the keystone: it unblocks a non-flickering canvas for
everything else.

---

## 5. Open questions for the product owner

1. **Focus mode scope:** is focus a pure *camera* move (frame + dim, structure
   unchanged) or should it also *filter* (hide non-focused cards)? Camera-only is
   safer and matches "ephemeral view state, never written to the note."
2. **Colour-system reconciliation (R7):** ADR-0030/P4 deliberately let the inline
   swatch cycle an arbitrary palette distinct from Card Type. Are we OK changing
   that so the inline swatch cycles **Card Types** (one colour language), keeping
   free-text `color` as a modal-only override? This is a documented-behaviour change.
3. **Inspector vs modal (R10):** do we *replace* the Card Modal with a docked
   inspector, or keep both? The inspector is the only way to surface the card
   **body** on the board — is exposing/editing the body on the board in scope?
4. **Minimap cost:** acceptable to render the scene twice (full + minimap) given
   the desktop-only target, or should the minimap be a coarse rects-only render?
5. **Identity strength:** how far past "native" should the light identity go — a
   subtle dot-grid + type accents, or a more opinionated "sticky-note wall"
   (paper texture, drop shadows, slight card rotation)? The latter reads bolder but
   strays further from native Obsidian.
6. **Persona ownership model:** should the board encode/visualise *which* persona
   owns which activity/column, or stay a flat top lane? CONTEXT.md frames `users`
   as a flat ordered list — making it a relationship is a model extension.
7. **Mobile / no-plugin parity:** the managed Markdown table already resolves refs
   and renders per-activity. As the board grows richer, do we keep table parity as
   a hard requirement, or accept the board as the canonical surface with the table
   as a lossy export?

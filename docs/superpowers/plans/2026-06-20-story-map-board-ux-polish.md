# Story Map Board — UX/UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board *feel* great to use — real drag feedback (live movement, drop-target highlight + insertion line, snap-back), a calm hover-revealed affordance set with tooltips, smooth motion, empty states, and keyboard/focus accessibility.

**Architecture / key decisions (settled):**
- **Card grouping (absolute-coord children).** Each card renders as `<g class="sm-board-card-group" data-card-index>` wrapping its existing children (rect/title/attrs/remove/swatch/chip) **at their current absolute coordinates** (no rest transform). This unlocks (a) hover-reveal via `.sm-board-card-group:hover .control`, (b) live drag by applying a temporary `transform: translate(dx,dy)` to the group during a move, and (c) `<title>` tooltips — all **without** changing child coordinates, so the inline editor positioning, the canvas-bounds test, and existing position assertions keep working.
- **`SvgNodeSpec` gains `children?: SvgNodeSpec[]`** (a `<g>` group). `renderSvg` renders children recursively. `querySelectorAll` still finds nested rects/controls, so the click/drag wiring keeps using class/`data-*` selectors.
- **Transient overlay layer.** A dedicated `<g class="sm-board-overlay">` appended last and owned by the view (NOT the scene) holds drag-time feedback: the target-cell highlight rect and the stack/column/row insertion line. It is rebuilt on each `move` and cleared on `end` — it never enters the scene/repaint cycle.
- **Live drag = group transform, not a ghost.** The dragged card group is translated to follow the pointer (`dx,dy` from interact.js). The original is not cloned. On drop the transform is cleared and `paint()` re-renders authoritatively.
- **Reorder-glide is explicitly out of scope.** `paint()` empties + recreates the SVG, so there's no element continuity to CSS-transition a card *gliding* to its reordered slot (that needs DOM reconciliation). Motion is scoped to: fade-in on render, hover elevation, and smooth drag follow/snap-back. Documented, not attempted.

**Tech Stack:** TypeScript, esbuild, vitest, interact.js (pointer drag), Obsidian ItemView, SVG.

---

## Phase UX-1 — Card grouping + hover-reveal + tooltips (affordance clarity)

**Files:** `story-map-board-scene.ts`, `story-map-board-view.ts`, `styles.css`, `tests/story-map-board-scene.test.ts`

**Outcome:** Resting board is calm — per-card controls (remove ×, swatch, status chip) are hidden until you hover the card; the per-cell `+ card` reveals on cell hover. Every control has a `<title>` tooltip. Headers gain a rename cue.

- [ ] **Step 1 — `SvgNodeSpec` group support.** Add `children?: SvgNodeSpec[]` to `SvgNodeSpec`; in the view's `renderSvg`, when a spec has `children`, create the element and recursively render each child into it. A `<title>` is expressed as a child spec with `tag: "title"` and `text`. (Extend the `tag` union with `"g"` and `"title"`.)
- [ ] **Step 2 — Wrap cards in a group.** In `cardSpecs`, return one `{ tag: "g", class: "sm-board-card-group", attrs: { "data-card-index": box.cardIndex }, children: [...] }` per card; move the rect/title/attrs/remove/swatch/chip into `children` **with their current absolute x/y unchanged**. Add `<title>` children to the remove/swatch/chip controls ("Remove card", "Cycle color", "Cycle status").
- [ ] **Step 3 — Update drag/edit selectors.** Drag the GROUP: `wireDnd` targets `.sm-board-card-group` (its `data-card-index` is read in `onCardDrop`/`buildMove`). Card-title double-click: target `.sm-board-card-group`, but mount the inline editor over the child `rect.sm-board-card` (find it within the group) so the editor still sits over the tile. Verify `onCardDrop`/`buildMove`/`onEditCardTitle` read `data-card-index` off the group.
- [ ] **Step 4 — Hover-reveal + tooltip CSS.** Default `.sm-board-remove, .sm-board-swatch, .sm-board-status-chip { opacity: 0 }`; `.sm-board-card-group:hover :is(.sm-board-remove, .sm-board-swatch, .sm-board-status-chip) { opacity: … }`. Same hover-reveal for `.sm-board-add-card` on cell hover (a per-cell hover target — see Step 5). Keep keyboard focus reveal too: `.sm-board-card-group:focus-within …`.
- [ ] **Step 5 — Per-cell `+ card` reveal + rename cue.** Wrap each cell's `+ card` so it reveals on cell hover (a transparent cell-hover rect, or group the add-card under a cell group). Add a rename cue: header rects get `cursor: text` on hover + a `<title>` "Double-click to rename".
- [ ] **Step 6 — Tests + gate.** Scene test: a card emits a `sm-board-card-group` with `data-card-index` and child rect/controls; controls carry a `<title>`. Re-confirm the canvas-bounds test (children keep absolute coords). Run the full gate incl. `format:check` + `npx fallow audit --base origin/main`.
- [ ] **Step 7 — Commit + push.**

---

## Phase UX-2 — Live drag movement + drop-target highlight + insertion line + snap-back (the emphasis)

**Files:** `story-map-board-dnd.ts`, `story-map-board-layout.ts`, `story-map-board-view.ts`, `styles.css`, `tests/story-map-board-layout.test.ts`

**Outcome:** Dragging a card carries it under the pointer; the target cell tints and a thin line shows the exact stack slot; dropping outside any cell snaps the card back; the cursor signals droppable vs not.

- [ ] **Step 1 — dnd `onMove`.** Extend `CardDragCallbacks` with `onMove(element, clientX, clientY)` and add interact.js's `move` listener (use `event.client.x/y`; the validated backing object). Keep `onStart`/`onEnd`.
- [ ] **Step 2 — Pure overlay geometry.** In `story-map-board-layout.ts` add `dropIndicator(layout, point): { cell: {x,y,width,height}; line: {x1,y1,x2,y2} } | null` — resolves the target cell rect and the insertion-line segment from a board point (reuses `resolveDropTarget` + the cell/stack metrics). Pure + unit-tested.
- [ ] **Step 3 — View overlay.** The view owns a `<g class="sm-board-overlay">` (appended after the scene in `paint`). On card `onMove`: translate the dragged group (`transform: translate(dx,dy)` from start point) AND rebuild the overlay from `dropIndicator(layout, boardPoint)` — a `.sm-board-drop-cell` rect + a `.sm-board-drop-line`. When the point is over no cell, clear the overlay and set a not-droppable cursor on the group.
- [ ] **Step 4 — Snap-back / end.** On `onEnd`: clear the overlay; if the drop resolves to a valid target, drop + `paint()` (authoritative); else remove the group transform with a short CSS transition (snap-back) — `paint()` already restores it, so add a transition class on the group so the reset animates.
- [ ] **Step 5 — Header reorder feedback.** Headers (activity/slice/step) get the same overlay treatment: on move, draw a column/row **insertion line** at the target slot (between groups/rows) from a pure `headerDropIndicator(layout, kind, point)`. Header element dims (existing) + insertion line shows the target; live header translation optional (skip for scope — the line is the key signal).
- [ ] **Step 6 — Styles.** `.sm-board-drop-cell { fill: var(--text-accent); opacity: 0.12 }`, `.sm-board-drop-line { stroke: var(--text-accent); stroke-width: 2 }`, `.sm-board-card-group.is-dragging { cursor: grabbing }`, not-droppable cursor, snap-back transition.
- [ ] **Step 7 — Tests + gate.** Layout tests for `dropIndicator`/`headerDropIndicator` (cell rect + line coords; null outside). Full gate + audit.
- [ ] **Step 8 — Commit + push.**

---

## Phase UX-3 — Motion + hover elevation + empty states

**Files:** `story-map-board-scene.ts`, `story-map-board-view.ts`, `styles.css`, tests

**Outcome:** Cards fade in on render and lift on hover; the board shows a friendly empty state when there are no cards / a near-empty structure.

- [ ] **Step 1 — Fade-in + hover elevation.** `.sm-board-card-group { transition: opacity 0.12s, filter 0.12s }`; a render fade-in (add a class on mount, remove next frame) ; `.sm-board-card-group:hover { filter: drop-shadow(...) }`.
- [ ] **Step 2 — Drag smoothing.** Smooth the group translate (the snap-back transition from UX-2; ensure live-follow is NOT transitioned so it tracks the pointer 1:1).
- [ ] **Step 3 — Empty states.** Pure scene/view: when `layout.cards.length === 0`, render a centered "No cards yet — click **+ card** in a cell to add one" hint; when a map has the seed single activity/slice, a subtle "Add activities/slices with **+**" hint. Keep it as scene text specs so it's testable.
- [ ] **Step 4 — Tests + gate + commit + push.**

---

## Phase UX-4 — Keyboard a11y + focus rings

**Files:** `story-map-board-scene.ts`, `story-map-board-view.ts`, `styles.css`, tests

**Outcome:** Cards and headers are keyboard-reachable and operable; focus is always visible.

- [ ] **Step 1 — Focusable + roles.** Card groups and header rects get `tabindex="0"` + an accessible `role`/`aria-label` (e.g., the card title + cell). Visible focus ring: `:focus-visible` outline on `.sm-board-card-group`/headers.
- [ ] **Step 2 — Keyboard actions (view key handlers).** On a focused card: `Enter`/`F2` → rename; `Delete`/`Backspace` → remove; `c` → cycle color; `s` → cycle status; arrow keys → move the card to the adjacent cell (reuse `moveCard` with the neighbor coordinate from a pure `neighborCell(layout, cardIndex, dir)`). On a focused header: `Enter`/`F2` → rename; `Delete` → remove; `[`/`]` (or arrows) → reorder (`reorderActivity/Slice/Step`).
- [ ] **Step 3 — Pure neighbor resolver.** `neighborCell(layout, cardIndex, "left"|"right"|"up"|"down")` returns the adjacent `(activity, step?, slice)` target or null at an edge. Unit-tested.
- [ ] **Step 4 — Tests + gate + commit + push.**

---

## Self-review notes
- Every phase lands gate-green (format/lint/typecheck/build/test ≥80% + `fallow audit` exit 0) and is pushed before the next.
- The grouping refactor (UX-1) is the keystone; verify the inline editor still positions over the card and the canvas-bounds test still passes (children stay absolute) before moving on.
- Views are unit-test-exempt; all new geometry (overlay indicators, neighbor resolver) lives in pure `layout`/`domain` modules with tests.

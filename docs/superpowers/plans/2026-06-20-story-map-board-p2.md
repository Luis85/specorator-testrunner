# Story Map Visual Board — P2 (Drag cards + saveMap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the read-only Story Map board (P1) interactive: drag a card to another (activity, step, slice) cell or reorder it within a cell, and persist the change to the note frontmatter via a new debounced `saveMap`, with a self-event guard so the board's own save doesn't trigger a reload that drops an in-flight drag.

**Architecture:** All move/reorder logic is pure domain ops on `StoryMap` (`moveCard`, `reorderCardInCell`); all hit-testing (board point → drop target) is a pure presentation function (`resolveDropTarget`). The board view keeps an in-memory working model, applies an op optimistically on drop, re-renders, and schedules a debounced `saveMap(id, model, origin)`. `saveMap` (application) rewrites the `cards` frontmatter + regenerates the managed blocks under the existing mutation lock and publishes `storymap.updated` carrying an `origin` token; the board ignores updates it caused. Drag/drop is wired with `@atlaskit/pragmatic-drag-and-drop` behind a thin adapter (the plugin's first runtime dep — already recorded in ADR-0029).

**Tech Stack:** TypeScript, Obsidian `ItemView`, SVG/DOM, `@atlaskit/pragmatic-drag-and-drop` (Apache-2.0), Vitest. Reuses `src/domain/entities/story-map.ts`, `src/presentation/views/story-map-board-layout.ts`, and the `writeCards`/`refreshManagedBlocks` pipeline in `src/application/services/story-map-service.ts`.

**Spec:** `docs/superpowers/specs/2026-06-19-story-map-board-design.md` (§4 Interactions rows 1–2, §5 Persistence, §9 P2). This plan covers **P2 only**; P3–P5 get their own plans after P2 lands gate-green on branch `claude/storymaps-prd-tooling-k9tpnx` (PR #68).

**Gate after every commit:** `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit` (audit must exit 0). Run `npm run format` before committing. Commit message trailers (every commit):
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BxcuwMGwcXWKAfwMHF73P3
```

---

## File structure (P2)

- Modify `package.json` — add the `@atlaskit/pragmatic-drag-and-drop` runtime dependency.
- Create `src/presentation/views/story-map-board-dnd.ts` — thin adapter over Pragmatic-DnD (`makeCardDraggable`, `makeCellDropTarget`), the only module that imports the library, so it stays swappable (§2 risk).
- Modify `src/domain/entities/story-map.ts` — pure `moveCard` + `reorderCardInCell` ops (+ `CardTarget` type).
- Modify `tests/story-map.test.ts` — op tests.
- Modify `src/presentation/views/story-map-board-layout.ts` — pure `resolveDropTarget(layout, point)` hit-test.
- Modify `tests/story-map-board-layout.test.ts` — hit-test tests.
- Modify `src/domain/events/domain-event.ts` — the `EventPayloads` catalog (~line 129); add optional `origin?: string` to the `storymap.updated` payload.
- Modify `src/application/services/story-map-service.ts` — add `saveMap(id, model, origin?)`; thread `origin` through `publishUpdated`.
- Modify `tests/story-map-service.test.ts` — `saveMap` tests.
- Modify `src/presentation/views/story-map-board-view.ts` — working model, DnD wiring, debounced save, self-event guard, revert-on-failure.
- Modify `src/register-views.ts` — widen the board view's injected service to include `saveMap`.
- Modify `styles.css` — drag affordances (dragging card, drop-target cell highlight).
- Modify `CONTEXT.md` — note the board is now interactive (drag).

Card identity across a save is its index in `map.cards`; `computeBoardLayout` already records `cardIndex` on every box (P1), and `moveCard`/`reorderCardInCell` take that index.

---

## Task 1: Add the Pragmatic-DnD dependency + adapter (spike)

**Files:**
- Modify: `package.json`
- Create: `src/presentation/views/story-map-board-dnd.ts`

The library builds on the native HTML drag-and-drop API. P1 has no zoom transform yet (panzoom arrives in P5), so the §2 "DnD over a CSS-transformed surface" risk cannot be exercised here — this task validates that the library **bundles** and that a basic draggable/drop-target pair wires up. **Flag for P5:** re-validate drag behaviour once `panzoom` applies a CSS transform; if it misbehaves, swap this adapter's internals for pointer-based `interact.js` (the rest of the board calls only `makeCardDraggable`/`makeCellDropTarget`).

- [ ] **Step 1: Add the dependency**

Run: `npm install @atlaskit/pragmatic-drag-and-drop`
Expected: `package.json` gains `@atlaskit/pragmatic-drag-and-drop` under `dependencies`, `package-lock.json` updates. (If the registry is unreachable in this environment, add the latest stable version to `dependencies` by hand and run `npm install` to refresh the lockfile.)

- [ ] **Step 2: Create the adapter**

```typescript
// src/presentation/views/story-map-board-dnd.ts
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

/**
 * The data a dragged card carries: its stable index in `map.cards`. Kept tiny so
 * the drop handler resolves everything else from the board layout (§4).
 */
export interface CardDragData {
  /** Discriminator so a drop target can recognise our payload. */
  kind: "story-map-card";
  cardIndex: number;
}

/** A cell that can receive a card: its (activity, step, slice) coordinate. */
export interface CellDropData {
  kind: "story-map-cell";
  activity: string;
  step?: string;
  slice: string;
}

/** Type guard for the dragged-card payload. */
export const isCardDragData = (data: Record<string, unknown>): data is CardDragData =>
  data.kind === "story-map-card" && typeof data.cardIndex === "number";

/**
 * Makes an element a draggable card. Returns the cleanup function Pragmatic-DnD
 * hands back (call it on re-render/teardown). The board owns all geometry; this
 * adapter only carries the card index.
 */
export const makeCardDraggable = (
  element: Element,
  cardIndex: number,
  onDragStateChange: (dragging: boolean) => void,
): (() => void) =>
  draggable({
    element,
    getInitialData: (): CardDragData => ({ kind: "story-map-card", cardIndex }),
    onDragStart: () => onDragStateChange(true),
    onDrop: () => onDragStateChange(false),
  });

/**
 * Makes an element a drop target for cards. `onDrop` fires with the dragged
 * card's index when a card is released over this cell. Returns the cleanup fn.
 */
export const makeCellDropTarget = (
  element: Element,
  cell: Omit<CellDropData, "kind">,
  onDrop: (cardIndex: number) => void,
  onDragStateChange: (over: boolean) => void,
): (() => void) =>
  dropTargetForElements({
    element,
    getData: (): CellDropData => ({ kind: "story-map-cell", ...cell }),
    onDragEnter: () => onDragStateChange(true),
    onDragLeave: () => onDragStateChange(false),
    onDrop: ({ source }) => {
      onDragStateChange(false);
      const data = source.data;
      if (isCardDragData(data)) onDrop(data.cardIndex);
    },
  });
```

- [ ] **Step 3: Typecheck + build (the bundle is the spike's pass condition)**

Run: `npm run typecheck && npm run build`
Expected: clean; `main.js` builds with the library bundled. If the import path `@atlaskit/pragmatic-drag-and-drop/element/adapter` fails to resolve under the bundler/types, check the package's `exports` map and adjust the import (the element adapter is the documented entry point).

- [ ] **Step 4: Commit**

```bash
npm run format
git add package.json package-lock.json src/presentation/views/story-map-board-dnd.ts
git commit -m "feat(story-map-board): add pragmatic-drag-and-drop adapter"
```

---

## Task 2: Domain op `moveCard`

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/story-map.test.ts`; add `moveCard` to the existing `../src/domain/entities/story-map` import)

```typescript
describe("moveCard", () => {
  const baseMap = (): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next"],
    cards: [
      { title: "A", activity: "Browse", step: "Filter", slice: "Walking skeleton", tags: [] },
      { title: "B", activity: "Browse", step: "Filter", slice: "Walking skeleton", tags: [] },
      { title: "C", activity: "Order", slice: "Next", tags: [] },
    ],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("moves a card to a new (activity, slice) cell, dropping the step when none given", () => {
    const next = moveCard(baseMap(), 0, { activity: "Order", slice: "Next" });
    expect(next.cards[2]).toMatchObject({ title: "A", activity: "Order", slice: "Next" });
    expect(next.cards[2].step).toBeUndefined();
    // Source array is untouched.
    expect(baseMap().cards[0].activity).toBe("Browse");
  });

  it("places the moved card at indexInCell among the destination cell's cards", () => {
    // Move C (index 2) into Browse/Filter/Walking skeleton at position 1 (between A and B).
    const next = moveCard(baseMap(), 2, { activity: "Browse", step: "Filter", slice: "Walking skeleton" }, 1);
    const cell = next.cards.filter(
      (c) => c.activity === "Browse" && c.step === "Filter" && c.slice === "Walking skeleton",
    );
    expect(cell.map((c) => c.title)).toEqual(["A", "C", "B"]);
  });

  it("appends to the destination cell when indexInCell is omitted", () => {
    const next = moveCard(baseMap(), 2, { activity: "Browse", step: "Filter", slice: "Walking skeleton" });
    const cell = next.cards.filter(
      (c) => c.activity === "Browse" && c.step === "Filter" && c.slice === "Walking skeleton",
    );
    expect(cell.map((c) => c.title)).toEqual(["A", "B", "C"]);
  });

  it("returns the map unchanged for an out-of-range index", () => {
    const map = baseMap();
    expect(moveCard(map, 9, { activity: "Order", slice: "Next" })).toBe(map);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map.test.ts`
Expected: FAIL (`moveCard` not exported).

- [ ] **Step 3: Implement `moveCard`** (add after `buildStoryMapGrid` in `src/domain/entities/story-map.ts`)

```typescript
/** A destination cell for a card move: the (activity, optional step, slice). */
export interface CardTarget {
  activity: string;
  step?: string;
  slice: string;
}

/** Re-coordinates a card to `target`, dropping `step` when the target has none. */
const withCell = (card: StoryMapCard, target: CardTarget): StoryMapCard => {
  const rebased = { ...card, activity: target.activity, slice: target.slice };
  if (target.step === undefined) {
    // Omit the key entirely (not `step: undefined`) so it matches no-step cards.
    const { step: _step, ...noStep } = rebased;
    return noStep;
  }
  return { ...rebased, step: target.step };
};

/** The indices in `cards` of the cards already in `target`'s cell (in order). */
const cellIndices = (cards: readonly StoryMapCard[], target: CardTarget): number[] =>
  cards.reduce<number[]>((acc, c, i) => {
    const sameStep = (c.step ?? undefined) === (target.step ?? undefined);
    if (c.activity === target.activity && sameStep && c.slice === target.slice) acc.push(i);
    return acc;
  }, []);

/**
 * Moves the card at `cardIndex` into `target`'s (activity, step, slice) cell,
 * placing it at `indexInCell` among that cell's existing cards (clamped; default
 * = end of the cell). Returns a NEW StoryMap with `cards` reordered so the
 * rendered grid (which preserves `cards` order within a cell) reflects the drop.
 * An out-of-range `cardIndex` returns the same map reference. Pure: no I/O.
 */
export const moveCard = (
  map: StoryMap,
  cardIndex: number,
  target: CardTarget,
  indexInCell?: number,
): StoryMap => {
  const card = map.cards[cardIndex];
  if (card === undefined) return map;
  const moved = withCell(card, target);
  const rest = map.cards.filter((_, i) => i !== cardIndex);
  const positions = cellIndices(rest, target);
  const clamped =
    indexInCell === undefined ? positions.length : Math.max(0, Math.min(indexInCell, positions.length));
  const insertAt =
    clamped < positions.length
      ? positions[clamped]
      : positions.length > 0
        ? positions[positions.length - 1] + 1
        : rest.length;
  return { ...map, cards: [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)] };
};
```

> If lint flags the `_step` rest-destructure as an unused variable, confirm the repo's `no-unused-vars` config ignores a leading-underscore name (it does for function args; for destructure siblings use the rest pattern as written, which is the standard "omit a key" idiom — adjust the variable name to satisfy the configured `ignoreRestSiblings`/`varsIgnorePattern` if needed).

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): pure moveCard domain op"
```

---

## Task 3: Domain op `reorderCardInCell`

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing test** (append; add `reorderCardInCell` to the import)

```typescript
describe("reorderCardInCell", () => {
  const map = (): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse"],
    steps: [],
    slices: ["Walking skeleton"],
    cards: [
      { title: "A", activity: "Browse", slice: "Walking skeleton", tags: [] },
      { title: "B", activity: "Browse", slice: "Walking skeleton", tags: [] },
      { title: "C", activity: "Browse", slice: "Walking skeleton", tags: [] },
    ],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("moves a card to a new position within its own cell", () => {
    // Move C (index 2) to the front of the cell.
    const next = reorderCardInCell(map(), 2, 0);
    expect(next.cards.map((c) => c.title)).toEqual(["C", "A", "B"]);
  });

  it("is a no-op for an out-of-range index", () => {
    const m = map();
    expect(reorderCardInCell(m, 9, 0)).toBe(m);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map.test.ts`
Expected: FAIL (`reorderCardInCell` not exported).

- [ ] **Step 3: Implement** (add after `moveCard`)

```typescript
/**
 * Reorders the card at `cardIndex` to position `indexInCell` among the cards in
 * its OWN cell (same activity/step/slice). A thin wrapper over {@link moveCard}
 * with the card's current coordinate. Pure: no I/O.
 */
export const reorderCardInCell = (
  map: StoryMap,
  cardIndex: number,
  indexInCell: number,
): StoryMap => {
  const card = map.cards[cardIndex];
  if (card === undefined) return map;
  return moveCard(map, cardIndex, { activity: card.activity, step: card.step, slice: card.slice }, indexInCell);
};
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): pure reorderCardInCell domain op"
```

---

## Task 4: Pure drop-target hit-test `resolveDropTarget`

**Files:**
- Modify: `src/presentation/views/story-map-board-layout.ts`
- Test: `tests/story-map-board-layout.test.ts`

Maps a board-space point (already converted from screen space by the caller; at P2 scale = 1, so no transform math yet) to the cell under it and the insertion index within that cell's card stack.

- [ ] **Step 1: Write the failing test** (append to `tests/story-map-board-layout.test.ts`; add `resolveDropTarget` to the import)

```typescript
describe("resolveDropTarget", () => {
  // Two activities; Browse has step Filter, Order has none. Two slices.
  const m = map({
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next"],
    cards: [
      { title: "A", activity: "Browse", step: "Filter", slice: "Walking skeleton", tags: [] },
    ],
  });

  it("returns the cell under a point inside a column/row", () => {
    const layout = computeBoardLayout(m);
    const col = layout.columns[0]; // Browse / Filter
    const row = layout.rows[0]; // Walking skeleton
    const target = resolveDropTarget(layout, { x: col.x + 10, y: row.y + 10 });
    expect(target).toMatchObject({ activity: "Browse", step: "Filter", slice: "Walking skeleton" });
  });

  it("targets the no-step column for a step-less activity", () => {
    const layout = computeBoardLayout(m);
    const col = layout.columns[1]; // Order / (no step)
    const row = layout.rows[1]; // Next
    const target = resolveDropTarget(layout, { x: col.x + 10, y: row.y + 10 });
    expect(target).toMatchObject({ activity: "Order", slice: "Next" });
    expect(target?.step).toBeUndefined();
  });

  it("returns null for a point outside every cell (e.g. the header band)", () => {
    const layout = computeBoardLayout(m);
    expect(resolveDropTarget(layout, { x: 5, y: 5 })).toBeNull();
  });

  it("reports the insertion index from the point's depth in the card stack", () => {
    const layout = computeBoardLayout(m);
    const col = layout.columns[0];
    const row = layout.rows[0];
    // Near the row top → index 0; far down → index past the single card.
    expect(resolveDropTarget(layout, { x: col.x + 10, y: row.y + 2 })?.indexInCell).toBe(0);
    expect(
      resolveDropTarget(layout, { x: col.x + 10, y: row.y + row.height - 2 })?.indexInCell,
    ).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map-board-layout.test.ts`
Expected: FAIL (`resolveDropTarget` not exported).

- [ ] **Step 3: Implement** (add to `src/presentation/views/story-map-board-layout.ts`)

```typescript
/** A point in board space (after the caller removes any pan/zoom transform). */
export interface BoardPoint {
  x: number;
  y: number;
}

/** A resolved drop location: the cell coordinate + insertion index in its stack. */
export interface DropTarget {
  activity: string;
  step?: string;
  slice: string;
  indexInCell: number;
}

/**
 * Resolves a board-space point to the (column, row) cell under it and the
 * insertion index within that cell's vertical card stack. Returns null when the
 * point is outside every column or row (e.g. the users lane / header band).
 * Pure: no DOM. The caller converts screen→board coordinates first (identity at
 * P2 scale; pan/zoom math arrives in P5).
 */
export const resolveDropTarget = (layout: BoardLayout, point: BoardPoint): DropTarget | null => {
  const column = layout.columns.find((c) => point.x >= c.x && point.x < c.x + c.width);
  const row = layout.rows.find((r) => point.y >= r.y && point.y < r.y + r.height);
  if (column === undefined || row === undefined) return null;
  const depth = point.y - (row.y + M.cellPadding);
  const slot = Math.floor(depth / (M.cardHeight + M.cardGap));
  return {
    activity: column.activity,
    ...(column.step !== undefined ? { step: column.step } : {}),
    slice: row.slice,
    indexInCell: Math.max(0, slot),
  };
};
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map-board-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-layout.ts tests/story-map-board-layout.test.ts
git commit -m "feat(story-map-board): pure drop-target hit-test"
```

---

## Task 5: Add an `origin` token to the `storymap.updated` payload

**Files:**
- Modify: `src/domain/events/domain-event.ts` (the `EventPayloads` catalog; the `"storymap.updated"` entry is ~line 129: `"storymap.updated": { storyMapId: string; path: string };`)
- Test: covered indirectly by Task 6's `saveMap` test (emission with origin)

The board both **emits** `storymap.updated` (via `saveMap`) and **reloads** on it. An optional `origin` token lets the board recognise — and skip — the update it caused, without suppressing the event for other views (the explorer still refreshes).

- [ ] **Step 1: Add the field** — in the `EventPayloads` map in `src/domain/events/domain-event.ts`, extend the `storymap.updated` entry with an optional `origin`:

```typescript
// In EventPayloads:
"storymap.updated": { storyMapId: string; path: string; origin?: string };
```

- [ ] **Step 2: Thread it through `publishUpdated`** (in `src/application/services/story-map-service.ts`)

```typescript
/** Publishes `storymap.updated` so live views re-render after a write. */
private async publishUpdated(
  map: Pick<StoryMap, "id" | "path">,
  origin?: string,
): Promise<void> {
  await this.eventBus.publish(
    createEvent(
      "storymap.updated",
      { storyMapId: map.id, path: String(map.path), ...(origin !== undefined ? { origin } : {}) },
      { correlationId: map.id },
    ),
  );
}
```

(Existing callers `rebuildGrid`/`writeCards` call `publishUpdated(map)` with no origin — unchanged.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
npm run format
git add src/domain/events/domain-event.ts src/application/services/story-map-service.ts
git commit -m "feat(story-map): optional origin on storymap.updated for self-event guard"
```

---

## Task 6: `saveMap(id, model, origin?)` on the service

**Files:**
- Modify: `src/application/services/story-map-service.ts`
- Test: `tests/story-map-service.test.ts`

Generalises `writeCards` to persist the **whole** card list of an externally-mutated model (the board's working copy) under the mutation lock, validating each card against the normalized axes and the product anchor, regenerating the managed blocks, and publishing `storymap.updated` with the caller's `origin`.

- [ ] **Step 1: Write the failing test** (append to the card-authoring describe in `tests/story-map-service.test.ts`)

```typescript
describe("DefaultStoryMapService.saveMap", () => {
  it("persists a moved card and echoes the origin on the update event", async () => {
    const { service, fs, events } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "product: PRD-000",
        "activities:",
        "  - Author spec",
        "  - Run tests",
        "slices:",
        "  - Walking skeleton",
        "cards:",
        "  - UC-040 | Author spec | Walking skeleton",
        "---",
        "# SM-001: J",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );

    const loaded = await service.findById("SM-001");
    expect(loaded.ok && loaded.value).toBeTruthy();
    if (!loaded.ok || !loaded.value) return;
    const moved = moveCard(loaded.value, 0, { activity: "Run tests", slice: "Walking skeleton" });

    const result = await service.saveMap("SM-001", moved, "board-xyz");
    expect(result.ok).toBe(true);

    const note = fs.files.get(path) ?? "";
    expect(note).toContain("UC-040 | Run tests |  | Walking skeleton");
    const updated = events.find((e) => e.type === "storymap.updated");
    expect(updated?.payload).toMatchObject({ storyMapId: "SM-001", origin: "board-xyz" });
  });

  it("rejects a model whose card is off the map's axes, leaving the note untouched", async () => {
    const { service, fs } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "product: PRD-000",
        "activities:",
        "  - Author spec",
        "slices:",
        "  - Walking skeleton",
        "cards:",
        "  - UC-040 | Author spec | Walking skeleton",
        "---",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    const loaded = await service.findById("SM-001");
    if (!loaded.ok || !loaded.value) return;
    // Move onto a slice that doesn't exist on the map.
    const bad = { ...loaded.value, cards: [{ ...loaded.value.cards[0], slice: "Ghost" }] };
    const result = await service.saveMap("SM-001", bad, "board-xyz");
    expect(result.ok).toBe(false);
    expect(fs.files.get(path)).toContain("(empty)");
  });
});
```

> Add `moveCard` to the test file's `../src/domain/entities/story-map` import. `build(...)` returns `{ service, fs, types, events }` where `events` is a `DomainEvent[]` array (each with `.type` and `.payload`) — so use `events.find(...)`, not `events()`.

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map-service.test.ts`
Expected: FAIL (`saveMap` not a function).

- [ ] **Step 3: Add `saveMap` to the interface and implementation**

In the `StoryMapService` interface (add after `removeCard`):

```typescript
  /**
   * Persists an externally-mutated model (the board's working copy): rewrites the
   * `cards` frontmatter and regenerates the managed blocks under the mutation
   * lock, after validating every card against the normalized axes and the product
   * anchor. Publishes `storymap.updated` carrying `origin` so the caller can skip
   * the reload it caused. Returns the persisted map.
   */
  saveMap(id: StoryMapId, model: StoryMap, origin?: string): Promise<Result<StoryMap>>;
```

In `DefaultStoryMapService`, add the method (mirrors `mutateCards` + `writeCards`, but takes the whole model and threads `origin`):

```typescript
async saveMap(id: StoryMapId, model: StoryMap, origin?: string): Promise<Result<StoryMap>> {
  return this.noteWrites.run(STORY_MAP_MUTATE_KEY, async () => {
    const found = await this.findById(id);
    if (!found.ok) return found;
    if (!found.value) {
      return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
    }
    // Persist card placements against the AUTHORITATIVE on-disk axes (the board
    // only moves cards in P2; it does not change activities/slices/steps), so a
    // stale board model can't smuggle off-axis structure into the note.
    const axes = found.value;
    for (const card of model.cards) {
      const reason = validateCardPlacement(axes, card);
      if (reason !== null) return err(appError("VALIDATION_FAILED", reason));
    }
    const resolvable = await this.requireResolvableProduct(axes.product);
    if (!resolvable.ok) return resolvable;
    return this.writeCards({ ...axes, cards: model.cards }, origin);
  });
}
```

Widen `writeCards` to accept and forward `origin`:

```typescript
private async writeCards(map: StoryMap, origin?: string): Promise<Result<StoryMap>> {
  const read = await this.fs.readFile(map.path);
  if (!read.ok) return read;
  const noteNames = await this.resolveNoteNames(map);
  const normalized = read.value.replace(/\r\n/g, "\n");
  const withCards = updateNoteFrontmatter(normalized, {
    cards: map.cards.length > 0 ? map.cards.map(encodeCard) : undefined,
  });
  const { body } = parseNote(withCards);
  const nextBody = refreshManagedBlocks(body, map, noteNames);
  const frontmatter = withCards.slice(0, withCards.length - body.length);
  const written = await this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
  if (!written.ok) return written;
  await this.publishUpdated(map, origin);
  return ok(map);
}
```

> `mutateCards` calls `this.writeCards({ ...map, cards: ... })` with no origin — unchanged (origin defaults to undefined). Validate the card list against `axes` (the on-disk map) rather than `model` so the board can't rewrite structure; P3 will add structure edits with their own validation.

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/application/services/story-map-service.ts tests/story-map-service.test.ts
git commit -m "feat(story-map): saveMap persists a board-mutated model under the lock"
```

---

## Task 7: Wire drag/drop into the board view

**Files:**
- Modify: `src/presentation/views/story-map-board-view.ts`
- Modify: `src/register-views.ts`

No unit test (thin view, AGENTS.md). Keep each method's cyclomatic complexity ≤ 4 (delegate to the pure ops/hit-test). The view holds a working model, applies a move optimistically, re-renders, debounces `saveMap`, reverts on failure, and ignores `storymap.updated` events it caused.

- [ ] **Step 1: Widen the injected service** (`src/register-views.ts` — the board view factory)

Change the board's dep type so it can save. Find the `new StoryMapBoardView(leaf, { storyMapService: ..., eventBus })` registration and ensure the passed `storyMapService` includes `saveMap` (it already passes the full `s.storyMapService`; only the `Pick<>` in the view's deps needs widening — Step 2).

- [ ] **Step 2: Update the board view**

```typescript
// src/presentation/views/story-map-board-view.ts
import { type WorkspaceLeaf } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { StoryMap } from "../../domain/entities/story-map";
import { moveCard } from "../../domain/entities/story-map";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderLoadError } from "./modal-helpers";
import { buildBoardScene } from "./story-map-board-scene";
import { type BoardLayout, computeBoardLayout, resolveDropTarget } from "./story-map-board-layout";
import { makeCardDraggable, makeCellDropTarget } from "./story-map-board-dnd";

export const STORY_MAP_BOARD_VIEW_TYPE = "e2e-test-hub-story-map-board";

/** Close the board if its map is deleted; updated events are handled manually (origin guard). */
const REFRESH_ON: DomainEventType[] = ["storymap.deleted"];
const SAVE_DEBOUNCE_MS = 300;

export interface StoryMapBoardDeps {
  storyMapService: Pick<StoryMapService, "findById" | "saveMap">;
  eventBus: EventBus;
}

interface BoardState {
  storyMapId?: string;
}

/**
 * Interactive Story Map board (P2): drag a card to another cell and the move is
 * persisted via debounced saveMap. Holds an in-memory working model; ignores the
 * storymap.updated event its own save publishes (origin guard) and reloads only
 * on external updates. Thin: geometry + ops live in the pure modules.
 */
export class StoryMapBoardView extends LiveDashboardView {
  private storyMapId: string | null = null;
  private isOpen = false;
  private model: StoryMap | null = null;
  private readonly origin = `board-${Math.random().toString(36).slice(2)}`;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanups: Array<() => void> = [];
  private unsubscribeUpdated: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: StoryMapBoardDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
  }

  getViewType(): string {
    return STORY_MAP_BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Story Map board";
  }

  getIcon(): string {
    return "layout-grid";
  }

  getState(): Record<string, unknown> {
    return { storyMapId: this.storyMapId ?? undefined };
  }

  // fallow-ignore-next-line complexity
  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const next = (state as BoardState | null)?.storyMapId;
    if (typeof next === "string" && next !== this.storyMapId) {
      this.storyMapId = next;
      if (this.isOpen) await this.live.schedule();
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.isOpen = true;
    // Manual subscription so we can inspect the payload's origin (LiveDashboardView
    // refreshes blindly). External updates reload; our own saves are ignored.
    this.unsubscribeUpdated = this.deps.eventBus.subscribe("storymap.updated", (event) => {
      const payload = event.payload as { storyMapId?: string; origin?: string };
      if (payload.storyMapId !== this.storyMapId) return;
      if (payload.origin === this.origin) return;
      void this.live.schedule();
    });
    await this.live.open(this.refreshOn);
  }

  async onClose(): Promise<void> {
    this.isOpen = false;
    this.flushSave();
    this.teardownDnd();
    this.unsubscribeUpdated?.();
    this.unsubscribeUpdated = null;
    this.live.close();
  }

  // fallow-ignore-next-line complexity
  protected async render(): Promise<void> {
    const container = this.contentEl;
    this.teardownDnd();
    container.empty();
    container.addClass("sm-board-container");
    if (this.storyMapId === null) {
      container.createEl("p", { text: "Open a Story Map from the explorer to see its board." });
      return;
    }
    const found = await this.deps.storyMapService.findById(this.storyMapId);
    if (!found.ok) {
      renderLoadError(
        container,
        `Could not load the board: ${found.error.message}`,
        `Retry loading the board for ${this.storyMapId}`,
        () => void this.live.schedule(),
      );
      return;
    }
    if (!found.value) {
      container.createEl("p", { text: `Story Map ${this.storyMapId} was not found.` });
      return;
    }
    this.model = found.value;
    this.paint(container);
  }

  /** Renders the current working model + wires drag/drop. Re-callable after a move. */
  private paint(container: HTMLElement): void {
    if (this.model === null) return;
    container.empty();
    container.createEl("h2", { text: this.model.title, cls: "sm-board-title" });
    const layout = computeBoardLayout(this.model);
    const svg = this.renderSvg(container, layout);
    this.wireDnd(svg, layout);
  }

  /** Builds the `<svg>` from the scene specs and returns it. */
  private renderSvg(container: HTMLElement, layout: BoardLayout): SVGSVGElement {
    const svg = container.createSvg("svg", {
      cls: "sm-board-svg",
      attr: {
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        width: layout.width,
        height: layout.height,
      },
    });
    for (const spec of buildBoardScene(layout)) {
      const el = svg.createSvg(spec.tag, { cls: spec.class });
      for (const [k, v] of Object.entries(spec.attrs)) el.setAttribute(k, String(v));
      if (spec.text !== undefined) el.textContent = spec.text;
    }
    return svg;
  }

  /** Makes each card-rect draggable and the whole board a drop surface. */
  private wireDnd(svg: SVGSVGElement, layout: BoardLayout): void {
    for (const rect of Array.from(svg.querySelectorAll("rect.sm-board-card"))) {
      const index = Number(rect.getAttribute("data-card-index"));
      if (Number.isNaN(index)) continue;
      this.cleanups.push(
        makeCardDraggable(rect, index, (dragging) => rect.classList.toggle("is-dragging", dragging)),
      );
    }
    this.cleanups.push(
      makeCellDropTarget(
        svg,
        { activity: "", slice: "" }, // unused: target is resolved from the drop point below
        () => undefined,
        () => undefined,
      ),
    );
    // The whole-SVG drop target above is a placeholder; real target resolution is
    // by pointer position. Wire a native drop listener that converts the drop
    // point to board coordinates and resolves the cell via the pure hit-test.
    svg.addEventListener("drop", (ev) => this.onSvgDrop(ev, svg, layout));
    svg.addEventListener("dragover", (ev) => ev.preventDefault());
  }

  // fallow-ignore-next-line complexity
  private onSvgDrop(ev: DragEvent, svg: SVGSVGElement, layout: BoardLayout): void {
    // NOTE: Pragmatic-DnD carries the dragged card index via its own monitor; in
    // this thin wiring we read it from the element flagged .is-dragging. Convert
    // the screen point to board space (identity scale at P2) via the SVG CTM.
    const dragging = svg.querySelector("rect.sm-board-card.is-dragging");
    if (dragging === null || this.model === null) return;
    const cardIndex = Number(dragging.getAttribute("data-card-index"));
    const point = this.toBoardPoint(svg, ev.clientX, ev.clientY);
    const target = resolveDropTarget(layout, point);
    if (target === null || Number.isNaN(cardIndex)) return;
    const moved = moveCard(this.model, cardIndex, target, target.indexInCell);
    if (moved === this.model) return;
    this.model = moved;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /** Screen → board coordinates using the SVG's CTM (identity-ish at P2). */
  private toBoardPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
    const ctm = svg.getScreenCTM();
    if (ctm === null) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  // fallow-ignore-next-line complexity
  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.model === null || this.storyMapId === null) return;
    const snapshot = this.model;
    const result = await this.deps.storyMapService.saveMap(this.storyMapId, snapshot, this.origin);
    if (!result.ok) {
      new Notice(`Could not save the board: ${result.error.message}`);
      await this.live.schedule(); // reload the last-saved state (revert the optimistic move)
    }
  }

  private teardownDnd(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }
}
```

> **Implementer notes (verify against the codebase, adjust as needed):**
> - Import `Notice` from `obsidian` (add to the top import).
> - Confirm `EventBus.subscribe(type, handler)` returns an unsubscribe function and the handler receives a `DomainEvent` with `.payload`. If the signature differs (e.g. returns void, or takes a different shape), match it — keep the origin check (`payload.origin === this.origin`) regardless.
> - The drag-index-via-`.is-dragging` shortcut keeps the wiring thin; if Pragmatic-DnD's monitor API is cleaner for reading the source data on drop, prefer `monitorForElements` and read `source.data.cardIndex` (from `story-map-board-dnd.ts`) instead of the DOM flag. Either is acceptable so long as the move goes through `moveCard` + `saveMap`.
> - If a method exceeds the fallow cyclomatic limit, extract a helper (the gate is blocking). The pure ops already hold the logic, so the view methods should stay small.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Build, load the plugin in a vault, open a Story Map board, drag a card to another cell, confirm the note's `cards` frontmatter + grid table update and the card stays put after a reload.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-view.ts src/register-views.ts
git commit -m "feat(story-map-board): drag cards between cells with debounced save"
```

---

## Task 8: Drag styles + CONTEXT note + full gate + push

**Files:**
- Modify: `styles.css`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Add drag affordances** (append to the board block in `styles.css`)

```css
.sm-board-card { cursor: grab; }
.sm-board-card.is-dragging { opacity: 0.5; cursor: grabbing; }
.sm-board-svg.is-drop-active .sm-board-card { pointer-events: none; }
```

- [ ] **Step 2: Update the CONTEXT term** (the "Story Map Board" entry — replace the P1 "read-only" sentence)

```markdown
P1 shipped the read-only board; P2 adds drag-and-drop: a card can be dragged to
another (activity, step, slice) cell or reordered within a cell, persisted to the
`cards` frontmatter via a debounced save. Later phases add structure edits, inline
editing, and zoom/pan.
```

- [ ] **Step 3: Run the full gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit`
Expected: all pass; `test:coverage` ≥ 80%; `quality:audit` exits 0. Fix any finding (keep view methods within the cyclomatic limit; no unused exports; the new dep must not trip an architecture-boundary rule — it is imported only by `story-map-board-dnd.ts`).

- [ ] **Step 4: Commit + push**

```bash
git add styles.css CONTEXT.md
git commit -m "docs(story-map-board): P2 drag — styles + CONTEXT"
git push origin claude/storymaps-prd-tooling-k9tpnx
```

---

## Self-review (done while writing)

- **Spec coverage (P2 slice):** drag card → another cell ✓ (Tasks 2, 4, 7); reorder within a cell ✓ (Tasks 3, 4, 7 — same drop path); debounced `saveMap` ✓ (Tasks 6, 7); self-event guard ✓ (Tasks 5, 7 origin token); validation + revert-on-failure ✓ (Tasks 6, 7); Pragmatic-DnD behind a swappable adapter ✓ (Task 1). The §2 transform-spike is **explicitly deferred to P5** (no zoom transform exists yet) — flagged in Task 1.
- **Deferred to later plans:** reorder/add/remove structure (P3), inline edit + color (P4), zoom/pan + focus (P5), partials (follow-up). `saveMap` validates cards against the on-disk axes, so the board can't change structure in P2 — P3 widens it.
- **Types consistent:** `CardTarget`, `moveCard`, `reorderCardInCell`, `BoardPoint`, `DropTarget`, `resolveDropTarget`, `CardDragData`/`CellDropData`, `saveMap(id, model, origin?)`, `publishUpdated(map, origin?)`, the `origin` payload field, and `STORY_MAP_BOARD_VIEW_TYPE` are used consistently across tasks.
- **Implementer caveats flagged, not placeholders:** the `EventBus.subscribe` signature, the Pragmatic-DnD monitor-vs-DOM-flag drop read, the `recordingEventBus().events()` shape, and the `_step` rest-destructure lint rule are each called out with concrete guidance to verify against the codebase.

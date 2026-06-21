# Story Map Visual Board — P3 (Reorder structure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder a Story Map's **activities** (drag a column header) and **release slices** (drag a row header) directly on the board, persisted to the note frontmatter via the existing debounced save — by widening `saveMap` to persist the whole structure (not just cards) under optimistic concurrency.

**Architecture:** Reordering is pure domain ops on `StoryMap` (`reorderActivity`, `reorderSlice`) that only permute the `activities`/`slices` label arrays — cards reference labels by string, so placement is unaffected. The board's pointer hit-test (`resolveActivityDropIndex`/`resolveSliceDropIndex`) is pure. `saveMap` is widened to normalize + validate + persist the full structure (users/activities/steps/slices/cards) and its staleness baseline generalizes from "cards" to a whole-map **signature**. The drag wiring reuses the P2 interact.js adapter (headers become draggable).

**Tech Stack:** TypeScript, Obsidian `ItemView`, SVG/DOM, interact.js, Vitest. Reuses `src/domain/entities/story-map.ts`, `src/presentation/views/story-map-board-layout.ts`/`-scene.ts`/`-view.ts`/`-dnd.ts`, and the `saveMap`/`writeCards`/`refreshManagedBlocks` pipeline.

**Spec:** `docs/superpowers/specs/2026-06-19-story-map-board-design.md` (§4 rows 3–4, §9 P3). **Scope note:** the spec's P3 ("reorder & edit structure") is split — **this plan covers reordering activities + slices**. Deferred to the next plan: **step reordering** (drag step-column headers within an activity) and **add/remove** structure (activities/steps/slices/cards on the board). Each lands gate-green on branch `claude/storymaps-prd-tooling-k9tpnx` (PR #68).

**Gate after every commit:** `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit` (audit must exit 0). Run `npm run format` before committing. Commit message trailers (every commit):
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BxcuwMGwcXWKAfwMHF73P3
```

---

## File structure (P3)

- Modify `src/domain/entities/story-map.ts` — `reorderActivity`, `reorderSlice`, the shared `moveInArray` helper, and `storyMapSignature` (the optimistic-concurrency baseline).
- Modify `tests/story-map.test.ts` — op + signature tests.
- Modify `src/presentation/views/story-map-board-layout.ts` — `resolveActivityDropIndex`, `resolveSliceDropIndex`.
- Modify `tests/story-map-board-layout.test.ts` — hit-test tests.
- Modify `src/presentation/views/story-map-board-scene.ts` — `data-activity-index` / `data-slice-index` on the header rects so the drag wiring can identify them.
- Modify `tests/story-map-board-scene.test.ts` — assert the data attrs.
- Modify `src/application/services/story-map-service.ts` — widen `saveMap` to persist the full normalized structure with a signature-based staleness check; add `writeMap`. Generalize the P2 `expectedCards` baseline → `expected?: string` (signature).
- Modify `tests/story-map-service.test.ts` — `saveMap` structure-persistence + signature-staleness tests (update the P2 baseline test to the signature).
- Modify `src/presentation/views/story-map-board-view.ts` — make activity/slice headers draggable; on drop, reorder + save; switch the baseline field to a signature string.
- Modify `styles.css` — header drag affordance.
- Modify `CONTEXT.md` — note the board now reorders structure.

Index alignment (relied on below): every activity gets ≥1 grid column, so `layout.activityGroups[i].activity === map.activities[i]`; rows are built from `map.slices` in order, so `layout.rows[i].slice === map.slices[i]`. The header drag carries the source index from a `data-*-index` attribute and resolves the target index by pointer position.

---

## Task 1: Pure reorder ops + map signature

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/story-map.test.ts`; add `reorderActivity`, `reorderSlice`, `storyMapSignature` to the `../src/domain/entities/story-map` import)

```typescript
describe("reorderActivity / reorderSlice", () => {
  const map = (): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse", "Order", "Pay"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next", "Later"],
    cards: [{ title: "A", activity: "Order", slice: "Next", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("moves an activity to a new position, leaving cards' labels intact", () => {
    const next = reorderActivity(map(), 2, 0); // Pay → front
    expect(next.activities).toEqual(["Pay", "Browse", "Order"]);
    expect(next.cards[0].activity).toBe("Order"); // card still references its label
  });

  it("moves a slice to a new position", () => {
    expect(reorderSlice(map(), 0, 2).slices).toEqual(["Next", "Later", "Walking skeleton"]);
  });

  it("returns the same map reference for a no-op (equal or out-of-range index)", () => {
    const m = map();
    expect(reorderActivity(m, 1, 1)).toBe(m);
    expect(reorderActivity(m, 9, 0)).toBe(m);
    expect(reorderSlice(m, 0, 9)).toBe(m);
  });
});

describe("storyMapSignature", () => {
  const base: StoryMap = {
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: ["U"],
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton"],
    cards: [{ title: "A", activity: "Browse", slice: "Walking skeleton", tags: [] }],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  };

  it("is stable for the same structure and changes when structure changes", () => {
    expect(storyMapSignature(base)).toBe(storyMapSignature({ ...base }));
    expect(storyMapSignature(base)).not.toBe(
      storyMapSignature({ ...base, activities: ["Order", "Browse"] }),
    );
    expect(storyMapSignature(base)).not.toBe(
      storyMapSignature({ ...base, slices: ["Walking skeleton", "Next"] }),
    );
  });

  it("ignores non-structural fields (title/status/displayOrder/path)", () => {
    expect(storyMapSignature(base)).toBe(
      storyMapSignature({ ...base, title: "Renamed", status: "active", displayOrder: 9 }),
    );
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map.test.ts`
Expected: FAIL (`reorderActivity`/`reorderSlice`/`storyMapSignature` not exported).

- [ ] **Step 3: Implement** (add after `reorderCardInCell` in `src/domain/entities/story-map.ts`)

```typescript
/**
 * Moves the item at `from` to `to`, returning a NEW array — or the SAME reference
 * when the move is a no-op (out of range or `from === to`), so callers can detect
 * "nothing changed". Pure.
 */
const moveInArray = <T>(arr: readonly T[], from: number, to: number): readonly T[] => {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
};

/**
 * Reorders the activity at `from` to position `to` on the backbone. Cards
 * reference activities by label (a string), so reordering never breaks placement.
 * Returns the same map reference on a no-op. Pure: no I/O.
 */
export const reorderActivity = (map: StoryMap, from: number, to: number): StoryMap => {
  const next = moveInArray(map.activities, from, to);
  return next === map.activities ? map : { ...map, activities: [...next] };
};

/** Reorders the release slice at `from` to position `to`. Same contract as {@link reorderActivity}. */
export const reorderSlice = (map: StoryMap, from: number, to: number): StoryMap => {
  const next = moveInArray(map.slices, from, to);
  return next === map.slices ? map : { ...map, slices: [...next] };
};

/**
 * A stable signature of a map's STRUCTURAL fields (users, activities, steps,
 * slices, cards) — the optimistic-concurrency baseline a board carries so a save
 * can detect that another surface changed the structure since it loaded.
 * Excludes title/status/displayOrder/path (a rename must not block a board save).
 * Pure: no I/O.
 */
export const storyMapSignature = (map: StoryMap): string =>
  JSON.stringify([
    map.users,
    map.activities,
    map.steps.map(encodeStep),
    map.slices,
    map.cards.map(encodeCard),
  ]);
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): pure reorderActivity/reorderSlice + map signature"
```

---

## Task 2: Pure header drop-index hit-tests

**Files:**
- Modify: `src/presentation/views/story-map-board-layout.ts`
- Test: `tests/story-map-board-layout.test.ts`

- [ ] **Step 1: Write the failing test** (append; add `resolveActivityDropIndex`, `resolveSliceDropIndex` to the import)

```typescript
describe("resolveActivityDropIndex / resolveSliceDropIndex", () => {
  const m = map({
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next"],
    cards: [],
  });

  it("returns the activity-group index under a board-x point", () => {
    const layout = computeBoardLayout(m);
    expect(resolveActivityDropIndex(layout, layout.activityGroups[0].x + 5)).toBe(0);
    expect(resolveActivityDropIndex(layout, layout.activityGroups[1].x + 5)).toBe(1);
  });

  it("returns the slice-row index under a board-y point", () => {
    const layout = computeBoardLayout(m);
    expect(resolveSliceDropIndex(layout, layout.rows[1].y + 5)).toBe(1);
  });

  it("returns null outside every column / row", () => {
    const layout = computeBoardLayout(m);
    expect(resolveActivityDropIndex(layout, -50)).toBeNull();
    expect(resolveSliceDropIndex(layout, -50)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map-board-layout.test.ts`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement** (add to `src/presentation/views/story-map-board-layout.ts`)

```typescript
/**
 * The activity index under board-x `x` (the drop slot for a dragged column
 * header), or null when `x` is outside every activity group. `activityGroups` is
 * in `map.activities` order, so the returned index addresses `map.activities`.
 * Pure.
 */
export const resolveActivityDropIndex = (layout: BoardLayout, x: number): number | null => {
  const i = layout.activityGroups.findIndex((g) => x >= g.x && x < g.x + g.width);
  return i === -1 ? null : i;
};

/**
 * The slice index under board-y `y` (the drop slot for a dragged row header), or
 * null when `y` is outside every row. `rows` is in `map.slices` order. Pure.
 */
export const resolveSliceDropIndex = (layout: BoardLayout, y: number): number | null => {
  const i = layout.rows.findIndex((r) => y >= r.y && y < r.y + r.height);
  return i === -1 ? null : i;
};
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map-board-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-layout.ts tests/story-map-board-layout.test.ts
git commit -m "feat(story-map-board): pure header drop-index hit-tests"
```

---

## Task 3: Tag header rects with their index in the scene

**Files:**
- Modify: `src/presentation/views/story-map-board-scene.ts`
- Test: `tests/story-map-board-scene.test.ts`

The board drag needs to know which activity/slice a dragged header is. Add `data-activity-index` to each activity-group rect and `data-slice-index` to each slice-row header rect.

- [ ] **Step 1: Write the failing test** (append to `tests/story-map-board-scene.test.ts`)

```typescript
it("tags activity and slice headers with their index for drag-reorder", () => {
  const specs = buildBoardScene(computeBoardLayout(map));
  const activity = specs.find((s) => s.class === "sm-board-activity");
  const slice = specs.find((s) => s.class === "sm-board-slice");
  expect(activity?.attrs["data-activity-index"]).toBe(0);
  expect(slice?.attrs["data-slice-index"]).toBe(0);
});
```

> The existing test file already builds a `map` fixture with one activity ("Browse") and one slice ("Walking skeleton"); reuse it. If its name differs, adapt.

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map-board-scene.test.ts`
Expected: FAIL (attr undefined).

- [ ] **Step 3: Implement** — in `buildBoardScene`, change the activity-group and slice-row loops to carry the index:

```typescript
  // Activity group headers.
  layout.activityGroups.forEach((g, i) => {
    specs.push(
      rect("sm-board-activity", g.x, M.laneHeight, g.width, M.activityHeaderHeight, {
        "data-activity-index": i,
      }),
    );
    specs.push(
      text(
        "sm-board-activity-label",
        g.x + 8,
        M.laneHeight + M.activityHeaderHeight / 2 + 4,
        g.activity,
      ),
    );
  });

  // Slice row headers.
  layout.rows.forEach((r, i) => {
    specs.push(
      rect("sm-board-slice", 0, r.y, M.rowHeaderWidth, r.height, { "data-slice-index": i }),
    );
    specs.push(text("sm-board-slice-label", 8, r.y + 18, r.slice));
  });
```

> These replace the existing `for (const g of layout.activityGroups)` and `for (const r of layout.rows)` blocks. Leave the step (column) headers and cards loops unchanged.

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map-board-scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-scene.ts tests/story-map-board-scene.test.ts
git commit -m "feat(story-map-board): tag header rects with their index"
```

---

## Task 4: Widen `saveMap` to persist the full structure

**Files:**
- Modify: `src/application/services/story-map-service.ts`
- Test: `tests/story-map-service.test.ts`

P2's `saveMap` persists only cards (validated against the on-disk axes) and its staleness baseline is `expectedCards`. P3 lets the board change structure, so `saveMap` must normalize + validate + persist the model's full structure, and the baseline generalizes to a `storyMapSignature`.

- [ ] **Step 1: Write the failing test** (append to the `saveMap` describe; update the existing P2 stale test to use the signature)

```typescript
it("persists a reordered backbone and slices (full structure), not just cards", async () => {
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
      "  - Run tests",
      "slices:",
      "  - Walking skeleton",
      "  - Next",
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
  const reordered = reorderActivity(reorderSlice(loaded.value, 0, 1), 0, 1);

  const result = await service.saveMap("SM-001", reordered, "board-xyz");
  expect(result.ok).toBe(true);

  const reread = await service.findById("SM-001");
  if (!reread.ok || !reread.value) return;
  expect(reread.value.activities).toEqual(["Run tests", "Author spec"]);
  expect(reread.value.slices).toEqual(["Next", "Walking skeleton"]);
});

it("rejects a stale board save whose signature no longer matches the on-disk map", async () => {
  const { service, fs } = build({
    "UC-040": "Use Cases/UC-040 Run the suite.md",
    "UC-041": "Use Cases/UC-041 Other.md",
  });
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
      "<!-- story-map-grid:start -->",
      "(empty)",
      "<!-- story-map-grid:end -->",
    ].join("\n"),
  );
  const loaded = await service.findById("SM-001");
  if (!loaded.ok || !loaded.value) return;
  const baseline = storyMapSignature(loaded.value);
  // Another surface adds a card after the board loaded.
  await service.addCard("SM-001", {
    ref: "UC-041",
    title: "Other",
    activity: "Run tests",
    slice: "Walking skeleton",
    tags: [],
  });
  const result = await service.saveMap("SM-001", reorderSlice(loaded.value, 0, 0), "board-xyz", baseline);
  expect(result.ok).toBe(false);
  expect(fs.files.get(path)).toContain("UC-041");
});
```

> Add `reorderActivity`, `reorderSlice`, `storyMapSignature` to the test's `../src/domain/entities/story-map` import (it already imports `encodeCard`, `moveCard`). The previously-added P2 stale test used `encodeCard`-based `expectedCards`; replace that test body's baseline with `storyMapSignature(loaded.value)` (the signature now covers cards too), or delete it in favour of the signature test above — keep exactly one stale-rejection test.

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map-service.test.ts`
Expected: FAIL (structure not persisted; `expected` param is still cards-only).

- [ ] **Step 3: Implement**

In `src/domain/entities/story-map.ts` imports of the service, add `encodeStep` and `storyMapSignature` to the existing domain import.

Replace `staleCardsError` with a signature check, and replace `saveMap`'s body + add `writeMap`:

```typescript
// Replace the `staleCardsError` helper:
/**
 * The error when a board's save baseline no longer matches the on-disk map's
 * structure (another surface changed it since the board loaded), or null when the
 * save may proceed. `expected` is the {@link storyMapSignature} the board loaded;
 * undefined opts out (non-board callers). Pure.
 */
const staleSignatureError = (current: StoryMap, expected: string | undefined): string | null => {
  if (expected === undefined) return null;
  return storyMapSignature(current) === expected
    ? null
    : "The Story Map changed elsewhere — reload the board and retry.";
};
```

```typescript
// saveMap — replace the whole method:
async saveMap(
  id: StoryMapId,
  model: StoryMap,
  origin?: string,
  expected?: string,
): Promise<Result<StoryMap>> {
  return this.noteWrites.run(STORY_MAP_MUTATE_KEY, async () => {
    const found = await this.findById(id);
    if (!found.ok) return found;
    if (!found.value) {
      return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
    }
    const onDisk = found.value;
    // Optimistic concurrency: reject if the on-disk structure changed since the
    // board loaded, rather than overwrite those edits with the board's stale copy.
    const stale = staleSignatureError(onDisk, expected);
    if (stale !== null) return err(appError("VALIDATION_FAILED", stale));

    // Normalize the board's structure exactly like create(), so a board (or
    // hand) edit can't persist duplicate/blank axes, then validate every card
    // against the NEW axes (the board may have reordered them).
    const activities = normalizeLabels(model.activities);
    if (activities.length === 0) {
      return err(appError("VALIDATION_FAILED", "A Story Map needs at least one activity."));
    }
    const slices = normalizeLabels(model.slices);
    if (slices.length === 0) {
      return err(appError("VALIDATION_FAILED", "A Story Map needs at least one release slice."));
    }
    const users = normalizeLabels(model.users);
    const steps = normalizeSteps(model.steps, activities);
    for (const card of model.cards) {
      const reason = validateCardPlacement({ activities, slices, steps }, card);
      if (reason !== null) return err(appError("VALIDATION_FAILED", reason));
    }
    const resolvable = await this.requireResolvableProduct(onDisk.product);
    if (!resolvable.ok) return resolvable;

    // Persist the on-disk identity (id/path/product/displayOrder) with the
    // board's normalized structure.
    return this.writeMap(
      { ...onDisk, users, activities, steps, slices, cards: model.cards },
      origin,
    );
  });
}

/**
 * Persists the full structure (users/activities/steps/slices/cards) frontmatter
 * and regenerates the managed blocks, leaving id/product/hand-written body
 * untouched. CRLF-safe, mirrors {@link writeCards} but for every structural
 * field. Publishes `storymap.updated` with `origin`.
 */
private async writeMap(map: StoryMap, origin?: string): Promise<Result<StoryMap>> {
  const read = await this.fs.readFile(map.path);
  if (!read.ok) return read;
  const noteNames = await this.resolveNoteNames(map);
  const normalized = read.value.replace(/\r\n/g, "\n");
  const updated = updateNoteFrontmatter(normalized, {
    users: map.users.length > 0 ? map.users : undefined,
    activities: map.activities.length > 0 ? map.activities : undefined,
    steps: map.steps.length > 0 ? map.steps.map(encodeStep) : undefined,
    slices: map.slices.length > 0 ? map.slices : undefined,
    cards: map.cards.length > 0 ? map.cards.map(encodeCard) : undefined,
  });
  const { body } = parseNote(updated);
  const nextBody = refreshManagedBlocks(body, map, noteNames);
  const frontmatter = updated.slice(0, updated.length - body.length);
  const written = await this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
  if (!written.ok) return written;
  await this.publishUpdated(map, origin);
  return ok(map);
}
```

Update the `StoryMapService` interface `saveMap` signature to `expected?: string` (was `expectedCards?: string[]`), and update its doc comment to say "the {@link storyMapSignature} the board loaded".

> Add `encodeStep` and `storyMapSignature` to the service's `../../domain/entities/story-map` import. `updateNoteFrontmatter` already handles array fields (it writes `cards`); setting a field to `undefined` removes it (so an emptied `users` clears the key). If `saveMap`/`writeMap` exceed the fallow cyclomatic limit, extract the normalize-and-validate block into a pure module-level helper returning `Result<{users,activities,steps,slices}>` — keep the method thin.

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/application/services/story-map-service.ts tests/story-map-service.test.ts
git commit -m "feat(story-map): saveMap persists the full structure under signature concurrency"
```

---

## Task 5: Drag-reorder activity & slice headers on the board

**Files:**
- Modify: `src/presentation/views/story-map-board-view.ts`

No unit test (thin view, AGENTS.md). Keep each method's cyclomatic complexity ≤ 4 (delegate to the pure ops/hit-tests); use `// fallow-ignore-next-line complexity` consistent with the file's existing pattern only where unavoidable. Switch the optimistic-concurrency baseline from `baselineCards: string[]` to `baseline: string` (a `storyMapSignature`), and make the headers draggable alongside the cards.

- [ ] **Step 1: Update imports + baseline field**

```typescript
// add to the domain import:
import { encodeCard, moveCard, reorderActivity, reorderSlice, storyMapSignature } from "../../domain/entities/story-map";
// add to the layout import:
import {
  type BoardLayout,
  computeBoardLayout,
  resolveActivityDropIndex,
  resolveDropTarget,
  resolveSliceDropIndex,
} from "./story-map-board-layout";
```

Replace the `baselineCards: string[]` field and its `pendingSave.expected: string[]` with a signature string:

```typescript
  /** The map signature as loaded — the optimistic-concurrency baseline for saves. */
  private baseline = "";
  private pendingSave: { id: string; model: StoryMap; expected: string } | null = null;
```

In `render`, set the baseline from the loaded map:

```typescript
    this.model = found.value;
    this.baseline = storyMapSignature(found.value);
    this.paint(container);
```

In `scheduleSave`, capture `expected: this.baseline`; in `flushSave`, call `saveMap(pending.id, pending.model, this.origin, pending.expected)` and on success set `this.baseline = storyMapSignature(pending.model)` (guarded on `pending.id === this.storyMapId`). In `setState`, reset `this.baseline = ""`.

- [ ] **Step 2: Make headers draggable + handle reorder drops**

In `wireDnd`, after the card-drag wiring, add header dragging. Extend the interact.js adapter call to also target headers, or add a second `makeCardsDraggable`-style call. Simplest: add a generic selector to the adapter. In `story-map-board-dnd.ts`, the selector is `.sm-board-card`; add a parallel export for headers, OR pass a selector. Recommended minimal change — add to `story-map-board-dnd.ts`:

```typescript
/** Makes every element matching `selector` inside `root` draggable. Same contract as makeCardsDraggable. */
export const makeDraggable = (
  root: HTMLElement,
  selector: string,
  callbacks: CardDragCallbacks,
): (() => void) => {
  const interactable = interact(selector, { context: root }).draggable({
    listeners: {
      start: (event: DragEventLike) => callbacks.onStart(event.target),
      end: (event: DragEventLike) =>
        callbacks.onEnd(event.target, event.client.x, event.client.y),
    },
  });
  return () => interactable.unset();
};
```

(and refactor `makeCardsDraggable` to call `makeDraggable(root, ".sm-board-card", callbacks)` to avoid duplication.)

Then in the view's `wireDnd`:

```typescript
  private wireDnd(svg: SVGSVGElement, layout: BoardLayout): void {
    this.cleanups.push(
      makeDraggable(this.contentEl, ".sm-board-card", {
        onStart: (el) => el.classList.add("is-dragging"),
        onEnd: (el, x, y) => this.onCardDrop(el, x, y, svg, layout),
      }),
    );
    this.cleanups.push(
      makeDraggable(this.contentEl, ".sm-board-activity", {
        onStart: (el) => el.classList.add("is-dragging"),
        onEnd: (el, x, y) => this.onHeaderDrop(el, "activity", x, y, svg, layout),
      }),
    );
    this.cleanups.push(
      makeDraggable(this.contentEl, ".sm-board-slice", {
        onStart: (el) => el.classList.add("is-dragging"),
        onEnd: (el, x, y) => this.onHeaderDrop(el, "slice", x, y, svg, layout),
      }),
    );
  }

  /** Reorders an activity or slice when its header is dropped over another. */
  private onHeaderDrop(
    el: SVGElement,
    kind: "activity" | "slice",
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): void {
    el.classList.remove("is-dragging");
    const next = this.buildReorder(el, kind, clientX, clientY, svg, layout);
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }

  /** Resolves a header drop to the reordered model, or null when invalid/no-op. */
  private buildReorder(
    el: SVGElement,
    kind: "activity" | "slice",
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    layout: BoardLayout,
  ): StoryMap | null {
    if (this.model === null) return null;
    const point = this.toBoardPoint(svg, clientX, clientY);
    if (kind === "activity") {
      const from = indexAttr(el, "data-activity-index");
      const to = resolveActivityDropIndex(layout, point.x);
      return from === null || to === null ? null : reorderActivity(this.model, from, to);
    }
    const from = indexAttr(el, "data-slice-index");
    const to = resolveSliceDropIndex(layout, point.y);
    return from === null || to === null ? null : reorderSlice(this.model, from, to);
  }
```

Add a module-level helper near `cardIndexFromElement`:

```typescript
/** Reads a non-negative integer index attribute, or null when missing/invalid. */
const indexAttr = (el: Element, name: string): number | null => {
  const raw = el.getAttribute(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
};
```

(Optionally refactor `cardIndexFromElement` to `indexAttr(el, "data-card-index")`.)

- [ ] **Step 3: Typecheck + build + audit**

Run: `npm run typecheck && npm run build && npm run quality:audit`
Expected: clean; audit exits 0. If a view method trips the complexity gate, extract or add the ignore comment consistent with the file.

- [ ] **Step 4: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-view.ts src/presentation/views/story-map-board-dnd.ts
git commit -m "feat(story-map-board): drag-reorder activity & slice headers"
```

---

## Task 6: Header drag styles + CONTEXT/ADR note + full gate + push

**Files:**
- Modify: `styles.css`
- Modify: `CONTEXT.md`
- Modify: `docs/adr/0029-story-map-visual-board.md`

- [ ] **Step 1: Header drag affordance** (append to the board block in `styles.css`)

```css
.sm-board-activity,
.sm-board-slice {
  cursor: grab;
  touch-action: none;
}

.sm-board-activity.is-dragging,
.sm-board-slice.is-dragging {
  cursor: grabbing;
  opacity: 0.6;
}
```

- [ ] **Step 2: Update the CONTEXT term** (the "Story Map Board" entry — extend the P2 sentence)

```markdown
P1 shipped the read-only board; P2 added card drag-and-drop; P3 adds structure
reordering — drag a column (activity) or row (slice) header to reorder it, persisted
through the same debounced, signature-guarded save. Later phases add step reorder,
add/remove of structure, inline editing, and zoom/pan.
```

- [ ] **Step 3: Note the saveMap widening in ADR-0029** (append to the Consequences list)

```markdown
- P3 widens `saveMap` to persist the whole structure (not just cards) under a
  whole-map signature baseline (optimistic concurrency), so the board can reorder
  activities/slices; the note frontmatter stays the single source of truth.
```

- [ ] **Step 4: Run the full gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit`
Expected: all pass; coverage ≥ 80%; audit exits 0.

- [ ] **Step 5: Commit + push**

```bash
git add styles.css CONTEXT.md docs/adr/0029-story-map-visual-board.md
git commit -m "docs(story-map-board): P3 structure reorder — styles + CONTEXT + ADR"
git push origin claude/storymaps-prd-tooling-k9tpnx
```

---

## Self-review (done while writing)

- **Spec coverage (P3 reorder slice):** reorder activities (drag column header) ✓ (Tasks 1, 2, 3, 5); reorder slices (drag row header) ✓ (same); persisted via the debounced save ✓ (Task 4 `saveMap` widening + Task 5 wiring); structure stays in the frontmatter (single source of truth) ✓. **Step reorder and add/remove structure are explicitly deferred** to the next plan (stated up front) — not silently dropped.
- **Data-safety:** `saveMap` now persists structure, so its staleness baseline is widened from cards to a full `storyMapSignature` (Task 1/4) — a concurrent structure change from another surface is rejected, not clobbered. Cards are re-validated against the board's new axes; an emptied backbone/slice list is rejected (mirrors create).
- **Types consistent:** `moveInArray`, `reorderActivity`, `reorderSlice`, `storyMapSignature`, `resolveActivityDropIndex`, `resolveSliceDropIndex`, `data-activity-index`/`data-slice-index`, `saveMap(id, model, origin?, expected?: string)`, `writeMap`, `makeDraggable`, `indexAttr`, `baseline: string` — used consistently across tasks.
- **Implementer caveats flagged, not placeholders:** the index-alignment assumption (`activityGroups[i] ↔ activities[i]`, `rows[i] ↔ slices[i]`), updating the P2 stale test to the signature, `updateNoteFrontmatter` clearing a field via `undefined`, and the complexity-gate fallback are each called out with concrete guidance.

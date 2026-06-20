# Story Map Board P3c — Remove structure + step reorder + add/remove cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the P3 structural-editing phase on the board: remove activities/slices/steps, reorder steps, and add/remove cards — all on the board, persisted via the existing debounced `saveMap`.

**Architecture:** Pure ops added to `story-map.ts` (each returns a new `StoryMap`, or `null` to reject); pure affordances added to `story-map-board-scene.ts` (`data-remove` / `data-add="card"`); the thin `StoryMapBoardView` wires clicks/drag to the ops and repaints+saves. Removal policy (product-owner decision): **reject** activity/slice removal when any card references it; **steps degrade** (removing a step drops the step from its cards, which then hang under the activity). New cards are **placeholders** ("New card"), renamed in place (P4).

**Tech Stack:** TypeScript, esbuild, vitest, interact.js (drag), Obsidian ItemView.

---

### Task 1: Domain — `removeActivity` / `removeSlice` (reject-if-referenced)

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/story-map.test.ts` (new `describe` block near the existing `addActivity / addSlice / addStepTo` block). Reuse the file's existing `makeMap`/map fixture helper (mirror how the add/rename describe blocks build their map).

```ts
describe("removeActivity / removeSlice", () => {
  const base = makeMap({
    activities: ["Browse", "Buy"],
    slices: ["MVP", "Later"],
    steps: [{ activity: "Browse", step: "Search" }],
    cards: [{ title: "C", activity: "Buy", slice: "MVP", tags: [] }],
  });

  it("removes an activity with no cards, dropping its steps", () => {
    const next = removeActivity(base, 0); // Browse has steps but no cards
    expect(next).not.toBeNull();
    expect(next?.activities).toEqual(["Buy"]);
    expect(next?.steps).toEqual([]);
  });

  it("rejects (null) removing an activity that has cards", () => {
    expect(removeActivity(base, 1)).toBeNull(); // Buy has a card
  });

  it("rejects an out-of-range activity index", () => {
    expect(removeActivity(base, 9)).toBeNull();
  });

  it("removes an unreferenced slice and rejects a referenced one", () => {
    expect(removeSlice(base, 1)?.slices).toEqual(["MVP"]); // Later has no cards
    expect(removeSlice(base, 0)).toBeNull(); // MVP has a card
    expect(removeSlice(base, 9)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/story-map.test.ts -t "removeActivity / removeSlice"`
Expected: FAIL — `removeActivity`/`removeSlice` are not defined.

- [ ] **Step 3: Implement the ops**

Add to `src/domain/entities/story-map.ts` (after `reorderSlice`):

```ts
/**
 * Removes the activity at `index` and its steps. REJECTS (returns null) when any
 * card references it — the product-owner policy is "reject if cards" so a card is
 * never silently orphaned. Null also on an out-of-range index. Pure: no I/O.
 */
export const removeActivity = (map: StoryMap, index: number): StoryMap | null => {
  const activity = map.activities[index];
  if (activity === undefined) return null;
  if (map.cards.some((c) => c.activity === activity)) return null;
  return {
    ...map,
    activities: map.activities.filter((_, i) => i !== index),
    steps: map.steps.filter((s) => s.activity !== activity),
  };
};

/** Removes the slice at `index`. Rejects when a card references it. Same contract as {@link removeActivity}. */
export const removeSlice = (map: StoryMap, index: number): StoryMap | null => {
  const slice = map.slices[index];
  if (slice === undefined) return null;
  if (map.cards.some((c) => c.slice === slice)) return null;
  return { ...map, slices: map.slices.filter((_, i) => i !== index) };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/story-map.test.ts -t "removeActivity / removeSlice"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): removeActivity/removeSlice (reject when cards reference)"
```

---

### Task 2: Domain — `removeStep` (degrade cards) + `reorderStep`

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("removeStep / reorderStep", () => {
  const base = makeMap({
    activities: ["Browse"],
    slices: ["MVP"],
    steps: [
      { activity: "Browse", step: "Search" },
      { activity: "Browse", step: "Filter" },
    ],
    cards: [{ title: "C", activity: "Browse", step: "Search", slice: "MVP", tags: [] }],
  });

  it("removes a step and degrades its cards to no-step", () => {
    const next = removeStep(base, "Browse", "Search");
    expect(next?.steps).toEqual([{ activity: "Browse", step: "Filter" }]);
    expect(next?.cards[0].step).toBeUndefined(); // card now hangs under the activity
  });

  it("returns null when the step does not exist", () => {
    expect(removeStep(base, "Browse", "Nope")).toBeNull();
  });

  it("reorders a step within its activity by label", () => {
    const next = reorderStep(base, "Browse", "Filter", "Search"); // Filter before Search
    expect(next?.steps.map((s) => s.step)).toEqual(["Filter", "Search"]);
  });

  it("no-ops (same ref) when from===to and null on an unknown step", () => {
    expect(reorderStep(base, "Browse", "Search", "Search")).toBe(base);
    expect(reorderStep(base, "Browse", "Search", "Ghost")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/story-map.test.ts -t "removeStep / reorderStep"`
Expected: FAIL — ops undefined.

- [ ] **Step 3: Implement the ops**

Add after `removeSlice`:

```ts
/**
 * Removes step `step` under `activity`; its cards DEGRADE to no-step (the `step`
 * key is dropped so they hang directly under the activity). Returns null when the
 * step does not exist. Steps degrade rather than reject (product-owner policy).
 * Pure: no I/O.
 */
export const removeStep = (map: StoryMap, activity: string, step: string): StoryMap | null => {
  const exists = map.steps.some((s) => s.activity === activity && s.step === step);
  if (!exists) return null;
  return {
    ...map,
    steps: map.steps.filter((s) => !(s.activity === activity && s.step === step)),
    cards: map.cards.map((c) => {
      if (c.activity !== activity || c.step !== step) return c;
      const { step: _drop, ...noStep } = c;
      return noStep;
    }),
  };
};

/**
 * Reorders step `fromStep` to `toStep`'s position among `activity`'s own steps
 * (by label — the view drags one step header onto another of the same activity).
 * Returns the SAME map on a no-op, or null when either label is not a step of
 * `activity`. Other activities' step entries keep their slots. Pure: no I/O.
 */
export const reorderStep = (
  map: StoryMap,
  activity: string,
  fromStep: string,
  toStep: string,
): StoryMap | null => {
  const own = map.steps.filter((s) => s.activity === activity);
  const from = own.findIndex((s) => s.step === fromStep);
  const to = own.findIndex((s) => s.step === toStep);
  if (from === -1 || to === -1) return null;
  const moved = moveInArray(own, from, to);
  if (moved === own) return map;
  let k = 0;
  const steps = map.steps.map((s) => (s.activity === activity ? moved[k++] : s));
  return { ...map, steps };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/story-map.test.ts -t "removeStep / reorderStep"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): removeStep (degrade cards) + reorderStep"
```

---

### Task 3: Domain — `addCard` (placeholder in a cell) + `removeCard`

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("addCard / removeCard", () => {
  const base = makeMap({
    activities: ["Browse"],
    slices: ["MVP"],
    steps: [{ activity: "Browse", step: "Search" }],
    cards: [{ title: "Existing", activity: "Browse", slice: "MVP", tags: [] }],
  });

  it("appends a placeholder card in the target cell (with step)", () => {
    const next = addCard(base, { activity: "Browse", step: "Search", slice: "MVP" });
    const added = next.cards[next.cards.length - 1];
    expect(added).toMatchObject({ title: "New card", activity: "Browse", step: "Search", slice: "MVP" });
    expect(added.tags).toEqual([]);
  });

  it("appends a no-step placeholder and uniquifies the title", () => {
    const once = addCard(base, { activity: "Browse", slice: "MVP" });
    const twice = addCard(once, { activity: "Browse", slice: "MVP" });
    expect(twice.cards[twice.cards.length - 1].title).toBe("New card 2");
    expect(twice.cards[twice.cards.length - 1].step).toBeUndefined();
  });

  it("no-ops (same ref) when the target axis is off the map", () => {
    expect(addCard(base, { activity: "Ghost", slice: "MVP" })).toBe(base);
    expect(addCard(base, { activity: "Browse", slice: "Ghost" })).toBe(base);
  });

  it("removes the card at an index and no-ops out of range", () => {
    expect(removeCard(base, 0).cards).toEqual([]);
    expect(removeCard(base, 9)).toBe(base);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/story-map.test.ts -t "addCard / removeCard"`
Expected: FAIL — ops undefined.

- [ ] **Step 3: Implement the ops**

Add after `reorderStep` (uses the existing `CardTarget` type and `uniqueLabel` helper):

```ts
/**
 * Appends a placeholder free-text card ("New card", uniquified by title) in the
 * `target` cell, to be renamed in place (P4). No-ops (same map ref) when the
 * target activity/slice is not on the map. Pure: no I/O.
 */
export const addCard = (map: StoryMap, target: CardTarget): StoryMap => {
  if (!map.activities.includes(target.activity) || !map.slices.includes(target.slice)) return map;
  const card: StoryMapCard = {
    title: uniqueLabel(map.cards.map((c) => c.title), "New card"),
    activity: target.activity,
    ...(target.step !== undefined ? { step: target.step } : {}),
    slice: target.slice,
    tags: [],
  };
  return { ...map, cards: [...map.cards, card] };
};

/** Removes the card at `index`; no-ops (same ref) out of range. Pure: no I/O. */
export const removeCard = (map: StoryMap, index: number): StoryMap => {
  if (map.cards[index] === undefined) return map;
  return { ...map, cards: map.cards.filter((_, i) => i !== index) };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/story-map.test.ts -t "addCard / removeCard"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): addCard (placeholder in cell) + removeCard"
```

---

### Task 4: Layout — `resolveColumnAt` (step-reorder hit-test)

**Files:**
- Modify: `src/presentation/views/story-map-board-layout.ts`
- Test: `tests/story-map-board-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/story-map-board-layout.test.ts` (reuse its existing map fixture / `computeBoardLayout` import):

```ts
describe("resolveColumnAt", () => {
  it("returns the column (activity + step) under board-x, or null outside", () => {
    const layout = computeBoardLayout(map); // a map with at least one step column
    const col = layout.columns[0];
    const hit = resolveColumnAt(layout, col.x + 1);
    expect(hit?.activity).toBe(col.activity);
    expect(hit?.step).toBe(col.step);
    expect(resolveColumnAt(layout, -50)).toBeNull();
  });
});
```

Add `resolveColumnAt` to the import from `../src/presentation/views/story-map-board-layout`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/story-map-board-layout.test.ts -t "resolveColumnAt"`
Expected: FAIL — `resolveColumnAt` not exported.

- [ ] **Step 3: Implement**

Add to `src/presentation/views/story-map-board-layout.ts` (after `resolveSliceDropIndex`):

```ts
/**
 * The leaf column (activity + optional step) under board-x `x`, or null outside
 * every column. Used to resolve a step-header drag's drop target. Pure.
 */
export const resolveColumnAt = (
  layout: BoardLayout,
  x: number,
): { activity: string; step?: string } | null => {
  const col = layout.columns.find((c) => x >= c.x && x < c.x + c.width);
  if (col === undefined) return null;
  return col.step !== undefined ? { activity: col.activity, step: col.step } : { activity: col.activity };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/story-map-board-layout.test.ts -t "resolveColumnAt"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/story-map-board-layout.ts tests/story-map-board-layout.test.ts
git commit -m "feat(story-map-board): resolveColumnAt hit-test for step reorder"
```

---

### Task 5: Scene — remove `×` affordances + add-card `+` per cell

**Files:**
- Modify: `src/presentation/views/story-map-board-scene.ts`
- Test: `tests/story-map-board-scene.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/story-map-board-scene.test.ts`:

```ts
it("emits remove affordances for activity, slice, step, and card", () => {
  const specs = buildBoardScene(computeBoardLayout(map));
  const removes = specs
    .map((s) => s.attrs["data-remove"])
    .filter((v): v is string => typeof v === "string");
  expect(removes).toContain("activity");
  expect(removes).toContain("slice");
  expect(removes).toContain("step");
  expect(removes).toContain("card");
});

it("emits an add-card affordance tagged with the cell coordinate", () => {
  const specs = buildBoardScene(computeBoardLayout(map));
  const addCard = specs.find((s) => s.attrs["data-add"] === "card");
  expect(addCard?.attrs["data-activity"]).toBe("Browse");
  expect(addCard?.attrs["data-slice"]).toBe("Walking skeleton");
});
```

(The fixture `map` in that test file has activity "Browse", slice "Walking skeleton".)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/story-map-board-scene.test.ts -t "remove affordances"`
Expected: FAIL — no `data-remove` specs.

- [ ] **Step 3: Implement**

In `src/presentation/views/story-map-board-scene.ts`, add a small square remove-button helper near `addButton`:

```ts
/** A small clickable `×` remove control (rect + label sharing the `data-remove` attrs). */
const removeButton = (
  cls: string,
  x: number,
  y: number,
  data: Record<string, string | number>,
): SvgNodeSpec[] => [
  rect(cls, x, y, 16, 16, data),
  { tag: "text", class: `${cls}-label`, attrs: { x: x + 4, y: y + 12, ...data }, text: "×" },
];
```

Then, inside `buildBoardScene`:

- After pushing each activity header rect/label, push a remove button at the header's top-right:

```ts
specs.push(
  ...removeButton("sm-board-remove", g.x + g.width - 18, M.laneHeight + 4, {
    "data-remove": "activity",
    "data-activity-index": i,
  }),
);
```

- After each step header, push (for declared-step columns only — `c.step !== undefined`):

```ts
if (c.step !== undefined) {
  specs.push(
    ...removeButton("sm-board-remove", c.x + c.width - 18, stepY + 4, {
      "data-remove": "step",
      "data-activity": c.activity,
      "data-step": c.step,
    }),
  );
}
```

- After each slice header, push:

```ts
specs.push(
  ...removeButton("sm-board-remove", M.rowHeaderWidth - 18, r.y + 4, {
    "data-remove": "slice",
    "data-slice-index": i,
  }),
);
```

- After each card rect/label, push a remove button at the card's top-right:

```ts
specs.push(
  ...removeButton("sm-board-remove", box.x + box.width - 18, box.y + 4, {
    "data-remove": "card",
    "data-card-index": box.cardIndex,
  }),
);
```

- Add-card `+` per cell: after the cards loop, iterate rows × columns and emit a small add button at each cell's bottom-left:

```ts
for (const r of layout.rows) {
  for (const c of layout.columns) {
    specs.push(
      ...addButton("sm-board-add-card", c.x + 8, r.y + r.height - 24, "+ card", {
        "data-add": "card",
        "data-activity": c.activity,
        ...(c.step !== undefined ? { "data-step": c.step } : {}),
        "data-slice": r.slice,
      }),
    );
  }
}
```

- [ ] **Step 4: Run the full scene test file to verify pass + no regressions**

Run: `npx vitest run tests/story-map-board-scene.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/story-map-board-scene.ts tests/story-map-board-scene.test.ts
git commit -m "feat(story-map-board): remove-x + add-card affordances in the scene"
```

---

### Task 6: View — wire remove / add-card / step-reorder + styles

**Files:**
- Modify: `src/presentation/views/story-map-board-view.ts`
- Modify: `styles.css`

> Views are unit-test-exempt (AGENTS.md). Verify via the gate (lint/typecheck/build) and the existing pure-module tests. Keep per-method cyclomatic ≤ 20 / cognitive ≤ 15; if a handler trips the audit, extract a pure module helper (mirroring `renameFromHeader`) or add a justified `// fallow-ignore-next-line complexity`.

- [ ] **Step 1: Import the new ops**

Add to the `story-map` import block in `story-map-board-view.ts`:
`addCard, removeActivity, removeCard, removeSlice, removeStep, reorderStep` (alongside the existing add/rename/reorder imports). Add `resolveColumnAt` to the layout import.

- [ ] **Step 2: Generalize add to read a full cell coordinate**

`onAdd`/`addByKind` currently take `(kind, activity)`. Extend so `kind === "card"` reads `data-activity`, `data-step`, `data-slice` off the clicked element and calls `addCard`. Change `wireControls`' add binding to pass the element, and add a module helper:

```ts
/** Builds the add target for a clicked `+` affordance, or applies the structure add. */
const cardTargetOf = (el: Element): CardTarget | null => {
  const activity = el.getAttribute("data-activity");
  const slice = el.getAttribute("data-slice");
  if (activity === null || slice === null) return null;
  const step = el.getAttribute("data-step");
  return step !== null ? { activity, slice, step } : { activity, slice };
};
```

(Import `type CardTarget` from the domain entity.) In `addByKind`, add:

```ts
if (kind === "card") {
  const target = cardTargetOf(el);
  return target === null ? null : addCard(this.model, target);
}
```

so `addByKind` receives the element (change its signature to `(el: Element)` and read `data-add` + coords from it). Keep the existing activity/slice/step branches reading `data-add`/`data-activity`.

- [ ] **Step 3: Wire the remove affordances**

In `wireControls`, after the `[data-add]` loop, add a `[data-remove]` loop:

```ts
for (const el of Array.from(svg.querySelectorAll("rect[data-remove]"))) {
  const onClick = (): void => this.onRemove(el);
  el.addEventListener("click", onClick);
  this.cleanups.push(() => el.removeEventListener("click", onClick));
}
```

(Scope the selector to `rect[data-remove]` so the click binds once, not also to the `×` label — the labels carry `pointer-events: none`, but binding the rect only is cleaner.) Add the handler + a pure resolver helper:

```ts
/** Resolves a clicked `×` to the removal op result, or null. Pure. */
// fallow-ignore-next-line complexity
const removeFromButton = (model: StoryMap, el: Element): StoryMap | null => {
  const kind = el.getAttribute("data-remove");
  if (kind === "activity") return removeActivity(model, indexAttr(el, "data-activity-index") ?? -1);
  if (kind === "slice") return removeSlice(model, indexAttr(el, "data-slice-index") ?? -1);
  if (kind === "card") return removeCard(model, indexAttr(el, "data-card-index") ?? -1);
  if (kind === "step") {
    const activity = el.getAttribute("data-activity");
    const step = el.getAttribute("data-step");
    return activity !== null && step !== null ? removeStep(model, activity, step) : null;
  }
  return null;
};
```

```ts
/** Applies a `×` removal, repaints, and saves. */
private onRemove(el: Element): void {
  if (this.model === null) return;
  const next = removeFromButton(this.model, el);
  if (next === null || next === this.model) return;
  this.model = next;
  this.paint(this.contentEl);
  this.scheduleSave();
}
```

- [ ] **Step 4: Wire step-header drag → reorder**

In `wireDnd`, add a `makeDraggable` for `.sm-board-step` headers (alongside activity/slice):

```ts
makeDraggable(this.contentEl, ".sm-board-step", {
  onStart: (el) => el.classList.add("is-dragging"),
  onEnd: (el, x, y) => this.onStepDrop(el, x, y, svg, layout),
}),
```

Add the handler — only declared-step headers (those with a `data-step`) are reorderable, and only within the same activity:

```ts
/** Reorders a step when its header is dropped over another step of the same activity. */
private onStepDrop(
  el: SVGElement,
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  layout: BoardLayout,
): void {
  el.classList.remove("is-dragging");
  if (this.model === null) return;
  const fromActivity = el.getAttribute("data-activity");
  const fromStep = el.getAttribute("data-step");
  if (fromActivity === null || fromStep === null) return; // no-step header: not reorderable
  const drop = resolveColumnAt(layout, this.toBoardPoint(svg, clientX, clientY).x);
  if (drop === null || drop.step === undefined || drop.activity !== fromActivity) return;
  const next = reorderStep(this.model, fromActivity, fromStep, drop.step);
  if (next === null || next === this.model) return;
  this.model = next;
  this.paint(this.contentEl);
  this.scheduleSave();
}
```

> Note: `.sm-board-step` headers are now BOTH double-click-to-rename (P3b) and drag-to-reorder. interact.js drag and the dblclick listener coexist (interact suppresses click only after an actual drag move). Confirm a double-click still opens the rename input in a manual smoke (gate can't cover the view).

- [ ] **Step 5: Styles**

Add to `styles.css`:

```css
.sm-board-remove {
  fill: var(--background-modifier-error);
  opacity: 0.55;
  cursor: pointer;
}
.sm-board-remove:hover { opacity: 1; }
.sm-board-remove-label { fill: var(--text-on-accent); font-size: 12px; pointer-events: none; }
.sm-board-add-card { fill: var(--background-modifier-border); cursor: pointer; }
.sm-board-add-card-label { fill: var(--text-muted); font-size: 11px; pointer-events: none; }
```

Also add `.sm-board-remove-label` and `.sm-board-add-card-label` to the existing `pointer-events: none` pass-through rule alongside the header labels.

- [ ] **Step 6: Run the gate**

```bash
npm run lint && npm run typecheck && npm run build && npm run test:coverage
npx fallow audit --base origin/main
```
Expected: all pass; audit verdict `✓`.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/views/story-map-board-view.ts styles.css
git commit -m "feat(story-map-board): wire remove + add-card + step-reorder on the board"
```

---

### Task 7: Docs + final gate

**Files:**
- Modify: `CONTEXT.md` (Story Map Board term — extend to P3c: remove/step-reorder/add-card)
- Modify: `docs/adr/0029-story-map-visual-board.md` (note P3c ops + removal policy)
- Modify: this plan (check the boxes)

- [ ] **Step 1: Update CONTEXT.md** — extend the "Story Map Board" entry: the board now supports removing activities/slices (rejected when cards reference them), removing steps (cards degrade to no-step), reordering steps, and adding/removing cards.

- [ ] **Step 2: Update ADR-0029** — record the P3c domain ops and the removal policy (reject activity/slice with cards; steps degrade).

- [ ] **Step 3: Final gate**

```bash
npm run lint && npm run typecheck && npm run build && npm run test:coverage
npx fallow audit --base origin/main
```
Expected: all green.

- [ ] **Step 4: Commit + push**

```bash
git add CONTEXT.md docs/adr/0029-story-map-visual-board.md docs/superpowers/plans/2026-06-20-story-map-board-p3c.md
git commit -m "docs(story-map-board): P3c remove/step-reorder/add-card"
git push -u origin claude/storymaps-prd-tooling-k9tpnx
```

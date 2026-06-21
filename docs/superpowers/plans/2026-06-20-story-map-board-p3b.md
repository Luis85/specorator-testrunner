# Story Map Visual Board — P3b (Add & rename structure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add activities, release slices, and steps directly on the board (a `+` affordance inserts a placeholder-named item) and **rename any of them in place** (double-click a header → edit → commit), persisted through the existing structure-aware save.

**Architecture:** All add/rename logic is pure domain ops on `StoryMap` (`addActivity`/`addSlice`/`addStep`, `renameActivity`/`renameSlice`/`renameStep`). Renames update every label reference (a card's `activity`/`step`/`slice` and a step's `activity` are label strings — the join key — so a rename rewrites them). The board produces a new model and saves it through P3's already-widened `saveMap` (full-structure persistence under a signature baseline) — **no service changes needed**. The in-place editor is an SVG `<foreignObject>` `<input>` positioned over the header; it's the reusable inline-edit primitive P4 will also use for card titles.

**Tech Stack:** TypeScript, Obsidian `ItemView`, SVG/DOM (`<foreignObject>` + `<input>`), interact.js (existing), Vitest. Reuses `src/domain/entities/story-map.ts`, `story-map-board-layout.ts`/`-scene.ts`/`-view.ts`, and the existing `saveMap` pipeline.

**Spec:** `docs/superpowers/specs/2026-06-19-story-map-board-design.md` (§4 "add card / column / row", §9 P3 "add/remove cards/columns/rows"). **Scope:** this plan covers **add + in-place rename of activities/slices/steps**. Deferred to the next plan (P3c): **remove** structure (reject-if-cards for activity/slice; step removal degrades its cards to no-step) and **step reorder** (drag step-column headers), plus add-card-on-board. Decisions from the product owner: add = placeholder then rename in place; removal = reject an activity/slice that still has cards.

**Gate after every commit:** `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit` (audit must exit 0). Run `npm run format` before committing. Commit trailers (every commit):
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BxcuwMGwcXWKAfwMHF73P3
```

---

## File structure (P3b)

- Modify `src/domain/entities/story-map.ts` — `addActivity`/`addSlice`/`addStep`, `renameActivity`/`renameSlice`/`renameStep`, the `uniqueLabel` helper. The rename ops reuse the existing private `cleanLabel` directly (same module — no export needed).
- Modify `tests/story-map.test.ts` — op tests.
- Modify `src/presentation/views/story-map-board-scene.ts` — `+` add affordances (activity/slice/step) as `SvgNodeSpec`s with `data-add="…"`; tag step headers with `data-activity` + `data-step` for rename/edit.
- Modify `tests/story-map-board-scene.test.ts` — assert the add affordances + step attrs.
- Modify `src/presentation/views/story-map-board-view.ts` — wire the `+` add (optimistic insert → enter edit → save), the in-place rename editor (`<foreignObject>` input), and the save.
- Modify `styles.css` — add-button + inline-input styling.
- Modify `CONTEXT.md` — note add + rename on the board.

P3's `saveMap` already persists `users/activities/steps/slices/cards` under a `storyMapSignature` baseline, so add/rename just build a new `StoryMap` and call `saveMap` — the board's existing serialized save loop, self-event guard, and stale-conflict handling all apply unchanged.

---

## Task 1: `uniqueLabel` + add ops

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing test** (append; add `addActivity`, `addSlice`, `addStep` to the import)

```typescript
describe("addActivity / addSlice / addStep", () => {
  const map = (over: Partial<StoryMap> = {}): StoryMap => ({
    id: "SM-001",
    title: "J",
    status: "draft",
    product: "PRD-000",
    users: [],
    activities: ["Browse"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton"],
    cards: [],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
    ...over,
  });

  it("appends a uniquely-named placeholder activity / slice", () => {
    expect(addActivity(map()).activities).toEqual(["Browse", "New activity"]);
    expect(addActivity(map({ activities: ["Browse", "New activity"] })).activities).toEqual([
      "Browse",
      "New activity",
      "New activity 2",
    ]);
    expect(addSlice(map()).slices).toEqual(["Walking skeleton", "New slice"]);
  });

  it("appends a uniquely-named placeholder step under an existing activity", () => {
    const next = addStep(map(), "Browse");
    expect(next?.steps).toEqual([
      { activity: "Browse", step: "Filter" },
      { activity: "Browse", step: "New step" },
    ]);
  });

  it("returns null when adding a step to an unknown activity", () => {
    expect(addStep(map(), "Nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `npx vitest run tests/story-map.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement** (add after `reorderSlice` in `story-map.ts`)

```typescript
/** A label not already in `existing`: `base`, else `base 2`, `base 3`, … Pure. */
const uniqueLabel = (existing: readonly string[], base: string): string => {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
};

/** Appends a placeholder activity (rename it in place after). Pure. */
export const addActivity = (map: StoryMap): StoryMap => ({
  ...map,
  activities: [...map.activities, uniqueLabel(map.activities, "New activity")],
});

/** Appends a placeholder release slice. Pure. */
export const addSlice = (map: StoryMap): StoryMap => ({
  ...map,
  slices: [...map.slices, uniqueLabel(map.slices, "New slice")],
});

/**
 * Appends a placeholder step under `activity` (unique among that activity's
 * steps), or null when the activity is not on the backbone. Pure.
 */
export const addStep = (map: StoryMap, activity: string): StoryMap | null => {
  if (!map.activities.includes(activity)) return null;
  const own = map.steps.filter((s) => s.activity === activity).map((s) => s.step);
  return { ...map, steps: [...map.steps, { activity, step: uniqueLabel(own, "New step") }] };
};
```

- [ ] **Step 4: Run, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): pure add activity/slice/step ops"
```

---

## Task 2: rename ops (update every label reference)

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

Renames must rewrite the label everywhere it is referenced (the label is the join key), and reject a blank or duplicate target.

- [ ] **Step 1: Write the failing test** (append; add `renameActivity`, `renameSlice`, `renameStep` to the import)

```typescript
describe("renameActivity / renameSlice / renameStep", () => {
  const map = (): StoryMap => ({
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
    ],
    displayOrder: 0,
    path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  });

  it("renames an activity and rewrites its steps + cards", () => {
    const next = renameActivity(map(), 0, "Discover");
    expect(next?.activities).toEqual(["Discover", "Order"]);
    expect(next?.steps).toEqual([{ activity: "Discover", step: "Filter" }]);
    expect(next?.cards[0].activity).toBe("Discover");
  });

  it("renames a slice and rewrites its cards", () => {
    const next = renameSlice(map(), 0, "Skeleton");
    expect(next?.slices).toEqual(["Skeleton", "Next"]);
    expect(next?.cards[0].slice).toBe("Skeleton");
  });

  it("renames a step and rewrites its cards (within the activity)", () => {
    const next = renameStep(map(), "Browse", "Filter", "Sort");
    expect(next?.steps).toEqual([{ activity: "Browse", step: "Sort" }]);
    expect(next?.cards[0].step).toBe("Sort");
  });

  it("rejects a blank or duplicate rename, and no-ops an unchanged one", () => {
    expect(renameActivity(map(), 0, "  ")).toBeNull();
    expect(renameActivity(map(), 0, "Order")).toBeNull(); // dup
    expect(renameActivity(map(), 0, "Browse")).toBe(map()); // unchanged → no-op... see note
    expect(renameSlice(map(), 0, "Next")).toBeNull();
    expect(renameStep(map(), "Browse", "Filter", "Filter")).toEqual(map()); // unchanged
  });
});
```

> Note on the "unchanged" assertions: `renameActivity(map(), 0, "Browse")` builds a fresh `map()` each call, so `toBe` would compare two different objects. Use the SAME instance: `const m = map(); expect(renameActivity(m, 0, "Browse")).toBe(m);`. Fix the two unchanged-case assertions to capture `const m = map()` first.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement** (add after the add ops). Reuse the existing `cleanLabel` (already defined in this file).

```typescript
/**
 * Renames the activity at `index` to `rawName`, rewriting the label on its steps
 * and cards (the label is the join key). Returns the SAME map when unchanged, or
 * null when the cleaned name is blank or duplicates another activity. Pure.
 */
export const renameActivity = (map: StoryMap, index: number, rawName: string): StoryMap | null => {
  const old = map.activities[index];
  if (old === undefined) return null;
  const name = cleanLabel(rawName);
  if (name === old) return map;
  if (name === "" || map.activities.includes(name)) return null;
  return {
    ...map,
    activities: map.activities.map((a, i) => (i === index ? name : a)),
    steps: map.steps.map((s) => (s.activity === old ? { ...s, activity: name } : s)),
    cards: map.cards.map((c) => (c.activity === old ? { ...c, activity: name } : c)),
  };
};

/** Renames the slice at `index`, rewriting its cards. Same contract as {@link renameActivity}. */
export const renameSlice = (map: StoryMap, index: number, rawName: string): StoryMap | null => {
  const old = map.slices[index];
  if (old === undefined) return null;
  const name = cleanLabel(rawName);
  if (name === old) return map;
  if (name === "" || map.slices.includes(name)) return null;
  return {
    ...map,
    slices: map.slices.map((s, i) => (i === index ? name : s)),
    cards: map.cards.map((c) => (c.slice === old ? { ...c, slice: name } : c)),
  };
};

/**
 * Renames step `oldStep` under `activity`, rewriting that activity's cards.
 * Returns the same map when unchanged, or null when blank or duplicating another
 * step of the same activity. Pure.
 */
export const renameStep = (
  map: StoryMap,
  activity: string,
  oldStep: string,
  rawName: string,
): StoryMap | null => {
  const name = cleanLabel(rawName);
  if (name === oldStep) return map;
  const own = map.steps.filter((s) => s.activity === activity).map((s) => s.step);
  if (!own.includes(oldStep)) return null;
  if (name === "" || own.includes(name)) return null;
  return {
    ...map,
    steps: map.steps.map((s) =>
      s.activity === activity && s.step === oldStep ? { ...s, step: name } : s,
    ),
    cards: map.cards.map((c) =>
      c.activity === activity && c.step === oldStep ? { ...c, step: name } : c,
    ),
  };
};
```

- [ ] **Step 4: Run, verify it passes.**

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): pure rename ops that rewrite label references"
```

---

## Task 3: scene — add affordances + step header attrs

**Files:**
- Modify: `src/presentation/views/story-map-board-scene.ts`
- Test: `tests/story-map-board-scene.test.ts`

Add three `+` controls and tag step headers so the view can resolve which (activity, step) a header is. The `+` controls are plain `rect`+`text` specs with a `data-add` attribute the view reads on click.

- [ ] **Step 1: Write the failing test** (append to `tests/story-map-board-scene.test.ts`)

```typescript
it("emits add-affordances for activity, slice, and step, and tags step headers", () => {
  const specs = buildBoardScene(computeBoardLayout(map));
  const adds = specs.filter((s) => typeof s.attrs["data-add"] === "string").map((s) => s.attrs["data-add"]);
  expect(adds).toContain("activity");
  expect(adds).toContain("slice");
  expect(adds).toContain("step"); // one per activity
  const step = specs.find((s) => s.class === "sm-board-step");
  // The map fixture's single activity "Browse" has no steps → its column is the
  // no-step column, which carries the activity but no step attr.
  expect(step?.attrs["data-activity"]).toBe("Browse");
});
```

> The existing `map` fixture in this test file has one activity ("Browse") and one slice ("Walking skeleton") and no steps. Confirm and reuse it; if its shape differs, adapt the expectations. The `data-add="step"` control is emitted per activity (so at least one).

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement.** In `buildBoardScene`:

(a) Tag each step header with its activity and (when present) step, in the columns loop:

```typescript
  // Step (column) headers.
  const stepY = M.laneHeight + M.activityHeaderHeight;
  for (const c of layout.columns) {
    const attrs: Record<string, string | number> =
      c.step !== undefined ? { "data-activity": c.activity, "data-step": c.step } : { "data-activity": c.activity };
    specs.push(rect("sm-board-step", c.x, stepY, c.width, M.stepHeaderHeight, attrs));
    specs.push(
      text("sm-board-step-label", c.x + 8, stepY + M.stepHeaderHeight / 2 + 4, c.step ?? "(no step)"),
    );
  }
```

(b) After the activity-group loop, emit a `+ activity` control to the right of the last group; after the slice loop, a `+ slice` control below the last row; and a `+ step` control per activity group (small, in the step-header band at the right edge of the group). Add near the end of `buildBoardScene`, before `return specs;`:

```typescript
  // Add affordances (+). The view reads `data-add` (+ `data-activity` for steps).
  const lastGroup = layout.activityGroups[layout.activityGroups.length - 1];
  const addActivityX = lastGroup ? lastGroup.x + lastGroup.width + M.colGap : M.rowHeaderWidth;
  specs.push(addButton("sm-board-add-activity", addActivityX, M.laneHeight, "+ activity", { "data-add": "activity" }));

  for (const g of layout.activityGroups) {
    specs.push(
      addButton("sm-board-add-step", g.x + g.width - 28, M.laneHeight + M.activityHeaderHeight, "+", {
        "data-add": "step",
        "data-activity": g.activity,
      }),
    );
  }

  const lastRow = layout.rows[layout.rows.length - 1];
  const addSliceY = lastRow ? lastRow.y + lastRow.height + M.rowGap : M.laneHeight + M.activityHeaderHeight + M.stepHeaderHeight;
  specs.push(addButton("sm-board-add-slice", 0, addSliceY, "+ slice", { "data-add": "slice" }));

  return specs;
```

And add the `addButton` helper near `rect`/`text`:

```typescript
/** A small clickable `+` control: a rect plus its label, sharing the `data-add` attrs. */
const addButton = (
  cls: string,
  x: number,
  y: number,
  label: string,
  data: Record<string, string | number>,
): SvgNodeSpec[] => [
  rect(cls, x, y, 84, 22, data),
  { tag: "text", class: `${cls}-label`, attrs: { x: x + 6, y: y + 15, ...data }, text: label },
];
```

> `addButton` returns TWO specs (rect + text). Push with `specs.push(...addButton(...))` (spread). Adjust the calls above to spread. Keep the control sizes small/consistent; exact pixels are cosmetic.

- [ ] **Step 4: Run, verify it passes** (fix the spread if the test sees no add specs).

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-scene.ts tests/story-map-board-scene.test.ts
git commit -m "feat(story-map-board): add-affordances + step header attrs in the scene"
```

---

## Task 4: view — wire add + in-place rename

**Files:**
- Modify: `src/presentation/views/story-map-board-view.ts`

No unit test (thin view, AGENTS.md). Keep each method ≤ 4 cyclomatic (delegate to the pure ops); use `// fallow-ignore-next-line complexity` consistently with the file where unavoidable.

- [ ] **Step 1: Import the new ops**

```typescript
import {
  addActivity,
  addSlice,
  addStep,
  moveCard,
  renameActivity,
  renameSlice,
  renameStep,
  reorderActivity,
  reorderSlice,
  storyMapSignature,
} from "../../domain/entities/story-map";
```

- [ ] **Step 2: Wire the `+` add controls** — in `wireDnd` (or a new `wireControls`) called from `paint`, attach click handlers to the add buttons. After `this.wireDnd(svg, layout)` in `paint`, add `this.wireControls(svg)`:

```typescript
  private wireControls(svg: SVGSVGElement): void {
    for (const el of Array.from(svg.querySelectorAll("[data-add]"))) {
      const onClick = () => this.onAdd(el.getAttribute("data-add"), el.getAttribute("data-activity"));
      el.addEventListener("click", onClick);
      this.cleanups.push(() => el.removeEventListener("click", onClick));
    }
    for (const el of Array.from(svg.querySelectorAll("rect.sm-board-activity, rect.sm-board-slice, rect.sm-board-step"))) {
      const onDbl = () => this.onEditHeader(el as SVGElement);
      el.addEventListener("dblclick", onDbl);
      this.cleanups.push(() => el.removeEventListener("dblclick", onDbl));
    }
  }

  /** Inserts a placeholder activity/slice/step, repaints, and saves. */
  private onAdd(kind: string | null, activity: string | null): void {
    if (this.model === null) return;
    const next =
      kind === "activity" ? addActivity(this.model)
      : kind === "slice" ? addSlice(this.model)
      : kind === "step" && activity !== null ? addStep(this.model, activity)
      : null;
    if (next === null || next === this.model) return;
    this.model = next;
    this.paint(this.contentEl);
    this.scheduleSave();
  }
```

> The double-click-to-edit on a draggable header is fine: interact.js needs pointer movement to start a drag, so a stationary double-click doesn't trigger a reorder.

- [ ] **Step 3: In-place rename editor (`<foreignObject>` input)** — `onEditHeader` overlays an input on the header's rect, commits to the matching rename op on Enter/blur, cancels on Escape:

```typescript
  // fallow-ignore-next-line complexity
  private onEditHeader(rect: SVGElement): void {
    if (this.model === null) return;
    const { x, y, width, height } = this.rectBox(rect);
    const current = this.headerLabel(rect);
    const input = this.mountHeaderInput(rect, x, y, width, height, current);
    const commit = (save: boolean): void => {
      input.remove();
      if (!save) return;
      const next = this.applyRename(rect, input.value);
      if (next === null || next === this.model) return;
      this.model = next;
      this.paint(this.contentEl);
      this.scheduleSave();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      if (e.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
    input.focus();
    input.select();
  }

  /** Resolves which rename op the edited header maps to. */
  private applyRename(rect: SVGElement, value: string): StoryMap | null {
    if (this.model === null) return null;
    if (rect.classList.contains("sm-board-activity")) {
      const i = Number(rect.getAttribute("data-activity-index"));
      return Number.isNaN(i) ? null : renameActivity(this.model, i, value);
    }
    if (rect.classList.contains("sm-board-slice")) {
      const i = Number(rect.getAttribute("data-slice-index"));
      return Number.isNaN(i) ? null : renameSlice(this.model, i, value);
    }
    const activity = rect.getAttribute("data-activity");
    const step = rect.getAttribute("data-step");
    return activity !== null && step !== null ? renameStep(this.model, activity, step, value) : null;
  }
```

Plus small DOM helpers (kept thin):

```typescript
  /** The header rect's geometry in board coordinates. */
  private rectBox(rect: SVGElement): { x: number; y: number; width: number; height: number } {
    return {
      x: Number(rect.getAttribute("x")),
      y: Number(rect.getAttribute("y")),
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
    };
  }

  /** The current label text of a header (from its sibling label, or the rect's attrs). */
  private headerLabel(rect: SVGElement): string {
    const label = rect.nextElementSibling;
    return label?.textContent ?? "";
  }

  /** Mounts an `<input>` over the header via a `<foreignObject>` and returns it. */
  private mountHeaderInput(
    rect: SVGElement,
    x: number,
    y: number,
    width: number,
    height: number,
    value: string,
  ): HTMLInputElement {
    const svg = rect.ownerSVGElement;
    const fo = svg?.createSvg("foreignObject", {
      attr: { x, y, width, height, class: "sm-board-edit-fo" },
    }) as SVGForeignObjectElement | undefined;
    const input = (fo ?? rect).createEl?.("input", { cls: "sm-board-edit-input" }) as HTMLInputElement;
    input.value = value;
    return input;
  }
```

> **Implementer notes (verify against the codebase / Obsidian typings):**
> - `createSvg`/`createEl` are Obsidian DOM helpers (used elsewhere in this view). If `foreignObject`/`input` creation via them doesn't typecheck, fall back to `document.createElementNS("http://www.w3.org/2000/svg", "foreignObject")` and `document.createElement("input")` + `appendChild`. The input must be a child of the `<foreignObject>` (HTML namespace) so it renders.
> - The `<foreignObject>` is mounted inside the live SVG; a `paint()` (after commit) rebuilds the SVG and discards it, so cleanup beyond `input.remove()` is not required — but ensure a stray editor is torn down on `teardownDnd`/repaint (track the active `foreignObject` in a field and remove it in `teardownDnd`).
> - The label text lives in the `<text>` sibling emitted right after each header rect (scene order), so `rect.nextElementSibling` is that label. Verify the scene order; if not adjacent, read the label from the model by index instead (cleaner: `this.model.activities[i]` etc.).
> - The double-click handler and interact.js drag coexist; if a drag is accidentally starting on dblclick, gate the drag with interact.js's `hold`/threshold or ignore — confirm in the manual smoke test.

- [ ] **Step 4: Track + tear down the active editor** — add a field `private editor: Element | null = null;`, set it in `mountHeaderInput` (the `foreignObject`), clear/remove it in `commit` and in `teardownDnd`:

```typescript
  private teardownDnd(): void {
    this.editor?.remove();
    this.editor = null;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }
```

- [ ] **Step 5: Typecheck + build + audit**

Run: `npm run typecheck && npm run build && npm run quality:audit`
Expected: clean; audit exits 0. Extract helpers / add the ignore comment if a method trips the complexity gate.

- [ ] **Step 6: Manual smoke (recommended)** — open a board, click `+ activity`/`+ slice`/`+`(step), confirm a placeholder appears and persists; double-click a header, rename, Enter → the label updates and any cards under it follow (the frontmatter rewrites). Escape cancels. A duplicate/blank name is ignored.

- [ ] **Step 7: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-view.ts
git commit -m "feat(story-map-board): add structure + in-place rename"
```

---

## Task 5: styles + CONTEXT + full gate + push

**Files:**
- Modify: `styles.css`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Styles** (append to the board block)

```css
.sm-board-add-activity,
.sm-board-add-slice,
.sm-board-add-step {
  fill: var(--background-secondary);
  stroke: var(--background-modifier-border);
  cursor: pointer;
}

.sm-board-add-activity-label,
.sm-board-add-slice-label,
.sm-board-add-step-label {
  fill: var(--text-muted);
  pointer-events: none;
}

.sm-board-edit-input {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  font: inherit;
}
```

- [ ] **Step 2: CONTEXT** — extend the "Story Map Board" term's phase sentence:

```markdown
… P3 adds structure reordering (drag a column/activity or row/slice header); P3b
adds creating structure (a `+` inserts a placeholder activity/slice/step) and
renaming any of them in place (double-click a header). Later phases add structure
removal + step reorder, inline card editing, and zoom/pan.
```

- [ ] **Step 3: Full gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit`
Expected: all pass; coverage ≥ 80%; audit exits 0.

- [ ] **Step 4: Commit + push**

```bash
git add styles.css CONTEXT.md
git commit -m "docs(story-map-board): P3b add + rename — styles + CONTEXT"
git push origin claude/storymaps-prd-tooling-k9tpnx
```

---

## Self-review (done while writing)

- **Scope:** add activity/slice/step (placeholder) ✓ (Tasks 1, 3, 4); rename in place ✓ (Tasks 2, 3, 4 — the `<foreignObject>` editor, reused by P4 for card titles). **Remove + step-reorder + add-card-on-board are explicitly deferred to P3c** (stated up front). No service change — P3's `saveMap` already persists full structure under the signature baseline, so add/rename flow through the existing serialized save / self-event guard / stale-conflict handling.
- **Data-safety:** rename rewrites ALL label references (card `activity`/`step`/`slice`, step `activity`) so no card is orphaned; blank/duplicate renames are rejected (op returns null → the view keeps the old label); `saveMap` re-normalizes and re-validates on persist, and its signature staleness still guards concurrent external edits.
- **Types consistent:** `uniqueLabel`, `addActivity`/`addSlice`/`addStep`, `renameActivity`/`renameSlice`/`renameStep`, scene `data-add`/`data-activity`/`data-step`, view `onAdd`/`onEditHeader`/`applyRename`/`mountHeaderInput`/`editor` — used consistently.
- **Implementer caveats flagged, not placeholders:** the `<foreignObject>`/`<input>` creation + namespace fallback, reading the label from the model vs the sibling `<text>`, the dblclick-vs-drag coexistence, the editor teardown on repaint, and the unchanged-rename test using a single `map()` instance are each called out with concrete guidance.

# Story Map Board P4 — Inline card editing + color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit a card on the board without the modal: rename its title in place, and quick-cycle its color and planning status — all persisted via the board's existing debounced `saveMap`.

**Architecture:** Pure card-edit ops added to `story-map.ts` (`editCardTitle`, `recolorCard`, `editCardStatus`, `editCardPoints`), each returning a new `StoryMap` / the same map (no-op) / `null` (reject). The scene emits a color **swatch** and a **status chip** per card (clickable affordances). The thin view: double-click a card → inline title `<input>` (reusing the P3b foreignObject editor); click the swatch → cycle a fixed palette (`recolorCard`); click the status chip → cycle the four statuses + none (`editCardStatus`). Full attribute editing (points/tags/ref/coordinate) stays in the existing `StoryMapCardModal` — it persists via `service.updateCard`, which the board picks up as an external update. **Board-native edits use the board's own model→saveMap loop, never the modal's save path.**

**Tech Stack:** TypeScript, esbuild, vitest, Obsidian ItemView.

---

### Task 1: Domain — `editCardTitle`

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing test**

Add a `describe("card edits", ...)` block to `tests/story-map.test.ts` with a local full-`StoryMap` fixture (mirror `baseMap()` at line 301; `unsafeVaultPath` and `StoryMap` already imported). Use one card: `{ title: "Old", activity: "Browse", slice: "MVP", tags: [] }`, activities `["Browse"]`, slices `["MVP"]`, steps `[]`.

```ts
it("editCardTitle renames a card, rejects blank, no-ops unchanged", () => {
  expect(editCardTitle(base, 0, "New title")?.cards[0].title).toBe("New title");
  expect(editCardTitle(base, 0, "  Old  ")).toBe(base); // cleanLabel-equal → no-op
  expect(editCardTitle(base, 0, "   ")).toBeNull(); // blank rejected
  expect(editCardTitle(base, 9, "x")).toBeNull(); // out of range
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/story-map.test.ts -t "card edits"`
Expected: FAIL — `editCardTitle` undefined.

- [ ] **Step 3: Implement**

Add a private DRY helper + the op to `src/domain/entities/story-map.ts` (place after `removeCard`):

```ts
/** Replaces the card at `index` with `card`, returning a new map. Pure. */
const withCardAt = (map: StoryMap, index: number, card: StoryMapCard): StoryMap => ({
  ...map,
  cards: map.cards.map((c, i) => (i === index ? card : c)),
});

/**
 * Renames the card at `index`. The title is cleaned (whitespace/`|` collapsed —
 * `|` is the encoding delimiter). Returns the SAME map when unchanged, or null
 * when the cleaned title is blank (a card must carry a title) or the index is out
 * of range. Pure: no I/O.
 */
export const editCardTitle = (map: StoryMap, index: number, rawTitle: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  const title = cleanLabel(rawTitle);
  if (title === card.title) return map;
  if (title === "") return null;
  return withCardAt(map, index, { ...card, title });
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/story-map.test.ts -t "card edits"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): editCardTitle (inline card rename)"
```

---

### Task 2: Domain — `recolorCard`

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing test** (add to the `card edits` block)

```ts
it("recolorCard sets and clears the color, no-ops unchanged", () => {
  expect(recolorCard(base, 0, "#f00")?.cards[0].color).toBe("#f00");
  const colored = recolorCard(base, 0, "#f00")!;
  expect(recolorCard(colored, 0, "")?.cards[0].color).toBeUndefined(); // "" clears
  expect(recolorCard(base, 0, "")).toBe(base); // already no color → no-op
  expect(recolorCard(base, 9, "#f00")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/story-map.test.ts -t "card edits"`
Expected: FAIL.

- [ ] **Step 3: Implement** (after `editCardTitle`)

```ts
/**
 * Sets (or clears, when `color` is "") the color of the card at `index`. Returns
 * the SAME map when unchanged, or null when the index is out of range. Pure.
 */
export const recolorCard = (map: StoryMap, index: number, color: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  const next = color.trim();
  if (next === (card.color ?? "")) return map;
  if (next === "") {
    const { color: _drop, ...noColor } = card;
    return withCardAt(map, index, noColor);
  }
  return withCardAt(map, index, { ...card, color: next });
};
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/story-map.test.ts -t "card edits"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): recolorCard (set/clear card color)"
```

---

### Task 3: Domain — `editCardStatus` + `editCardPoints`

**Files:**
- Modify: `src/domain/entities/story-map.ts`
- Test: `tests/story-map.test.ts`

- [ ] **Step 1: Write the failing tests** (add to the `card edits` block)

```ts
it("editCardStatus sets a valid status, clears on '', rejects invalid", () => {
  expect(editCardStatus(base, 0, "done")?.cards[0].status).toBe("done");
  const done = editCardStatus(base, 0, "done")!;
  expect(editCardStatus(done, 0, "")?.cards[0].status).toBeUndefined();
  expect(editCardStatus(base, 0, "bogus")).toBeNull();
  expect(editCardStatus(base, 0, "")).toBe(base); // already none → no-op
});

it("editCardPoints sets a non-negative int, clears on '', rejects bad input", () => {
  expect(editCardPoints(base, 0, "5")?.cards[0].points).toBe(5);
  const five = editCardPoints(base, 0, "5")!;
  expect(editCardPoints(five, 0, "")?.cards[0].points).toBeUndefined();
  expect(editCardPoints(base, 0, "1.5")).toBeNull();
  expect(editCardPoints(base, 0, "-1")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (ops undefined).

- [ ] **Step 3: Implement** (after `recolorCard`; `isCardStatus` is already defined above in the file)

```ts
/**
 * Sets the planning status of the card at `index`; "" clears it. Returns the SAME
 * map when unchanged, or null when the index is out of range or `status` is a
 * non-empty non-status string. Pure: no I/O.
 */
export const editCardStatus = (map: StoryMap, index: number, status: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  if (status === "") {
    if (card.status === undefined) return map;
    const { status: _drop, ...noStatus } = card;
    return withCardAt(map, index, noStatus);
  }
  if (!isCardStatus(status)) return null;
  if (status === card.status) return map;
  return withCardAt(map, index, { ...card, status });
};

/**
 * Sets the story points of the card at `index`; "" clears. Returns the SAME map
 * when unchanged, or null when the index is out of range or the value is not a
 * non-negative integer (a decimal/non-numeric is rejected, not truncated). Pure.
 */
export const editCardPoints = (map: StoryMap, index: number, raw: string): StoryMap | null => {
  const card = map.cards[index];
  if (card === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") {
    if (card.points === undefined) return map;
    const { points: _drop, ...noPoints } = card;
    return withCardAt(map, index, noPoints);
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === card.points) return map;
  return withCardAt(map, index, { ...card, points: n });
};
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/story-map.test.ts` (whole file) → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/story-map.ts tests/story-map.test.ts
git commit -m "feat(story-map): editCardStatus + editCardPoints"
```

---

### Task 4: Scene — color swatch + status chip per card

**Files:**
- Modify: `src/presentation/views/story-map-board-scene.ts`
- Test: `tests/story-map-board-scene.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("emits a color swatch and a status chip per card, tagged with the card index", () => {
  const specs = buildBoardScene(computeBoardLayout(map));
  const swatch = specs.find((s) => s.class === "sm-board-swatch");
  expect(swatch?.attrs["data-color-index"]).toBe(0);
  const chip = specs.find((s) => s.class === "sm-board-status-chip");
  expect(chip?.attrs["data-status-index"]).toBe(0);
});
```

(The scene fixture `map` has one card at index 0.)

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — in `cardSpecs` (the helper extracted in P3c), after the card's remove button, push a color swatch + a status chip:

```ts
// Color swatch (click → cycle palette) at the card's bottom-left.
specs.push(
  rect("sm-board-swatch", box.x + 8, box.y + box.height - 16, 12, 12, {
    "data-color-index": box.cardIndex,
    fill: box.card.color ?? "var(--background-modifier-border)",
  }),
);
// Status chip (click → cycle status) next to the swatch.
specs.push(
  rect("sm-board-status-chip", box.x + 26, box.y + box.height - 16, 56, 12, {
    "data-status-index": box.cardIndex,
  }),
);
specs.push(
  text("sm-board-status-chip-label", box.x + 30, box.y + box.height - 6, box.card.status ?? "—"),
);
```

Keep `cardSpecs` under the cognitive gate — if the audit flags it, extract a `cardAffordances(box)` helper that returns the remove+swatch+chip specs for one card. (Verify with `npx fallow audit --base origin/main` in Task 6; the audit thresholds are cyclomatic > 20, cognitive > 15, CRAP >= 30.)

- [ ] **Step 4: Run to verify it passes + no regressions** — `npx vitest run tests/story-map-board-scene.test.ts` → all PASS (the "escapes nothing" test still holds — no `undefined` in attrs).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/story-map-board-scene.ts tests/story-map-board-scene.test.ts
git commit -m "feat(story-map-board): per-card color swatch + status chip affordances"
```

---

### Task 5: View — inline title edit + color/status cycle + styles

**Files:**
- Modify: `src/presentation/views/story-map-board-view.ts`
- Modify: `styles.css`

> Views are unit-test-exempt (AGENTS.md): verify via the gate + pure-module tests. Keep handlers under the complexity gate (extract pure module helpers / `// fallow-ignore-next-line complexity` as in P3c).

- [ ] **Step 1: Import the new ops** — add `editCardStatus, editCardTitle, recolorCard` to the `story-map` value import. (`editCardPoints` is shipped for the model + the modal; not board-wired in P4.)

- [ ] **Step 2: Palette + cycle helpers (module scope)**

```ts
/** The board's quick-cycle color palette (click the swatch to advance; wraps to "no color"). */
const CARD_PALETTE = ["#fca5a5", "#fdba74", "#fde047", "#86efac", "#93c5fd", "#c4b5fd"] as const;
/** The status cycle order; "" = clear (no status). */
const STATUS_CYCLE = ["planned", "in-progress", "done", "blocked", ""] as const;

/** The next palette color after `current` ("" → first; last → "" to clear). Pure. */
const nextColor = (current: string | undefined): string => {
  const i = CARD_PALETTE.indexOf((current ?? "") as (typeof CARD_PALETTE)[number]);
  if (i === -1) return CARD_PALETTE[0];
  return i + 1 < CARD_PALETTE.length ? CARD_PALETTE[i + 1] : "";
};

/** The next status after `current` in the cycle order. Pure. */
const nextStatus = (current: string | undefined): string => {
  const i = STATUS_CYCLE.indexOf((current ?? "") as (typeof STATUS_CYCLE)[number]);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
};
```

- [ ] **Step 3: Wire the swatch + chip clicks** — in `wireControls`, after the remove loop, add swatch + chip click loops:

```ts
for (const el of Array.from(svg.querySelectorAll("rect[data-color-index]"))) {
  const onClick = (): void => this.onCycleColor(el);
  el.addEventListener("click", onClick);
  this.cleanups.push(() => el.removeEventListener("click", onClick));
}
for (const el of Array.from(svg.querySelectorAll("rect[data-status-index]"))) {
  const onClick = (): void => this.onCycleStatus(el);
  el.addEventListener("click", onClick);
  this.cleanups.push(() => el.removeEventListener("click", onClick));
}
```

And the handlers (mirror `onRemove`'s shape — read index, compute next value, apply, repaint, save):

```ts
/** Advances the clicked card's color to the next palette entry and saves. */
private onCycleColor(el: Element): void {
  if (this.model === null) return;
  const index = indexAttr(el, "data-color-index");
  if (index === null) return;
  const next = recolorCard(this.model, index, nextColor(this.model.cards[index]?.color));
  this.applyCardEdit(next);
}

/** Advances the clicked card's planning status to the next in the cycle and saves. */
private onCycleStatus(el: Element): void {
  if (this.model === null) return;
  const index = indexAttr(el, "data-status-index");
  if (index === null) return;
  const next = editCardStatus(this.model, index, nextStatus(this.model.cards[index]?.status));
  this.applyCardEdit(next);
}

/** Commits a card-edit op result: repaints + schedules a save, or ignores a no-op/reject. */
private applyCardEdit(next: StoryMap | null): void {
  if (next === null || next === this.model) return;
  this.model = next;
  this.paint(this.contentEl);
  this.scheduleSave();
}
```

> Refactor opportunity: `onAdd`, `onRemove`, the drop handlers, and these all end in the same "if changed: model=next; paint; scheduleSave" tail. Route the new handlers through `applyCardEdit` (above). Leave the existing handlers as-is to keep the diff focused.

- [ ] **Step 4: Inline card title edit on double-click**

Extend `wireControls`' double-click wiring to include cards. Change the `headers` selector loop to ALSO bind cards to a card-title editor. Add `rect.sm-board-card` to a second dblclick loop:

```ts
for (const el of Array.from(svg.querySelectorAll("rect.sm-board-card"))) {
  const onDbl = (): void => this.onEditCardTitle(el as SVGElement);
  el.addEventListener("dblclick", onDbl);
  this.cleanups.push(() => el.removeEventListener("dblclick", onDbl));
}
```

Add `onEditCardTitle`, modeled on `onEditHeader` (reuse `mountHeaderInput` — it positions an `<input>` over any rect and seeds it from the rect's next-sibling text, which for a card is the `.sm-board-card-title`; verify the title text is the rect's `nextElementSibling`). Commit via `editCardTitle`:

```ts
/** Mounts an inline editor over a double-clicked card; commits the new title on Enter/blur. */
private onEditCardTitle(rect: SVGElement): void {
  if (this.model === null) return;
  const index = indexAttr(rect, "data-card-index");
  if (index === null) return;
  const input = this.mountHeaderInput(rect);
  if (input === null) return;
  let done = false;
  const commit = (save: boolean): void => {
    if (done) return;
    done = true;
    const value = input.value;
    this.clearEditor();
    if (save) this.applyCardEdit(editCardTitle(this.model!, index, value));
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit(true);
    else if (e.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
  input.focus();
  input.select();
  this.commitEditor = commit;
}
```

> NOTE: `mountHeaderInput` seeds the input from `headerLabelOf(rect)` = `rect.nextElementSibling?.textContent`. For a card rect the next sibling is the `.sm-board-card-title` text — correct. If the scene order ever changes, seed explicitly instead. The `commitEditor` field (P3b) makes onClose/onExternalUpdate/onMapDeleted flush this card edit too — no extra work.
> COMPLEXITY: `onEditCardTitle` duplicates `onEditHeader`'s closure shape. If the audit flags either for complexity, extract the shared "mount + commit-closure" into one private `mountInlineEditor(rect, commitFn)` helper used by both. Prefer this DRY extraction over two `fallow-ignore` comments.

- [ ] **Step 5: Styles** — add to `styles.css`:

```css
.sm-board-swatch { cursor: pointer; stroke: var(--background-modifier-border); }
.sm-board-status-chip { fill: var(--background-secondary); cursor: pointer; }
.sm-board-status-chip-label { fill: var(--text-muted); font-size: 10px; pointer-events: none; }
.sm-board-card { cursor: grab; touch-action: none; }
```

Add `.sm-board-status-chip-label` to the existing `pointer-events: none` pass-through rule. (The card already has `cursor: grab`; ensure double-click-to-edit still coexists with drag — interact.js only suppresses click after an actual drag move, so a stationary double-click reaches the dblclick listener.)

- [ ] **Step 6: Gate**

```bash
npm run lint && npm run typecheck && npm run build && npm run test:coverage
npx fallow audit --base origin/main
```
Expected: all pass; audit exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/views/story-map-board-view.ts styles.css
git commit -m "feat(story-map-board): inline card title edit + color/status cycle"
```

---

### Task 6: Docs + final gate

**Files:**
- Modify: `CONTEXT.md` (Story Map Board term → P4)
- Modify: `docs/adr/0029-story-map-visual-board.md` (P4 card-edit ops; modal stays for full attribute edit)
- Modify: this plan (check the boxes)

- [ ] **Step 1: CONTEXT.md** — extend the "Story Map Board" entry: P4 adds inline card editing — double-click a card to rename it, click its swatch to cycle color, click its status chip to cycle planning status; full attribute editing (points/tags/ref/coordinate) stays in the card modal.

- [ ] **Step 2: ADR-0029** — record the P4 ops (`editCardTitle`/`recolorCard`/`editCardStatus`/`editCardPoints`) and the decision that board-native card edits go through the board's model→`saveMap` loop, while the `StoryMapCardModal` (which saves via `service.updateCard`) remains the full-edit surface, picked up by the board as an external update.

- [ ] **Step 3: Final gate** — `npm run lint && npm run typecheck && npm run build && npm run test:coverage && npx fallow audit --base origin/main` → all green.

- [ ] **Step 4: Commit + push**

```bash
git add CONTEXT.md docs/adr/0029-story-map-visual-board.md docs/superpowers/plans/2026-06-20-story-map-board-p4.md
git commit -m "docs(story-map-board): P4 inline card editing + color"
git push -u origin claude/storymaps-prd-tooling-k9tpnx
```

# Story Map Visual Board — P1 (Read-only board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a Story Map as a read-only SVG board (users lane + activity/step columns × slice rows + colored card tiles) in the **main** Obsidian workspace view, opened from the Story Maps explorer.

**Architecture:** All geometry is pure and unit-tested: `computeBoardLayout` turns a `StoryMap` into positioned boxes (reusing the existing `buildStoryMapGrid`); `buildBoardScene` turns the layout into a flat list of SVG node specs (testable as data). A thin `StoryMapBoardView` (`ItemView`, main area) builds the `<svg>` from those specs and reloads on `storymap.updated`/`deleted`. No new runtime dependencies in P1 (panzoom / drag-and-drop arrive in P2/P5).

**Tech Stack:** TypeScript, Obsidian `ItemView`, SVG/DOM, Vitest. Reuses `src/domain/entities/story-map.ts` (`buildStoryMapGrid`) and the `LiveDashboardView` base.

**Spec:** `docs/superpowers/specs/2026-06-19-story-map-board-design.md`. This plan covers **P1 only**; P2–P5 (drag, reorder, inline edit, zoom/focus) get their own plans after P1 lands gate-green on branch `claude/storymaps-prd-tooling-k9tpnx` (PR #68).

**Gate after every commit:** `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit` (audit must exit 0). Run `npm run format` before committing.

---

## File structure (P1)

- Create `src/presentation/views/story-map-board-layout.ts` — pure geometry (`BoardLayout` types + `computeBoardLayout`).
- Create `src/presentation/views/story-map-board-scene.ts` — pure `SvgNodeSpec` types + `buildBoardScene`.
- Create `src/presentation/views/story-map-board-view.ts` — the `ItemView` (thin).
- Create `tests/story-map-board-layout.test.ts`, `tests/story-map-board-scene.test.ts`.
- Modify `src/register-views.ts` — register the board view.
- Modify `src/presentation/views/story-map-explorer-view.ts` — add an "Open board" action per row.
- Modify `src/main.ts` — `openStoryMapBoard(id)` opener; pass to explorer wiring.
- Modify `src/presentation/commands/register-commands.ts` — "Open Story Map board" command (opens the explorer; the per-row action opens a specific board). _(Optional; include only the explorer action if simpler.)_
- Modify `styles.css` — board theme.
- Create `docs/adr/0029-story-map-visual-board.md`.
- Modify `CONTEXT.md` — "Story Map Board" glossary term.

Card identity for later phases: a card's index in `map.cards` is its stable handle; `computeBoardLayout` records `cardIndex` on every box.

---

## Task 1: ADR-0029 (decision record)

**Files:**
- Create: `docs/adr/0029-story-map-visual-board.md`

- [ ] **Step 1: Write the ADR**

```markdown
---
type: adr
id: ADR-0029
status: accepted
title: Story Map Visual Board
date: 2026-06-19
related:
  - "[[0027-story-map-prd-sibling-overlay]]"
  - "[[0028-story-map-rich-model]]"
---

# Story Map Visual Board

ADR-0028 rendered a Story Map as a Markdown table in the note and made authoring
"edit frontmatter + rebuild"; the V2 proposal listed "no visual/drag-drop
builder" as a non-goal. The product owner has decided a **storymaps.io-style
interactive visual board** is the primary surface for working a map.

This ADR supersedes ADR-0028 §Rendering's "no canvas" stance and overrides that
non-goal **for Story Maps only**. The Markdown note frontmatter remains the
single source of truth; the board is an editable view over it, and the managed
Markdown table is **kept**, regenerated on every board edit so the note stays
readable/diffable and works on mobile / without the plugin.

The board renders in the **main workspace view** (not the sidebar). It is built
on **SVG/DOM** (not a canvas engine): SVG keeps per-element DOM (events,
accessibility, Obsidian CSS theming, native inline text editing) while allowing
vector zoom/pan. Card/column/slice geometry and all edit operations live in
**pure, unit-tested modules** behind a thin `ItemView`.

Later phases add the plugin's **first runtime dependencies** — `panzoom` (MIT,
zoom/pan) and `@atlaskit/pragmatic-drag-and-drop` (Apache-2.0, drag) — recorded
here; both are small, permissive, and version-pinned. P1 (read-only board) adds
no dependency.

## Considered alternatives
- **Keep the table-only model (ADR-0028).** Rejected by the product owner: the
  visual board is the requested experience.
- **Canvas/WebGL engine (Konva/Fabric/PixiJS) or a diagram engine
  (maxGraph/X6).** Rejected: canvas loses native text editing/theming and a
  generic diagram model fights a fixed column/row grid; SVG/DOM + two micro-libs
  is the smallest, best-fitting substrate (see the 2026-06-19 library research).

## Consequences
- The board supersedes the table as the primary authoring surface; the table is
  a kept, always-in-sync secondary rendering.
- All board logic is pure and tested; the `ItemView` stays thin (complexity gate).
- The plugin gains two small runtime dependencies in later phases (not P1).
- Zoom/pan and focus are ephemeral view state, never written to the note.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0029-story-map-visual-board.md
git commit -m "docs(adr): ADR-0029 Story Map visual board"
```

---

## Task 2: `computeBoardLayout` — column/row geometry

**Files:**
- Create: `src/presentation/views/story-map-board-layout.ts`
- Test: `tests/story-map-board-layout.test.ts`

Reuses `buildStoryMapGrid` (already returns ordered leaf columns `{activity, step?}` and rows `{slice, points, cells}`). This task adds pixel geometry for columns, activity groups (a header spanning an activity's step columns), rows, and the users lane. Cards are placed in Task 3 (kept separate so each task is one responsibility and each test is focused).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/story-map-board-layout.test.ts
import { describe, expect, it } from "vitest";
import {
  BOARD_METRICS,
  computeBoardLayout,
} from "../src/presentation/views/story-map-board-layout";
import type { StoryMap } from "../src/domain/entities/story-map";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const map = (over: Partial<StoryMap> = {}): StoryMap => ({
  id: "SM-001",
  title: "Journey",
  status: "draft",
  product: "PRD-000",
  users: ["Customer", "Admin"],
  activities: ["Browse", "Order"],
  steps: [{ activity: "Browse", step: "Filter" }],
  slices: ["Walking skeleton", "Next"],
  cards: [],
  displayOrder: 0,
  path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
  ...over,
});

describe("computeBoardLayout — columns & rows", () => {
  it("makes one leaf column per step, and a no-step column for a step-less activity", () => {
    const layout = computeBoardLayout(map());
    // Browse has one step (Filter) → one column; Order has none → one no-step column.
    expect(layout.columns.map((c) => [c.activity, c.step])).toEqual([
      ["Browse", "Filter"],
      ["Order", undefined],
    ]);
    // Columns are placed left-to-right after the row-header gutter, in order.
    expect(layout.columns[0].x).toBe(BOARD_METRICS.rowHeaderWidth);
    expect(layout.columns[1].x).toBe(
      BOARD_METRICS.rowHeaderWidth + BOARD_METRICS.colWidth + BOARD_METRICS.colGap,
    );
    expect(layout.columns[0].width).toBe(BOARD_METRICS.colWidth);
  });

  it("groups an activity header to span its leaf columns", () => {
    const layout = computeBoardLayout(
      map({ activities: ["Browse"], steps: [{ activity: "Browse", step: "A" }, { activity: "Browse", step: "B" }] }),
    );
    expect(layout.activityGroups).toHaveLength(1);
    const g = layout.activityGroups[0];
    expect(g.activity).toBe("Browse");
    expect(g.x).toBe(layout.columns[0].x);
    // Spans both step columns (2 cols + the gap between them).
    expect(g.width).toBe(BOARD_METRICS.colWidth * 2 + BOARD_METRICS.colGap);
  });

  it("places one row per slice below the lane + headers, in order", () => {
    const layout = computeBoardLayout(map());
    expect(layout.rows.map((r) => r.slice)).toEqual(["Walking skeleton", "Next"]);
    const headerBottom =
      BOARD_METRICS.laneHeight + BOARD_METRICS.activityHeaderHeight + BOARD_METRICS.stepHeaderHeight;
    expect(layout.rows[0].y).toBe(headerBottom);
    expect(layout.rows[0].height).toBe(BOARD_METRICS.minRowHeight); // no cards yet
  });

  it("exposes the users lane and overall canvas size", () => {
    const layout = computeBoardLayout(map());
    expect(layout.users).toEqual(["Customer", "Admin"]);
    expect(layout.width).toBe(
      BOARD_METRICS.rowHeaderWidth +
        2 * BOARD_METRICS.colWidth +
        1 * BOARD_METRICS.colGap,
    );
    expect(layout.height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/story-map-board-layout.test.ts`
Expected: FAIL (`computeBoardLayout`/`BOARD_METRICS` not found).

- [ ] **Step 3: Implement the layout module (columns/rows/groups/lane)**

```typescript
// src/presentation/views/story-map-board-layout.ts
import { buildStoryMapGrid, type StoryMap, type StoryMapCard } from "../../domain/entities/story-map";

/** Fixed pixel metrics for the board scene (a single source of truth for geometry + tests). */
export const BOARD_METRICS = {
  laneHeight: 40,
  activityHeaderHeight: 28,
  stepHeaderHeight: 24,
  rowHeaderWidth: 140,
  colWidth: 200,
  colGap: 12,
  rowGap: 12,
  cardHeight: 56,
  cardGap: 8,
  cellPadding: 8,
  get minRowHeight(): number {
    return this.cardHeight + 2 * this.cellPadding;
  },
} as const;

export interface BoardColumn {
  activity: string;
  step?: string;
  x: number;
  width: number;
}

export interface BoardActivityGroup {
  activity: string;
  x: number;
  width: number;
}

export interface BoardRow {
  slice: string;
  y: number;
  height: number;
}

export interface BoardCardBox {
  /** Index in `map.cards` — the stable handle later phases drag. */
  cardIndex: number;
  card: StoryMapCard;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardLayout {
  width: number;
  height: number;
  users: string[];
  activityGroups: BoardActivityGroup[];
  columns: BoardColumn[];
  rows: BoardRow[];
  cards: BoardCardBox[];
}

const M = BOARD_METRICS;

/** x of leaf column index `i`. */
const columnX = (i: number): number => M.rowHeaderWidth + i * (M.colWidth + M.colGap);

/**
 * Pure board geometry from a {@link StoryMap}. Leaf columns and the (column,
 * slice) cell contents come from {@link buildStoryMapGrid}; this assigns pixel
 * positions to columns, activity-group headers, slice rows, and the cards in
 * each cell. Cards whose (activity, step, slice) is not a column/row are omitted
 * (mirroring the grid). Card boxes within a row use the row's top.
 */
export const computeBoardLayout = (map: StoryMap): BoardLayout => {
  const grid = buildStoryMapGrid(map);

  const columns: BoardColumn[] = grid.columns.map((c, i) => ({
    activity: c.activity,
    step: c.step,
    x: columnX(i),
    width: M.colWidth,
  }));

  const activityGroups: BoardActivityGroup[] = [];
  for (const activity of map.activities) {
    const own = columns.filter((c) => c.activity === activity);
    if (own.length === 0) continue;
    const x = own[0].x;
    const last = own[own.length - 1];
    activityGroups.push({ activity, x, width: last.x + last.width - x });
  }

  const headerBottom = M.laneHeight + M.activityHeaderHeight + M.stepHeaderHeight;
  const cards: BoardCardBox[] = [];
  const rows: BoardRow[] = [];
  let y = headerBottom;
  for (const gridRow of grid.rows) {
    const maxCards = Math.max(0, ...gridRow.cells.map((cell) => cell.cards.length));
    const height = Math.max(M.minRowHeight, maxCards * (M.cardHeight + M.cardGap) + M.cardGap);
    rows.push({ slice: gridRow.slice, y, height });

    gridRow.cells.forEach((cell, colIdx) => {
      const colX = columns[colIdx].x;
      cell.cards.forEach((card, stackIdx) => {
        cards.push({
          cardIndex: map.cards.indexOf(card),
          card,
          x: colX + M.cellPadding,
          y: y + M.cellPadding + stackIdx * (M.cardHeight + M.cardGap),
          width: M.colWidth - 2 * M.cellPadding,
          height: M.cardHeight,
        });
      });
    });
    y += height + M.rowGap;
  }

  const lastCol = columns[columns.length - 1];
  const width = lastCol ? lastCol.x + lastCol.width : M.rowHeaderWidth;
  return { width, height: y, users: [...map.users], activityGroups, columns, rows, cards };
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/story-map-board-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-layout.ts tests/story-map-board-layout.test.ts
git commit -m "feat(story-map-board): pure column/row layout geometry"
```

---

## Task 3: layout — card placement test

**Files:**
- Test: `tests/story-map-board-layout.test.ts` (add a describe block)

`computeBoardLayout` already places cards (Task 2 code); this task pins that behavior with its own tests and verifies the `cardIndex` handle and row growth.

- [ ] **Step 1: Add the failing test**

```typescript
import type { StoryMapCard } from "../src/domain/entities/story-map";

describe("computeBoardLayout — cards", () => {
  const withCards = (cards: StoryMapCard[]) =>
    computeBoardLayout(map({ cards, steps: [] }));

  it("positions a card in its (activity, slice) cell with its map.cards index", () => {
    const layout = withCards([
      { title: "A", activity: "Browse", slice: "Walking skeleton", tags: [] },
    ]);
    expect(layout.cards).toHaveLength(1);
    const box = layout.cards[0];
    expect(box.cardIndex).toBe(0);
    expect(box.x).toBe(layout.columns[0].x + BOARD_METRICS.cellPadding);
    expect(box.y).toBe(layout.rows[0].y + BOARD_METRICS.cellPadding);
    expect(box.card.title).toBe("A");
  });

  it("stacks multiple cards in a cell and grows the row height", () => {
    const layout = withCards([
      { title: "A", activity: "Browse", slice: "Walking skeleton", tags: [] },
      { title: "B", activity: "Browse", slice: "Walking skeleton", tags: [] },
    ]);
    expect(layout.cards.map((c) => c.card.title)).toEqual(["A", "B"]);
    expect(layout.cards[1].y - layout.cards[0].y).toBe(
      BOARD_METRICS.cardHeight + BOARD_METRICS.cardGap,
    );
    expect(layout.rows[0].height).toBeGreaterThan(BOARD_METRICS.minRowHeight);
  });

  it("omits a card whose activity is off the backbone", () => {
    const layout = withCards([{ title: "X", activity: "Nope", slice: "Walking skeleton", tags: [] }]);
    expect(layout.cards).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify it passes** (the Task 2 implementation already satisfies it)

Run: `npx vitest run tests/story-map-board-layout.test.ts`
Expected: PASS. If any case fails, fix `computeBoardLayout` to match.

- [ ] **Step 3: Commit**

```bash
git add tests/story-map-board-layout.test.ts
git commit -m "test(story-map-board): card placement geometry"
```

---

## Task 4: `buildBoardScene` — layout → SVG node specs

**Files:**
- Create: `src/presentation/views/story-map-board-scene.ts`
- Test: `tests/story-map-board-scene.test.ts`

`SvgNodeSpec` is a pure data description of one SVG element so the scene is testable without a DOM.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/story-map-board-scene.test.ts
import { describe, expect, it } from "vitest";
import { buildBoardScene } from "../src/presentation/views/story-map-board-scene";
import { computeBoardLayout } from "../src/presentation/views/story-map-board-layout";
import type { StoryMap } from "../src/domain/entities/story-map";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const map: StoryMap = {
  id: "SM-001",
  title: "Journey",
  status: "draft",
  product: "PRD-000",
  users: ["Customer"],
  activities: ["Browse"],
  steps: [],
  slices: ["Walking skeleton"],
  cards: [
    { ref: "UC-001", title: "Filter", activity: "Browse", slice: "Walking skeleton", status: "planned", points: 3, tags: ["x"], color: "#93c5fd" },
  ],
  displayOrder: 0,
  path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
};

describe("buildBoardScene", () => {
  const scene = () => buildBoardScene(computeBoardLayout(map));

  it("emits a rect + label for the activity header, the slice row header, and each card", () => {
    const specs = scene();
    const classes = specs.map((s) => s.class);
    expect(classes).toContain("sm-board-activity");
    expect(classes).toContain("sm-board-slice");
    expect(classes).toContain("sm-board-card");
    expect(classes).toContain("sm-board-users");
  });

  it("renders the card title + a compact attribute suffix and carries its color + cardIndex", () => {
    const card = scene().find((s) => s.class === "sm-board-card" && s.tag === "rect");
    expect(card?.attrs.fill).toBe("#93c5fd");
    expect(card?.attrs["data-card-index"]).toBe(0);
    const text = scene().find((s) => s.class === "sm-board-card-title");
    expect(text?.text).toContain("Filter");
    const attrs = scene().find((s) => s.class === "sm-board-card-attrs");
    expect(attrs?.text).toContain("planned");
    expect(attrs?.text).toContain("3pts");
  });

  it("escapes nothing into attributes that aren't strings/numbers", () => {
    for (const spec of scene()) {
      for (const v of Object.values(spec.attrs)) {
        expect(["string", "number"]).toContain(typeof v);
      }
    }
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/story-map-board-scene.test.ts`
Expected: FAIL (`buildBoardScene` not found).

- [ ] **Step 3: Implement the scene builder**

```typescript
// src/presentation/views/story-map-board-scene.ts
import { cardAttributeSuffix } from "../../application/content/story-map-content";
import type { BoardLayout } from "./story-map-board-layout";
import { BOARD_METRICS } from "./story-map-board-layout";

/** A pure description of one SVG element — rendered to DOM by the view, testable as data. */
export interface SvgNodeSpec {
  tag: "rect" | "text" | "line";
  class: string;
  attrs: Record<string, string | number>;
  /** Text content for a `text` node. */
  text?: string;
}

const M = BOARD_METRICS;

const rect = (
  cls: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Record<string, string | number> = {},
): SvgNodeSpec => ({ tag: "rect", class: cls, attrs: { x, y, width, height, rx: 4, ...extra } });

const text = (cls: string, x: number, y: number, value: string): SvgNodeSpec => ({
  tag: "text",
  class: cls,
  attrs: { x, y },
  text: value,
});

/**
 * Pure: a {@link BoardLayout} → the flat list of SVG node specs that render it
 * (users lane, activity/step headers, slice rows, card tiles with title +
 * attribute suffix). No DOM; the view turns each spec into an element.
 */
export const buildBoardScene = (layout: BoardLayout): SvgNodeSpec[] => {
  const specs: SvgNodeSpec[] = [];

  // Users lane.
  specs.push(rect("sm-board-users", 0, 0, layout.width, M.laneHeight));
  if (layout.users.length > 0) {
    specs.push(text("sm-board-users-label", 8, M.laneHeight / 2 + 4, `Users: ${layout.users.join(" · ")}`));
  }

  // Activity group headers.
  for (const g of layout.activityGroups) {
    specs.push(rect("sm-board-activity", g.x, M.laneHeight, g.width, M.activityHeaderHeight));
    specs.push(text("sm-board-activity-label", g.x + 8, M.laneHeight + M.activityHeaderHeight / 2 + 4, g.activity));
  }

  // Step (column) headers.
  const stepY = M.laneHeight + M.activityHeaderHeight;
  for (const c of layout.columns) {
    specs.push(rect("sm-board-step", c.x, stepY, c.width, M.stepHeaderHeight));
    specs.push(text("sm-board-step-label", c.x + 8, stepY + M.stepHeaderHeight / 2 + 4, c.step ?? "(no step)"));
  }

  // Slice row headers.
  for (const r of layout.rows) {
    specs.push(rect("sm-board-slice", 0, r.y, M.rowHeaderWidth, r.height));
    specs.push(text("sm-board-slice-label", 8, r.y + 18, r.slice));
  }

  // Cards.
  for (const box of layout.cards) {
    specs.push(
      rect("sm-board-card", box.x, box.y, box.width, box.height, {
        "data-card-index": box.cardIndex,
        fill: box.card.color ?? "var(--background-secondary)",
      }),
    );
    specs.push(text("sm-board-card-title", box.x + 8, box.y + 20, box.card.title));
    const suffix = cardAttributeSuffix(box.card).replace(/^ · /, "");
    if (suffix !== "") specs.push(text("sm-board-card-attrs", box.x + 8, box.y + 40, suffix));
  }

  return specs;
};
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run tests/story-map-board-scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-scene.ts tests/story-map-board-scene.test.ts
git commit -m "feat(story-map-board): pure layout→SVG scene specs"
```

---

## Task 5: `StoryMapBoardView` — the main-area ItemView (thin)

**Files:**
- Create: `src/presentation/views/story-map-board-view.ts`

No unit test (it is a thin view; AGENTS.md). Keep each method's cyclomatic complexity ≤ 4 (delegate to the pure modules) so the fallow gate passes. Mirror `use-case-detail-view.ts` for the `ItemView` + view-state + `LiveDashboardView` pattern.

- [ ] **Step 1: Implement the view**

```typescript
// src/presentation/views/story-map-board-view.ts
import { type WorkspaceLeaf } from "obsidian";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderLoadError } from "./modal-helpers";
import { buildBoardScene, type SvgNodeSpec } from "./story-map-board-scene";
import { computeBoardLayout } from "./story-map-board-layout";

export const STORY_MAP_BOARD_VIEW_TYPE = "e2e-test-hub-story-map-board";

const SVG_NS = "http://www.w3.org/2000/svg";
const REFRESH_ON: DomainEventType[] = ["storymap.updated", "storymap.deleted"];

export interface StoryMapBoardDeps {
  storyMapService: Pick<StoryMapService, "findById">;
  eventBus: EventBus;
}

interface BoardState {
  storyMapId?: string;
}

/**
 * Read-only Story Map board in the main workspace view (P1). Renders the map as
 * SVG from the pure layout/scene modules; reloads on storymap.updated/deleted.
 */
export class StoryMapBoardView extends LiveDashboardView {
  private storyMapId: string | null = null;

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

  async setState(state: unknown, result: Parameters<LiveDashboardView["setState"]>[1]): Promise<void> {
    const next = (state ?? {}) as BoardState;
    this.storyMapId = next.storyMapId ?? null;
    await super.setState(state, result);
    await this.live.schedule();
  }

  protected async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("sm-board-container");
    if (this.storyMapId === null) {
      container.createEl("p", { text: "Open a Story Map from the explorer to see its board." });
      return;
    }
    const found = await this.deps.storyMapService.findById(this.storyMapId);
    if (!found.ok) {
      renderLoadError(container, `Could not load the board: ${found.error.message}`, "Retry", () =>
        void this.live.schedule(),
      );
      return;
    }
    if (!found.value) {
      container.createEl("p", { text: `Story Map ${this.storyMapId} was not found.` });
      return;
    }
    this.renderScene(container, buildBoardScene(computeBoardLayout(found.value)), found.value.title);
  }

  /** Builds the `<svg>` from the scene specs. Thin: no geometry here. */
  private renderScene(container: HTMLElement, specs: SvgNodeSpec[], title: string): void {
    container.createEl("h2", { text: title, cls: "sm-board-title" });
    const layout = computeBoardLayoutBounds(specs);
    const svg = container.createSvg("svg", {
      cls: "sm-board-svg",
      attr: { viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, height: layout.height },
    });
    for (const spec of specs) {
      const el = svg.createSvg(spec.tag, { cls: spec.class });
      for (const [k, v] of Object.entries(spec.attrs)) el.setAttribute(k, String(v));
      if (spec.text !== undefined) el.textContent = spec.text;
    }
  }
}

/** The max x/y across the scene (the svg viewBox extent). Pure helper kept local to the view. */
const computeBoardLayoutBounds = (specs: SvgNodeSpec[]): { width: number; height: number } => {
  let width = 0;
  let height = 0;
  for (const s of specs) {
    if (s.tag !== "rect") continue;
    width = Math.max(width, Number(s.attrs.x) + Number(s.attrs.width));
    height = Math.max(height, Number(s.attrs.y) + Number(s.attrs.height));
  }
  return { width: width + 8, height: height + 8 };
};
```

> **Note for the implementer:** `createSvg` is the Obsidian DOM helper for the SVG
> namespace (`HTMLElement.createSvg`). If the installed Obsidian typings don't
> expose it, fall back to `document.createElementNS(SVG_NS, tag)` + `appendChild`
> and keep `SVG_NS`. Verify `LiveDashboardView.setState`'s exact signature in
> `src/presentation/views/use-case-detail-view.ts` and match it (that view is the
> reference for view-state + `ItemView`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Fix the `setState` signature / `createSvg` typing per the note if needed.)

- [ ] **Step 3: Commit**

```bash
npm run format
git add src/presentation/views/story-map-board-view.ts
git commit -m "feat(story-map-board): read-only board ItemView"
```

---

## Task 6: Register the board view + open it from the explorer

**Files:**
- Modify: `src/register-views.ts`
- Modify: `src/main.ts`
- Modify: `src/presentation/views/story-map-explorer-view.ts`

- [ ] **Step 1: Register the view** (in `src/register-views.ts`, mirror the existing `plugin.registerView(STORY_MAP_VIEW_TYPE, …)` block)

```typescript
import {
  STORY_MAP_BOARD_VIEW_TYPE,
  StoryMapBoardView,
} from "./presentation/views/story-map-board-view";

// …inside registerViews, after the STORY_MAP_VIEW_TYPE registration:
plugin.registerView(
  STORY_MAP_BOARD_VIEW_TYPE,
  (leaf) => new StoryMapBoardView(leaf, { storyMapService: s.storyMapService, eventBus }),
);
```

- [ ] **Step 2: Add the opener in `src/main.ts`**

The board opens in the **main** area with the map id in view state. Add a method and pass it to the explorer wiring (mirror how `openStoryMapBuilder` is wired). Use the workspace adapter's leaf API:

```typescript
import { STORY_MAP_BOARD_VIEW_TYPE } from "./presentation/views/story-map-board-view";

// a method on the plugin:
private async openStoryMapBoard(storyMapId: string): Promise<void> {
  const leaf = this.app.workspace.getLeaf(true); // a new main-area tab
  await leaf.setViewState({ type: STORY_MAP_BOARD_VIEW_TYPE, active: true, state: { storyMapId } });
  this.app.workspace.revealLeaf(leaf);
}
```

Wire it into `registerViews(this, { … })`:

```typescript
openStoryMapBoard: (id) => void this.openStoryMapBoard(id),
```

Add `openStoryMapBoard: (storyMapId: string) => void;` to the `ViewWiringDeps` interface in `register-views.ts`, and pass it to the explorer factory (next step).

- [ ] **Step 3: Add an "Open board" action per explorer row** (`src/presentation/views/story-map-explorer-view.ts`)

Extend `StoryMapExplorerDeps` with `openStoryMapBoard: (id: string) => void;`, wire it in `register-views.ts` (`openStoryMapBoard: (id) => deps.openStoryMapBoard(id)`), and add a button in `renderRow` next to "Rebuild grid":

```typescript
row
  .createEl("button", {
    text: "Open board",
    cls: "e2e-test-hub-link-button",
    attr: { "aria-label": `Open the board for ${map.id}` },
  })
  .addEventListener("click", () => this.deps.openStoryMapBoard(map.id));
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/register-views.ts src/main.ts src/presentation/views/story-map-explorer-view.ts
git commit -m "feat(story-map-board): register + open board from the explorer"
```

---

## Task 7: Board styles

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Append the board theme** (themed via Obsidian CSS variables, mirroring the existing Story Map block)

```css
/* ---- Story Map board (P1) ---- */
.sm-board-container { overflow: auto; padding: var(--size-4-2, 8px); }
.sm-board-title { margin: 0 0 var(--size-4-2, 8px); }
.sm-board-svg { display: block; }
.sm-board-svg text { fill: var(--text-normal); font-size: var(--font-ui-smaller); }
.sm-board-users { fill: var(--background-secondary-alt); }
.sm-board-activity { fill: var(--background-secondary); stroke: var(--background-modifier-border); }
.sm-board-step { fill: var(--background-primary-alt); stroke: var(--background-modifier-border); }
.sm-board-slice { fill: var(--background-secondary); stroke: var(--background-modifier-border); }
.sm-board-card { stroke: var(--background-modifier-border); }
.sm-board-card-title { font-weight: 600; }
.sm-board-card-attrs { fill: var(--text-muted); }
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "style(story-map-board): board theme"
```

---

## Task 8: CONTEXT.md term + full gate + push

**Files:**
- Modify: `CONTEXT.md`

- [ ] **Step 1: Add the glossary term** (after the "Story Map Card" entry)

```markdown
**Story Map Board** _(see ADR-0029)_:
The interactive visual rendering of a **Story Map** in the main workspace view —
a users lane, activity/step columns, and slice rows of card tiles. An editable
view over the note frontmatter (the single source of truth); the managed Markdown
table is kept in sync. P1 is read-only; later phases add drag, inline editing, and
zoom/pan.
_Avoid_: Canvas, whiteboard, grid view.
```

- [ ] **Step 2: Run the full gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit`
Expected: all pass; `test:coverage` ≥ 80%; `quality:audit` exits 0. Fix any finding before committing (keep view methods ≤4 cyclomatic; no unused exports).

- [ ] **Step 3: Commit + push**

```bash
git add CONTEXT.md
git commit -m "docs(story-map-board): CONTEXT term; P1 read-only board complete"
git push origin claude/storymaps-prd-tooling-k9tpnx
```

---

## Self-review (done while writing)

- **Spec coverage (P1 slice):** read-only SVG board in main view ✓ (Tasks 2–6); users lane + columns/steps + slice rows + colored cards ✓ (Tasks 2–4, 7); opened from explorer ✓ (Task 6); reload on `storymap.updated`/`deleted` ✓ (Task 5 `REFRESH_ON`); ADR-0029 ✓ (Task 1); note table unchanged (board is read-only here) ✓. No new runtime deps in P1 ✓.
- **Deferred to later plans:** `saveMap` + drag (P2), reorder/edit (P3), inline edit/color (P4), zoom/pan/focus (P5), partials (follow-up). Stated up front.
- **Types consistent:** `BOARD_METRICS`, `BoardLayout`/`BoardColumn`/`BoardRow`/`BoardActivityGroup`/`BoardCardBox`, `SvgNodeSpec`, `computeBoardLayout`, `buildBoardScene`, `STORY_MAP_BOARD_VIEW_TYPE` used consistently across tasks.
- **Implementer caveats flagged, not placeholders:** `createSvg` vs `createElementNS` and the exact `LiveDashboardView.setState` signature are called out in Task 5 with a concrete fallback (verify against `use-case-detail-view.ts`).
```

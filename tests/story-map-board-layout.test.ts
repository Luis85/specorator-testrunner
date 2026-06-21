import { describe, expect, it } from "vitest";
import {
  BOARD_METRICS,
  computeBoardLayout,
  dropIndicator,
  headerDropIndicator,
  neighborCell,
  resolveActivityDropIndex,
  resolveColumnAt,
  resolveDropTarget,
  resolveSliceDropIndex,
} from "../src/presentation/views/story-map-board-layout";
import type { StoryMap, StoryMapCard } from "../src/domain/entities/story-map";
import { CARD_TYPE_COLORS } from "../src/domain/entities/story-map-card";
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
    expect(layout.columns.map((c) => [c.activity, c.step])).toEqual([
      ["Browse", "Filter"],
      ["Order", undefined],
    ]);
    expect(layout.columns[0].x).toBe(BOARD_METRICS.rowHeaderWidth);
    expect(layout.columns[1].x).toBe(
      BOARD_METRICS.rowHeaderWidth + BOARD_METRICS.colWidth + BOARD_METRICS.colGap,
    );
    expect(layout.columns[0].width).toBe(BOARD_METRICS.colWidth);
  });

  it("groups an activity header to span its leaf columns", () => {
    const layout = computeBoardLayout(
      map({
        activities: ["Browse"],
        steps: [
          { activity: "Browse", step: "A" },
          { activity: "Browse", step: "B" },
        ],
      }),
    );
    expect(layout.activityGroups).toHaveLength(1);
    const g = layout.activityGroups[0];
    expect(g.activity).toBe("Browse");
    expect(g.x).toBe(layout.columns[0].x);
    expect(g.width).toBe(BOARD_METRICS.colWidth * 2 + BOARD_METRICS.colGap);
  });

  it("places one row per slice below the lane + headers, in order", () => {
    const layout = computeBoardLayout(map());
    expect(layout.rows.map((r) => r.slice)).toEqual(["Walking skeleton", "Next"]);
    const headerBottom =
      BOARD_METRICS.laneHeight +
      BOARD_METRICS.activityHeaderHeight +
      BOARD_METRICS.stepHeaderHeight;
    expect(layout.rows[0].y).toBe(headerBottom);
    // A card-less row is the card-area minimum plus the reserved `+ card` footer.
    expect(layout.rows[0].height).toBe(BOARD_METRICS.minRowHeight + BOARD_METRICS.cellFooter);
  });

  it("exposes per-slice done/total/points on each row", () => {
    const layout = computeBoardLayout(
      map({
        activities: ["Browse"],
        steps: [],
        slices: ["Walking skeleton"],
        cards: [
          {
            title: "Done",
            activity: "Browse",
            slice: "Walking skeleton",
            status: "done",
            points: 3,
            tags: [],
          },
          {
            title: "Todo",
            activity: "Browse",
            slice: "Walking skeleton",
            status: "planned",
            points: 5,
            tags: [],
          },
        ],
      }),
    );
    expect(layout.rows[0].total).toBe(2);
    expect(layout.rows[0].done).toBe(1);
    expect(layout.rows[0].points).toBe(8);
  });

  it("exposes the users lane and overall canvas size", () => {
    const layout = computeBoardLayout(map());
    expect(layout.users).toEqual(["Customer", "Admin"]);
    // Content width (header + 2 columns + gap) plus the reserved `+ activity` margin.
    expect(layout.width).toBe(
      BOARD_METRICS.rowHeaderWidth +
        2 * BOARD_METRICS.colWidth +
        1 * BOARD_METRICS.colGap +
        BOARD_METRICS.colGap +
        BOARD_METRICS.addButtonWidth,
    );
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe("computeBoardLayout — cards", () => {
  const withCards = (cards: StoryMapCard[]) => computeBoardLayout(map({ cards, steps: [] }));

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
    const layout = withCards([
      { title: "X", activity: "Nope", slice: "Walking skeleton", tags: [] },
    ]);
    expect(layout.cards).toEqual([]);
  });

  it("exposes the typed card colour and points/tags chips on each box", () => {
    const layout = withCards([
      {
        title: "A",
        activity: "Browse",
        slice: "Walking skeleton",
        cardType: "task",
        points: 5,
        tags: ["alpha", "beta"],
      },
    ]);
    const box = layout.cards[0];
    expect(box.color).toBe(CARD_TYPE_COLORS.task);
    expect(box.chips.points).toBe(5);
    expect(box.chips.tags).toEqual(["alpha", "beta"]);
  });

  it("prefers an explicit colour override over the type colour, and omits a missing points chip", () => {
    const layout = withCards([
      {
        title: "B",
        activity: "Browse",
        slice: "Walking skeleton",
        cardType: "note",
        color: "#abcdef",
        tags: [],
      },
    ]);
    const box = layout.cards[0];
    expect(box.color).toBe("#abcdef");
    expect(box.chips.points).toBeUndefined();
    expect(box.chips.tags).toEqual([]);
  });
});

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

describe("resolveColumnAt", () => {
  it("returns the column (activity + step) under board-x, or null outside", () => {
    const layout = computeBoardLayout(map()); // a map with at least one step column
    const col = layout.columns[0];
    const hit = resolveColumnAt(layout, col.x + 1);
    expect(hit?.activity).toBe(col.activity);
    expect(hit?.step).toBe(col.step);
    expect(resolveColumnAt(layout, -50)).toBeNull();
  });
});

describe("neighborCell", () => {
  // Two leaf columns (Browse, Order — no steps) × two slices; one card top-left.
  const layout = computeBoardLayout(
    map({
      activities: ["Browse", "Order"],
      steps: [],
      slices: ["Walking skeleton", "Next"],
      cards: [{ title: "A", activity: "Browse", slice: "Walking skeleton", tags: [] }],
    }),
  );

  it("right → the next column's activity, same slice", () => {
    expect(neighborCell(layout, 0, "right")).toEqual({
      activity: "Order",
      slice: "Walking skeleton",
    });
  });

  it("down → same column, the next slice", () => {
    expect(neighborCell(layout, 0, "down")).toEqual({
      activity: "Browse",
      slice: "Next",
    });
  });

  it("left from the first column → null (edge)", () => {
    expect(neighborCell(layout, 0, "left")).toBeNull();
  });

  it("up from the first row → null (edge)", () => {
    expect(neighborCell(layout, 0, "up")).toBeNull();
  });

  it("an unknown cardIndex → null", () => {
    expect(neighborCell(layout, 99, "right")).toBeNull();
  });
});

describe("dropIndicator / headerDropIndicator", () => {
  // Two activities; Browse has step Filter, Order has none. Two slices.
  const m = map({
    activities: ["Browse", "Order"],
    steps: [{ activity: "Browse", step: "Filter" }],
    slices: ["Walking skeleton", "Next"],
    cards: [],
  });

  it("dropIndicator returns the cell rect and a horizontal line within the cell", () => {
    const layout = computeBoardLayout(m);
    const col = layout.columns[0]; // Browse / Filter
    const row = layout.rows[0]; // Walking skeleton
    const ind = dropIndicator(layout, { x: col.x + 10, y: row.y + 10 });
    expect(ind).not.toBeNull();
    expect(ind?.cell).toEqual({ x: col.x, y: row.y, width: col.width, height: row.height });
    expect(ind?.line.y1).toBe(ind?.line.y2);
    expect(ind?.line.y1).toBeGreaterThanOrEqual(row.y);
    expect(ind?.line.y1).toBeLessThanOrEqual(row.y + row.height);
    expect(ind?.line.x1).toBeGreaterThanOrEqual(col.x);
    expect(ind?.line.x2).toBeLessThanOrEqual(col.x + col.width);
  });

  it("dropIndicator returns null for a point in the header band", () => {
    const layout = computeBoardLayout(m);
    expect(dropIndicator(layout, { x: 5, y: 5 })).toBeNull();
  });

  it("headerDropIndicator(activity) returns a vertical line at the group's x", () => {
    const layout = computeBoardLayout(m);
    const g = layout.activityGroups[1];
    const ind = headerDropIndicator(layout, "activity", { x: g.x + 5, y: 0 });
    expect(ind).not.toBeNull();
    expect(ind?.line.x1).toBe(ind?.line.x2);
    expect(ind?.line.x1).toBe(g.x);
    expect(headerDropIndicator(layout, "activity", { x: -50, y: 0 })).toBeNull();
  });

  it("headerDropIndicator(slice) returns a horizontal line at the row's y", () => {
    const layout = computeBoardLayout(m);
    const row = layout.rows[1];
    const ind = headerDropIndicator(layout, "slice", { x: 0, y: row.y + 5 });
    expect(ind).not.toBeNull();
    expect(ind?.line.y1).toBe(ind?.line.y2);
    expect(ind?.line.y1).toBe(row.y);
  });

  it("headerDropIndicator(step) returns a vertical line at a declared-step column's x, null otherwise", () => {
    const layout = computeBoardLayout(m);
    const stepCol = layout.columns[0]; // Browse / Filter
    const ind = headerDropIndicator(layout, "step", { x: stepCol.x + 5, y: 0 });
    expect(ind).not.toBeNull();
    expect(ind?.line.x1).toBe(ind?.line.x2);
    expect(ind?.line.x1).toBe(stepCol.x);
    const noStepCol = layout.columns[1]; // Order / (no step)
    expect(headerDropIndicator(layout, "step", { x: noStepCol.x + 5, y: 0 })).toBeNull();
  });
});

describe("headerDropIndicator insertion side (preview matches persisted order)", () => {
  // Browse owns two steps so a same-activity forward step move exists; two slices.
  const m = map({
    activities: ["Browse", "Order"],
    steps: [
      { activity: "Browse", step: "Filter" },
      { activity: "Browse", step: "Search" },
    ],
    slices: ["Walking skeleton", "Next"],
    cards: [],
  });

  it("anchors a forward activity move to the target's trailing edge, backward to its leading edge", () => {
    const layout = computeBoardLayout(m);
    const target = layout.activityGroups[1];
    // Dragging group 0 onto group 1 (forward): reorderActivity lands it AT index 1,
    // i.e. past the target — preview the line on the target's far (right) edge.
    const forward = headerDropIndicator(layout, "activity", { x: target.x + 5, y: 0 }, 0);
    expect(forward?.line.x1).toBe(target.x + target.width);
    // A backward move (drag a later group onto an earlier one) keeps the leading edge.
    const back = layout.activityGroups[0];
    const backward = headerDropIndicator(layout, "activity", { x: back.x + 5, y: 0 }, 1);
    expect(backward?.line.x1).toBe(back.x);
  });

  it("anchors a forward slice move to the target row's bottom edge", () => {
    const layout = computeBoardLayout(m);
    const target = layout.rows[1];
    const forward = headerDropIndicator(layout, "slice", { x: 0, y: target.y + 5 }, 0);
    expect(forward?.line.y1).toBe(target.y + target.height);
    const backward = headerDropIndicator(layout, "slice", { x: 0, y: layout.rows[0].y + 5 }, 1);
    expect(backward?.line.y1).toBe(layout.rows[0].y);
  });

  it("anchors a forward step move to the target column's trailing edge", () => {
    const layout = computeBoardLayout(m);
    const filter = layout.columns[0]; // Browse / Filter
    const search = layout.columns[1]; // Browse / Search
    // Drag Filter (column index 0) onto Search (column index 1): forward.
    const forward = headerDropIndicator(layout, "step", { x: search.x + 5, y: 0 }, 0);
    expect(forward?.line.x1).toBe(search.x + search.width);
    // Drag Search onto Filter: backward → leading edge.
    const backward = headerDropIndicator(layout, "step", { x: filter.x + 5, y: 0 }, 1);
    expect(backward?.line.x1).toBe(filter.x);
  });
});

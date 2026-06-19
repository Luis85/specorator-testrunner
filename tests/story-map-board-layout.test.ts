import { describe, expect, it } from "vitest";
import {
  BOARD_METRICS,
  computeBoardLayout,
} from "../src/presentation/views/story-map-board-layout";
import type { StoryMap, StoryMapCard } from "../src/domain/entities/story-map";
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
    expect(layout.rows[0].height).toBe(BOARD_METRICS.minRowHeight);
  });

  it("exposes the users lane and overall canvas size", () => {
    const layout = computeBoardLayout(map());
    expect(layout.users).toEqual(["Customer", "Admin"]);
    expect(layout.width).toBe(
      BOARD_METRICS.rowHeaderWidth + 2 * BOARD_METRICS.colWidth + 1 * BOARD_METRICS.colGap,
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
});

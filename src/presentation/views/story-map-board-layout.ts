import {
  buildStoryMapGrid,
  type CardTarget,
  type StoryMap,
  type StoryMapCard,
} from "../../domain/entities/story-map";

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
  /** Reserved band at the bottom of every row for the per-cell `+ card` control. */
  cellFooter: 26,
  /** The wide `+ activity`/`+ slice`/`+ card` button size. */
  addButtonWidth: 84,
  addButtonHeight: 22,
  /** The small square `+`/`×` control size (per-activity add-step). */
  plusSize: 16,
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
    const stack = Math.max(M.minRowHeight, maxCards * (M.cardHeight + M.cardGap) + M.cardGap);
    // Reserve a footer below the card stack so the per-cell `+ card` control sits
    // in empty space (cards are laid from the top) and never overlaps a card.
    const height = stack + M.cellFooter;
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
  const contentWidth = lastCol ? lastCol.x + lastCol.width : M.rowHeaderWidth;
  // Reserve canvas space (right + bottom) so the `+ activity` and `+ slice`
  // controls the scene draws past the last column/row stay inside the viewBox.
  const width = contentWidth + M.colGap + M.addButtonWidth;
  const height = y + M.addButtonHeight;
  return { width, height, users: [...map.users], activityGroups, columns, rows, cards };
};

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
  return col.step !== undefined
    ? { activity: col.activity, step: col.step }
    : { activity: col.activity };
};

/**
 * The drop coordinate of the cell adjacent to the card at `cardIndex` in `dir`
 * (left/right move across leaf columns; up/down across slice rows), or null at an
 * edge or when the card is not laid out. Lets the keyboard move a card cell-to-cell
 * via `moveCard`. Pure.
 */
export const neighborCell = (
  layout: BoardLayout,
  cardIndex: number,
  dir: "left" | "right" | "up" | "down",
): CardTarget | null => {
  const box = layout.cards.find((b) => b.cardIndex === cardIndex);
  if (box === undefined) return null;
  const colIndex = layout.columns.findIndex(
    (c) => c.activity === box.card.activity && c.step === box.card.step,
  );
  const rowIndex = layout.rows.findIndex((r) => r.slice === box.card.slice);
  if (colIndex === -1 || rowIndex === -1) return null;
  const colDelta = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const rowDelta = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  const col = layout.columns[colIndex + colDelta];
  const row = layout.rows[rowIndex + rowDelta];
  if (col === undefined || row === undefined) return null;
  return {
    activity: col.activity,
    ...(col.step !== undefined ? { step: col.step } : {}),
    slice: row.slice,
  };
};

/** A drag-time card drop overlay: the target cell rect + the stack insertion line. */
export interface DropCellIndicator {
  cell: { x: number; y: number; width: number; height: number };
  line: { x1: number; y1: number; x2: number; y2: number };
}

/** A drag-time header-reorder overlay: a single insertion line at the target slot. */
export interface HeaderDropIndicator {
  line: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * The card-drop overlay for a board `point`: the (column × row) cell rect to
 * highlight and the horizontal insertion line at the resolved stack slot, or null
 * when the point is over no cell. Pure.
 */
export const dropIndicator = (layout: BoardLayout, point: BoardPoint): DropCellIndicator | null => {
  const target = resolveDropTarget(layout, point);
  if (target === null) return null;
  const column = layout.columns.find((c) => point.x >= c.x && point.x < c.x + c.width);
  const row = layout.rows.find((r) => point.y >= r.y && point.y < r.y + r.height);
  if (column === undefined || row === undefined) return null;
  const lineY =
    row.y + M.cellPadding + target.indexInCell * (M.cardHeight + M.cardGap) - M.cardGap / 2;
  return {
    cell: { x: column.x, y: row.y, width: column.width, height: row.height },
    line: {
      x1: column.x + M.cellPadding,
      y1: lineY,
      x2: column.x + column.width - M.cellPadding,
      y2: lineY,
    },
  };
};

/**
 * The header-reorder overlay for a board `point`: a vertical line at the target
 * activity-group / step-column left edge, or a horizontal line at the target slice
 * row's top edge. Null when the point is outside every group/column/row. Pure.
 */
export const headerDropIndicator = (
  layout: BoardLayout,
  kind: "activity" | "slice" | "step",
  point: BoardPoint,
): HeaderDropIndicator | null => {
  if (kind === "slice") {
    const i = resolveSliceDropIndex(layout, point.y);
    if (i === null) return null;
    const y = layout.rows[i].y;
    return { line: { x1: 0, y1: y, x2: layout.width, y2: y } };
  }
  if (kind === "activity") {
    const i = resolveActivityDropIndex(layout, point.x);
    if (i === null) return null;
    const x = layout.activityGroups[i].x;
    return { line: { x1: x, y1: M.laneHeight, x2: x, y2: layout.height } };
  }
  const col = resolveColumnAt(layout, point.x);
  if (col?.step === undefined) return null;
  const c = layout.columns.find((cc) => cc.activity === col.activity && cc.step === col.step);
  if (c === undefined) return null;
  return { line: { x1: c.x, y1: M.laneHeight, x2: c.x, y2: layout.height } };
};

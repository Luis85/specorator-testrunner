import {
  buildStoryMapGrid,
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

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
    specs.push(
      text("sm-board-users-label", 8, M.laneHeight / 2 + 4, `Users: ${layout.users.join(" · ")}`),
    );
  }

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

  // Step (column) headers.
  const stepY = M.laneHeight + M.activityHeaderHeight;
  for (const c of layout.columns) {
    specs.push(rect("sm-board-step", c.x, stepY, c.width, M.stepHeaderHeight));
    specs.push(
      text(
        "sm-board-step-label",
        c.x + 8,
        stepY + M.stepHeaderHeight / 2 + 4,
        c.step ?? "(no step)",
      ),
    );
  }

  // Slice row headers.
  layout.rows.forEach((r, i) => {
    specs.push(
      rect("sm-board-slice", 0, r.y, M.rowHeaderWidth, r.height, { "data-slice-index": i }),
    );
    specs.push(text("sm-board-slice-label", 8, r.y + 18, r.slice));
  });

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

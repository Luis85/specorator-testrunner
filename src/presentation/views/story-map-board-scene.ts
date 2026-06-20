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

  // Step (column) headers — tagged with their activity (+ step when present) so
  // the view can resolve which one a rename/edit targets.
  const stepY = M.laneHeight + M.activityHeaderHeight;
  for (const c of layout.columns) {
    const attrs: Record<string, string | number> =
      c.step !== undefined
        ? { "data-activity": c.activity, "data-step": c.step }
        : { "data-activity": c.activity };
    specs.push(rect("sm-board-step", c.x, stepY, c.width, M.stepHeaderHeight, attrs));
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

  // Add affordances (+). The view reads `data-add` (+ `data-activity` for steps).
  const lastGroup = layout.activityGroups[layout.activityGroups.length - 1];
  const addActivityX = lastGroup ? lastGroup.x + lastGroup.width + M.colGap : M.rowHeaderWidth;
  specs.push(
    ...addButton("sm-board-add-activity", addActivityX, M.laneHeight, "+ activity", {
      "data-add": "activity",
    }),
  );

  const stepBandY = M.laneHeight + M.activityHeaderHeight;
  for (const g of layout.activityGroups) {
    specs.push(
      ...addButton("sm-board-add-step", g.x + g.width - 28, stepBandY, "+", {
        "data-add": "step",
        "data-activity": g.activity,
      }),
    );
  }

  const lastRow = layout.rows[layout.rows.length - 1];
  const addSliceY = lastRow
    ? lastRow.y + lastRow.height + M.rowGap
    : stepBandY + M.stepHeaderHeight;
  specs.push(...addButton("sm-board-add-slice", 0, addSliceY, "+ slice", { "data-add": "slice" }));

  return specs;
};

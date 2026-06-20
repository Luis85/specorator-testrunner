import { CARD_TYPES, CARD_TYPE_COLORS } from "../../domain/entities/story-map-card";
import type { BoardLayout } from "./story-map-board-layout";
import { BOARD_METRICS } from "./story-map-board-layout";

/** A pure description of one SVG element — rendered to DOM by the view, testable as data. */
export interface SvgNodeSpec {
  tag: "rect" | "text" | "line" | "g" | "title";
  class: string;
  attrs: Record<string, string | number>;
  /** Text content for a `text` (or `title`) node. */
  text?: string;
  /** Nested specs (e.g. a `g` group's members, or a control rect's `title` tooltip). */
  children?: SvgNodeSpec[];
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

/** A `<g>` group wrapping `children` (used to wrap a card so its controls hover-reveal). */
const group = (
  cls: string,
  attrs: Record<string, string | number>,
  children: SvgNodeSpec[],
): SvgNodeSpec => ({ tag: "g", class: cls, attrs, children });

/** A `<title>` tooltip child (shown on hover of its parent control). */
const tooltip = (label: string): SvgNodeSpec => ({
  tag: "title",
  class: "",
  attrs: {},
  text: label,
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

/** A small clickable `✎` edit control (rect + label sharing the `data-edit` attrs). */
const editButton = (
  cls: string,
  x: number,
  y: number,
  data: Record<string, string | number>,
): SvgNodeSpec[] => [
  rect(cls, x, y, 16, 16, data),
  { tag: "text", class: `${cls}-label`, attrs: { x: x + 3, y: y + 12, ...data }, text: "✎" },
];

/** A small clickable `+` control (16×16 rect + label sharing the `data-add` attrs). */
const plusButton = (
  cls: string,
  x: number,
  y: number,
  data: Record<string, string | number>,
): SvgNodeSpec[] => [
  rect(cls, x, y, M.plusSize, M.plusSize, data),
  { tag: "text", class: `${cls}-label`, attrs: { x: x + 4, y: y + 12, ...data }, text: "+" },
];

/** A small chip (rect + centred-ish label) used for the points/tag footer chips. */
const chip = (cls: string, x: number, y: number, width: number, label: string): SvgNodeSpec[] => [
  rect(cls, x, y, width, M.chipHeight),
  text(`${cls}-label`, x + 4, y + M.chipHeight - 3, label),
];

/**
 * The points + tag chips laid left-to-right along a card's chip row (just above the
 * swatch/status row). A points chip (when set) leads; one tag chip per tag follows.
 * Pure: returns flat specs at absolute coordinates.
 */
const chipSpecs = (box: BoardLayout["cards"][number]): SvgNodeSpec[] => {
  const specs: SvgNodeSpec[] = [];
  let x = box.x + 8;
  const y = box.y + box.height - 32;
  if (box.chips.points !== undefined) {
    specs.push(...chip("sm-board-chip-points", x, y, M.chipPointsWidth, String(box.chips.points)));
    x += M.chipPointsWidth + M.chipGap;
  }
  for (const tag of box.chips.tags) {
    const width = Math.min(M.chipTagMaxWidth, M.chipTagPad + tag.length * M.chipCharWidth);
    specs.push(...chip("sm-board-chip-tag", x, y, width, `#${tag}`));
    x += width + M.chipGap;
  }
  return specs;
};

/**
 * One card's `<g class="sm-board-card-group">` wrapping its rect/title/attrs/remove/
 * swatch/chip children AT THEIR ABSOLUTE COORDINATES (no transform). The group carries
 * `data-card-index` for drag/edit; the controls reveal on group hover (CSS) and carry
 * `<title>` tooltips.
 */
const cardGroupSpec = (box: BoardLayout["cards"][number]): SvgNodeSpec => {
  const children: SvgNodeSpec[] = [
    rect("sm-board-card", box.x, box.y, box.width, box.height, {
      "data-card-index": box.cardIndex,
      fill: box.color,
    }),
    text("sm-board-card-title", box.x + 8, box.y + 20, box.card.title),
  ];
  if (box.card.ref !== undefined && box.card.ref !== "") {
    children.push(text("sm-board-card-ref", box.x + 8, box.y + 34, box.card.ref));
  }
  children.push(...chipSpecs(box));
  const remove = removeButton("sm-board-remove", box.x + box.width - 18, box.y + 4, {
    "data-remove": "card",
    "data-card-index": box.cardIndex,
  });
  remove[0].children = [tooltip("Remove card")];
  children.push(...remove);
  const edit = editButton("sm-board-edit", box.x + box.width - 36, box.y + 4, {
    "data-edit": "card",
    "data-card-index": box.cardIndex,
  });
  edit[0].children = [tooltip("Edit details")];
  children.push(...edit);
  // Color swatch (click → cycle palette) at the card's bottom-left.
  const swatch = rect("sm-board-swatch", box.x + 8, box.y + box.height - 16, 12, 12, {
    "data-color-index": box.cardIndex,
    fill: box.card.color ?? "var(--background-modifier-border)",
  });
  swatch.children = [tooltip("Cycle color")];
  children.push(swatch);
  // Status chip (click → cycle status) next to the swatch.
  const chip = rect("sm-board-status-chip", box.x + 26, box.y + box.height - 16, 56, 12, {
    "data-status-index": box.cardIndex,
  });
  chip.children = [tooltip("Cycle status")];
  children.push(chip);
  children.push(
    text("sm-board-status-chip-label", box.x + 30, box.y + box.height - 6, box.card.status ?? "—"),
  );
  return group(
    "sm-board-card-group",
    {
      "data-card-index": box.cardIndex,
      tabindex: 0,
      role: "group",
      "aria-label": `Card: ${box.card.title}`,
    },
    children,
  );
};

/** Card tiles (one `<g>` per card) for every laid-out card. */
const cardSpecs = (layout: BoardLayout): SvgNodeSpec[] => layout.cards.map(cardGroupSpec);

/**
 * The users lane: the lane background, then one editable chip per user (double-
 * click to rename, × to remove) plus a trailing `+ user` control — mirrors the
 * activity/slice header affordances so the audience is board-editable. Extracted
 * to keep `buildBoardScene` under the cognitive-complexity gate.
 */
const usersLaneSpecs = (layout: BoardLayout): SvgNodeSpec[] => {
  const specs: SvgNodeSpec[] = [rect("sm-board-users", 0, 0, layout.width, M.laneHeight)];
  layout.users.forEach((user, i) => {
    const x = M.cellPadding + i * (M.userChipWidth + M.userChipGap);
    const card = rect("sm-board-user-card", x, 8, M.userChipWidth, M.userCardHeight, {
      "data-user-index": i,
      tabindex: 0,
      role: "button",
      "aria-label": `User: ${user}`,
    });
    card.children = [tooltip("Double-click to rename")];
    specs.push(card);
    specs.push(text("sm-board-user-label", x + 6, 24, user));
    specs.push(
      ...removeButton("sm-board-remove", x + M.userChipWidth - 18, 10, {
        "data-remove": "user",
        "data-user-index": i,
      }),
    );
  });
  const addUserX = M.cellPadding + layout.users.length * (M.userChipWidth + M.userChipGap);
  specs.push(...addButton("sm-board-add-user", addUserX, 9, "+ user", { "data-add": "user" }));
  return specs;
};

/** A `+ card` affordance in every (row × column) cell, tagged with the cell coordinate. */
const addCardSpecs = (layout: BoardLayout): SvgNodeSpec[] =>
  layout.rows.flatMap((r) =>
    layout.columns.flatMap((c) =>
      addButton("sm-board-add-card", c.x + 8, r.y + r.height - 24, "+ card", {
        "data-add": "card",
        "data-activity": c.activity,
        ...(c.step !== undefined ? { "data-step": c.step } : {}),
        "data-slice": r.slice,
      }),
    ),
  );

/**
 * The per-slice roll-up labels on a row header: a `"{done}/{total}"` progress label,
 * a `"{points} pts"` points label, and a thin progress bar filled proportionally to
 * `done/total` (zero-width when the slice is empty). Pure.
 */
const sliceProgressSpecs = (row: BoardLayout["rows"][number]): SvgNodeSpec[] => {
  const barWidth = M.rowHeaderWidth - 16;
  const barY = row.y + 30;
  const filled = row.total > 0 ? Math.round((barWidth * row.done) / row.total) : 0;
  return [
    text("sm-board-slice-progress", 8, row.y + 44, `${row.done}/${row.total}`),
    text("sm-board-slice-points", 8, row.y + 58, `${row.points} pts`),
    rect("sm-board-progress-track", 8, barY, barWidth, 4),
    rect("sm-board-progress", 8, barY, filled, 4),
  ];
};

/**
 * A static card-type legend: a `g.sm-board-legend` with, per CARD_TYPE, a coloured
 * swatch rect (fill = its CARD_TYPE_COLORS entry) plus a text label, laid out in the
 * band the layout reserves below the grid. Pure.
 */
const legendSpecs = (layout: BoardLayout): SvgNodeSpec[] => {
  const top = layout.height - (M.legendTop + CARD_TYPES.length * M.legendRowGap);
  const children: SvgNodeSpec[] = [];
  CARD_TYPES.forEach((type, i) => {
    const y = top + i * M.legendRowGap;
    children.push(
      rect("sm-board-legend-swatch", 8, y, M.legendSwatch, M.legendSwatch, {
        fill: CARD_TYPE_COLORS[type],
      }),
    );
    children.push(
      text("sm-board-legend-label", 8 + M.legendLabelOffset, y + M.legendSwatch - 2, type),
    );
  });
  return [group("sm-board-legend", {}, children)];
};

/**
 * Pure: a {@link BoardLayout} → the flat list of SVG node specs that render it
 * (users lane, activity/step headers, slice rows, card tiles with title +
 * attribute suffix). No DOM; the view turns each spec into an element.
 */
export const buildBoardScene = (layout: BoardLayout): SvgNodeSpec[] => {
  const specs: SvgNodeSpec[] = [];

  // Users lane: the lane background, then one editable chip per user (double-click
  // to rename, × to remove) plus a trailing `+ user` control — mirrors the
  // activity/slice header affordances so the audience is board-editable.
  specs.push(...usersLaneSpecs(layout));

  // Activity group headers.
  layout.activityGroups.forEach((g, i) => {
    const activityRect = rect(
      "sm-board-activity",
      g.x,
      M.laneHeight,
      g.width,
      M.activityHeaderHeight,
      {
        "data-activity-index": i,
        tabindex: 0,
        role: "button",
        "aria-label": `Activity: ${g.activity}`,
      },
    );
    activityRect.children = [tooltip("Double-click to rename")];
    specs.push(activityRect);
    specs.push(
      text(
        "sm-board-activity-label",
        g.x + 8,
        M.laneHeight + M.activityHeaderHeight / 2 + 4,
        g.activity,
      ),
    );
    specs.push(
      ...removeButton("sm-board-remove", g.x + g.width - 18, M.laneHeight + 4, {
        "data-remove": "activity",
        "data-activity-index": i,
      }),
    );
  });

  // Step (column) headers — tagged with their activity (+ step when present) so
  // the view can resolve which one a rename/edit targets.
  const stepY = M.laneHeight + M.activityHeaderHeight;
  for (const c of layout.columns) {
    const base = { tabindex: 0, role: "button", "aria-label": `Step: ${c.step ?? "(no step)"}` };
    const attrs: Record<string, string | number> =
      c.step !== undefined
        ? { ...base, "data-activity": c.activity, "data-step": c.step }
        : { ...base, "data-activity": c.activity };
    const stepRect = rect("sm-board-step", c.x, stepY, c.width, M.stepHeaderHeight, attrs);
    stepRect.children = [tooltip("Double-click to rename")];
    specs.push(stepRect);
    specs.push(
      text(
        "sm-board-step-label",
        c.x + 8,
        stepY + M.stepHeaderHeight / 2 + 4,
        c.step ?? "(no step)",
      ),
    );
    if (c.step !== undefined) {
      specs.push(
        ...removeButton("sm-board-remove", c.x + c.width - 18, stepY + 4, {
          "data-remove": "step",
          "data-activity": c.activity,
          "data-step": c.step,
        }),
      );
    }
  }

  // Slice row headers.
  layout.rows.forEach((r, i) => {
    const sliceRect = rect("sm-board-slice", 0, r.y, M.rowHeaderWidth, r.height, {
      "data-slice-index": i,
      tabindex: 0,
      role: "button",
      "aria-label": `Slice: ${r.slice}`,
    });
    sliceRect.children = [tooltip("Double-click to rename")];
    specs.push(sliceRect);
    specs.push(text("sm-board-slice-label", 8, r.y + 18, r.slice));
    specs.push(...sliceProgressSpecs(r));
    specs.push(
      ...removeButton("sm-board-remove", M.rowHeaderWidth - 18, r.y + 4, {
        "data-remove": "slice",
        "data-slice-index": i,
      }),
    );
  });

  // Card tiles + the per-cell add-card affordances (extracted to keep this builder
  // under the cognitive-complexity gate).
  specs.push(...cardSpecs(layout));
  specs.push(...addCardSpecs(layout));

  // Add affordances (+). The view reads `data-add` (+ `data-activity` for steps).
  const lastGroup = layout.activityGroups[layout.activityGroups.length - 1];
  const addActivityX = lastGroup ? lastGroup.x + lastGroup.width + M.colGap : M.rowHeaderWidth;
  specs.push(
    ...addButton("sm-board-add-activity", addActivityX, M.laneHeight, "+ activity", {
      "data-add": "activity",
    }),
  );

  // Per-activity add-step `+` — a narrow control INSIDE the activity header, just
  // left of that header's remove `×` (`g.x + g.width - 18`), so it never overflows
  // the group into the next header (which would steal its drag/rename clicks).
  for (const g of layout.activityGroups) {
    specs.push(
      ...plusButton("sm-board-add-step", g.x + g.width - 38, M.laneHeight + 4, {
        "data-add": "step",
        "data-activity": g.activity,
      }),
    );
  }

  const lastRow = layout.rows[layout.rows.length - 1];
  const headerBottom = M.laneHeight + M.activityHeaderHeight + M.stepHeaderHeight;
  const addSliceY = lastRow ? lastRow.y + lastRow.height + M.rowGap : headerBottom;
  specs.push(...addButton("sm-board-add-slice", 0, addSliceY, "+ slice", { "data-add": "slice" }));

  // Static card-type legend below the grid (in the layout-reserved band).
  specs.push(...legendSpecs(layout));

  // Empty state: when the map has no cards yet, a centered hint in the first row.
  if (layout.cards.length === 0 && layout.rows.length > 0) {
    specs.push(
      text(
        "sm-board-empty",
        (M.rowHeaderWidth + layout.width) / 2,
        layout.rows[0].y + 28,
        "No cards yet — hover a cell and click + card to add one.",
      ),
    );
  }

  return specs;
};

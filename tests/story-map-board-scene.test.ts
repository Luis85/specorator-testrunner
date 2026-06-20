import { describe, expect, it } from "vitest";
import { buildBoardScene, type SvgNodeSpec } from "../src/presentation/views/story-map-board-scene";
import { computeBoardLayout } from "../src/presentation/views/story-map-board-layout";
import type { StoryMap } from "../src/domain/entities/story-map";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

/** Flattens the scene tree (groups now wrap cards) so a search reaches nested specs. */
const flatten = (specs: SvgNodeSpec[]): SvgNodeSpec[] =>
  specs.flatMap((s) => [s, ...(s.children ? flatten(s.children) : [])]);

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
    {
      ref: "UC-001",
      title: "Filter",
      activity: "Browse",
      slice: "Walking skeleton",
      status: "planned",
      points: 3,
      tags: ["x"],
      color: "#93c5fd",
    },
  ],
  displayOrder: 0,
  path: unsafeVaultPath("Story Maps/SM-001/SM-001.md"),
};

describe("buildBoardScene", () => {
  const scene = () => buildBoardScene(computeBoardLayout(map));

  it("emits a rect + label for the activity header, the slice row header, and each card", () => {
    const specs = flatten(scene());
    const classes = specs.map((s) => s.class);
    expect(classes).toContain("sm-board-activity");
    expect(classes).toContain("sm-board-slice");
    expect(classes).toContain("sm-board-card");
    expect(classes).toContain("sm-board-users");
  });

  it("renders the card title + a compact attribute suffix and carries its color + cardIndex", () => {
    const card = flatten(scene()).find((s) => s.class === "sm-board-card" && s.tag === "rect");
    expect(card?.attrs.fill).toBe("#93c5fd");
    expect(card?.attrs["data-card-index"]).toBe(0);
    const text = flatten(scene()).find((s) => s.class === "sm-board-card-title");
    expect(text?.text).toContain("Filter");
    const attrs = flatten(scene()).find((s) => s.class === "sm-board-card-attrs");
    expect(attrs?.text).toContain("planned");
    expect(attrs?.text).toContain("3pts");
  });

  it("falls back to a themed fill for a card with no color", () => {
    const colorless: StoryMap = {
      ...map,
      cards: [{ title: "No color", activity: "Browse", slice: "Walking skeleton", tags: [] }],
    };
    const card = flatten(buildBoardScene(computeBoardLayout(colorless))).find(
      (s) => s.class === "sm-board-card" && s.tag === "rect",
    );
    expect(card?.attrs.fill).toBe("var(--background-secondary)");
  });

  it("escapes nothing into attributes that aren't strings/numbers", () => {
    for (const spec of flatten(scene())) {
      for (const v of Object.values(spec.attrs)) {
        expect(["string", "number"]).toContain(typeof v);
      }
    }
  });

  it("tags activity and slice headers with their index for drag-reorder", () => {
    const specs = buildBoardScene(computeBoardLayout(map));
    const activity = specs.find((s) => s.class === "sm-board-activity");
    const slice = specs.find((s) => s.class === "sm-board-slice");
    expect(activity?.attrs["data-activity-index"]).toBe(0);
    expect(slice?.attrs["data-slice-index"]).toBe(0);
  });

  it("emits add-affordances for activity, slice, and step, and tags step headers", () => {
    const specs = buildBoardScene(computeBoardLayout(map));
    const adds = specs
      .map((s) => s.attrs["data-add"])
      .filter((v): v is string => typeof v === "string");
    expect(adds).toContain("activity");
    expect(adds).toContain("slice");
    expect(adds).toContain("step"); // one per activity
    // "Browse" has no steps → its single column is the no-step column: it carries
    // the activity but no step attr.
    const step = specs.find((s) => s.class === "sm-board-step");
    expect(step?.attrs["data-activity"]).toBe("Browse");
    expect(step?.attrs["data-step"]).toBeUndefined();
  });

  it("emits remove affordances for activity, slice, step, and card", () => {
    // The shared fixture has no declared step, so a declared-step column (which
    // alone carries a `data-remove="step"` affordance) only exists when a step is
    // present; use a stepped map here to exercise all four remove kinds.
    const stepped: StoryMap = {
      ...map,
      steps: [{ activity: "Browse", step: "Search" }],
      cards: [
        { title: "C", activity: "Browse", step: "Search", slice: "Walking skeleton", tags: [] },
      ],
    };
    const specs = flatten(buildBoardScene(computeBoardLayout(stepped)));
    const removes = specs
      .map((s) => s.attrs["data-remove"])
      .filter((v): v is string => typeof v === "string");
    expect(removes).toContain("activity");
    expect(removes).toContain("slice");
    expect(removes).toContain("step");
    expect(removes).toContain("card");
  });

  it("emits an add-card affordance tagged with the cell coordinate", () => {
    const specs = buildBoardScene(computeBoardLayout(map));
    const addCard = specs.find((s) => s.attrs["data-add"] === "card");
    expect(addCard?.attrs["data-activity"]).toBe("Browse");
    expect(addCard?.attrs["data-slice"]).toBe("Walking skeleton");
  });

  it("emits a color swatch and a status chip per card, tagged with the card index", () => {
    const specs = flatten(buildBoardScene(computeBoardLayout(map)));
    const swatch = specs.find((s) => s.class === "sm-board-swatch");
    expect(swatch?.attrs["data-color-index"]).toBe(0);
    const chip = specs.find((s) => s.class === "sm-board-status-chip");
    expect(chip?.attrs["data-status-index"]).toBe(0);
  });

  it("wraps each card in a group with a child rect and tooltip-bearing controls", () => {
    const specs = buildBoardScene(computeBoardLayout(map));
    const cardGroup = specs.find(
      (s) => s.class === "sm-board-card-group" && s.attrs["data-card-index"] === 0,
    );
    expect(cardGroup?.tag).toBe("g");
    const children = cardGroup?.children ?? [];
    expect(children.some((c) => c.class === "sm-board-card" && c.tag === "rect")).toBe(true);
    const tooltipText = (cls: string): string | undefined =>
      children.find((c) => c.class === cls)?.children?.find((t) => t.tag === "title")?.text;
    expect(tooltipText("sm-board-remove")).toBe("Remove card");
    expect(tooltipText("sm-board-swatch")).toBe("Cycle color");
    expect(tooltipText("sm-board-status-chip")).toBe("Cycle status");
  });

  it("renders an empty-state hint only when the map has no cards", () => {
    const withCard = flatten(buildBoardScene(computeBoardLayout(map))).find(
      (s) => s.class === "sm-board-empty",
    );
    expect(withCard).toBeUndefined(); // the shared fixture has a card

    const empty: StoryMap = { ...map, cards: [] };
    const hint = flatten(buildBoardScene(computeBoardLayout(empty))).find(
      (s) => s.class === "sm-board-empty",
    );
    expect(hint?.text).toContain("No cards yet");
  });

  it("keeps every rendered rect inside the canvas bounds (controls don't escape the viewBox)", () => {
    // A two-activity, stepped map exercises the add-activity (right margin),
    // add-slice (bottom margin), and per-activity add-step controls together.
    const stepped: StoryMap = {
      ...map,
      activities: ["Browse", "Order"],
      steps: [{ activity: "Browse", step: "Search" }],
      cards: [
        { title: "C", activity: "Browse", step: "Search", slice: "Walking skeleton", tags: [] },
      ],
    };
    const layout = computeBoardLayout(stepped);
    for (const s of flatten(buildBoardScene(layout))) {
      if (s.tag !== "rect") continue;
      const x = Number(s.attrs.x);
      const y = Number(s.attrs.y);
      const w = Number(s.attrs.width);
      const h = Number(s.attrs.height);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(layout.width);
      expect(y + h).toBeLessThanOrEqual(layout.height);
    }
  });
});

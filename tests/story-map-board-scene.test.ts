import { describe, expect, it } from "vitest";
import { buildBoardScene, type SvgNodeSpec } from "../src/presentation/views/story-map-board-scene";
import { computeBoardLayout } from "../src/presentation/views/story-map-board-layout";
import type { StoryMap } from "../src/domain/entities/story-map";
import { CARD_TYPES, CARD_TYPE_COLORS } from "../src/domain/entities/story-map-card";
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

  it("renders the card title + ref badge and carries its color + cardIndex", () => {
    const card = flatten(scene()).find((s) => s.class === "sm-board-card" && s.tag === "rect");
    expect(card?.attrs.fill).toBe("#93c5fd");
    expect(card?.attrs["data-card-index"]).toBe(0);
    const text = flatten(scene()).find((s) => s.class === "sm-board-card-title");
    expect(text?.text).toContain("Filter");
    const ref = flatten(scene()).find((s) => s.class === "sm-board-card-ref");
    expect(ref?.text).toContain("UC-001");
  });

  it("emits a points chip and one tag chip per tag along the card footer", () => {
    const points = flatten(scene()).filter((s) => s.class === "sm-board-chip-points");
    expect(points).toHaveLength(1);
    const pointsLabel = flatten(scene()).find((s) => s.class === "sm-board-chip-points-label");
    expect(pointsLabel?.text).toBe("3");
    const tags = flatten(scene()).filter(
      (s) => s.class === "sm-board-chip-tag" && s.tag === "rect",
    );
    expect(tags).toHaveLength(1); // one tag: "x"
  });

  it("omits the points chip for a card with no points but still emits its tag chips", () => {
    const noPoints: StoryMap = {
      ...map,
      cards: [
        {
          title: "T",
          activity: "Browse",
          slice: "Walking skeleton",
          tags: ["a", "b"],
          color: "#fff",
        },
      ],
    };
    const flat = flatten(buildBoardScene(computeBoardLayout(noPoints)));
    expect(flat.filter((s) => s.class === "sm-board-chip-points")).toHaveLength(0);
    expect(flat.filter((s) => s.class === "sm-board-chip-tag" && s.tag === "rect")).toHaveLength(2);
  });

  it("uses the typed card colour as the card rect fill for an override-less card", () => {
    const typed: StoryMap = {
      ...map,
      cards: [
        {
          title: "Typed",
          activity: "Browse",
          slice: "Walking skeleton",
          cardType: "note",
          tags: [],
        },
      ],
    };
    const card = flatten(buildBoardScene(computeBoardLayout(typed))).find(
      (s) => s.class === "sm-board-card" && s.tag === "rect",
    );
    expect(card?.attrs.fill).toBe("var(--sm-card-note, #7ed6df)");
  });

  it("falls back to the default-type (task) fill for a card with no color or type", () => {
    const colorless: StoryMap = {
      ...map,
      cards: [{ title: "No color", activity: "Browse", slice: "Walking skeleton", tags: [] }],
    };
    const card = flatten(buildBoardScene(computeBoardLayout(colorless))).find(
      (s) => s.class === "sm-board-card" && s.tag === "rect",
    );
    expect(card?.attrs.fill).toBe("var(--sm-card-task, #f6e58d)");
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

  it("emits an edit-details control per card, tagged with the card index + a tooltip", () => {
    const specs = buildBoardScene(computeBoardLayout(map));
    const cardGroup = specs.find(
      (s) => s.class === "sm-board-card-group" && s.attrs["data-card-index"] === 0,
    );
    const children = cardGroup?.children ?? [];
    const edit = children.find((c) => c.class === "sm-board-edit" && c.tag === "rect");
    expect(edit?.attrs["data-edit"]).toBe("card");
    expect(edit?.attrs["data-card-index"]).toBe(0);
    expect(edit?.children?.find((t) => t.tag === "title")?.text).toBe("Edit details");
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

  it("emits one persona card per user (× remove + double-click rename) and a + user add", () => {
    const audience: StoryMap = { ...map, users: ["Designer", "Developer"] };
    const specs = flatten(buildBoardScene(computeBoardLayout(audience)));

    const cards = specs.filter((s) => s.class === "sm-board-user-card" && s.tag === "rect");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.attrs["data-user-index"]).toBe(0);
    expect(cards[0]?.attrs["aria-label"]).toBe("User: Designer");
    expect(cards[1]?.attrs["data-user-index"]).toBe(1);
    expect(cards[1]?.attrs["aria-label"]).toBe("User: Developer");

    const labels = specs.filter((s) => s.class === "sm-board-user-label").map((s) => s.text);
    expect(labels).toEqual(["Designer", "Developer"]);

    const removes = specs.filter((s) => s.attrs["data-remove"] === "user" && s.tag === "rect");
    expect(removes.map((s) => s.attrs["data-user-index"])).toEqual([0, 1]);

    const addUser = specs.find((s) => s.class === "sm-board-add-user" && s.tag === "rect");
    expect(addUser?.attrs["data-add"]).toBe("user");
  });

  it("renders a progress label and points label on each slice row header", () => {
    const progress: StoryMap = {
      ...map,
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
    };
    const specs = flatten(buildBoardScene(computeBoardLayout(progress)));
    const prog = specs.find((s) => s.class === "sm-board-slice-progress");
    expect(prog?.text).toBe("1/2");
    const pts = specs.find((s) => s.class === "sm-board-slice-points");
    expect(pts?.text).toBe("8 pts");
  });

  it("emits a legend group with one swatch per card type whose fill matches CARD_TYPE_COLORS", () => {
    const specs = flatten(buildBoardScene(computeBoardLayout(map)));
    const legend = specs.find((s) => s.class === "sm-board-legend" && s.tag === "g");
    expect(legend).toBeDefined();
    const swatches = specs.filter((s) => s.class === "sm-board-legend-swatch" && s.tag === "rect");
    expect(swatches).toHaveLength(CARD_TYPES.length);
    expect(swatches.map((s) => s.attrs.fill)).toEqual(CARD_TYPES.map((t) => CARD_TYPE_COLORS[t]));
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

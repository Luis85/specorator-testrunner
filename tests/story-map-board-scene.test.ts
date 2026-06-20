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

  it("falls back to a themed fill for a card with no color", () => {
    const colorless: StoryMap = {
      ...map,
      cards: [{ title: "No color", activity: "Browse", slice: "Walking skeleton", tags: [] }],
    };
    const card = buildBoardScene(computeBoardLayout(colorless)).find(
      (s) => s.class === "sm-board-card" && s.tag === "rect",
    );
    expect(card?.attrs.fill).toBe("var(--background-secondary)");
  });

  it("escapes nothing into attributes that aren't strings/numbers", () => {
    for (const spec of scene()) {
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
});

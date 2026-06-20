import { describe, expect, it } from "vitest";
import {
  buildCardFromForm,
  cardToForm,
  initialCardForm,
  statusOptions,
  stepOptionsFor,
} from "../src/application/services/story-map-card-form";
import type { StoryMap, StoryMapCard } from "../src/domain/entities/story-map";

const map: Pick<StoryMap, "activities" | "slices" | "steps"> = {
  activities: ["Author spec", "Run tests"],
  slices: ["Walking skeleton", "Next"],
  steps: [
    { activity: "Author spec", step: "Draft" },
    { activity: "Author spec", step: "Review" },
  ],
};

describe("initialCardForm", () => {
  it("defaults to the first activity and slice with empty optionals", () => {
    expect(initialCardForm(map)).toEqual({
      activity: "Author spec",
      step: "",
      slice: "Walking skeleton",
      ref: "",
      title: "",
      status: "",
      points: "",
      tags: "",
      color: "",
      cardType: "task",
    });
  });

  it("falls back to empty strings when the map has no axes", () => {
    const empty = initialCardForm({ activities: [], slices: [] });
    expect(empty.activity).toBe("");
    expect(empty.slice).toBe("");
  });
});

describe("cardToForm / buildCardFromForm round-trip", () => {
  it("reproduces a fully-populated card through the form", () => {
    const original: StoryMapCard = {
      ref: "UC-013",
      title: "Configure the SUT",
      activity: "Author spec",
      step: "Draft",
      slice: "Walking skeleton",
      status: "in-progress",
      points: 3,
      tags: ["auth", "infra"],
      color: "blue",
      cardType: "note",
    };
    expect(buildCardFromForm(cardToForm(original))).toEqual(original);
  });

  it("reproduces a sparse reference-less card (defaulting its type to task)", () => {
    const original: StoryMapCard = {
      title: "Spike: choose a parser",
      activity: "Run tests",
      slice: "Next",
      tags: ["spike"],
    };
    // A card with no explicit type round-trips to the default "task" type.
    expect(buildCardFromForm(cardToForm(original))).toEqual({ ...original, cardType: "task" });
  });

  it("round-trips a non-default card type through the form", () => {
    const original: StoryMapCard = {
      title: "Open question",
      activity: "Author spec",
      slice: "Next",
      tags: [],
      cardType: "question",
    };
    const form = cardToForm(original);
    expect(form.cardType).toBe("question");
    expect(buildCardFromForm(form)).toEqual(original);
  });
});

describe("buildCardFromForm", () => {
  it("drops blank optionals and trims fields", () => {
    const card = buildCardFromForm({
      activity: "Author spec",
      step: "",
      slice: "Next",
      ref: "  ",
      title: "  Title  ",
      status: "",
      points: "",
      tags: " a ,  , b ",
      color: "  ",
      cardType: "",
    });
    expect(card).toEqual({
      title: "Title",
      activity: "Author spec",
      slice: "Next",
      tags: ["a", "b"],
      cardType: "task",
    });
    expect(card.ref).toBeUndefined();
    expect(card.step).toBeUndefined();
    expect(card.points).toBeUndefined();
    expect(card.color).toBeUndefined();
  });

  it("parses points and keeps a known status, dropping an unknown one", () => {
    expect(buildCardFromForm(form({ points: "5", status: "done" }))).toMatchObject({
      points: 5,
      status: "done",
    });
    expect(buildCardFromForm(form({ status: "bogus" })).status).toBeUndefined();
  });

  it("yields NaN points for non-numeric input so the validator can reject it", () => {
    expect(buildCardFromForm(form({ points: "abc" })).points).toBeNaN();
  });

  it("keeps a fractional value intact (1.5, not truncated to 1) so the validator can reject it", () => {
    expect(buildCardFromForm(form({ points: "1.5" })).points).toBe(1.5);
  });

  it("keeps a known card type and defaults a blank/invalid one to task", () => {
    expect(buildCardFromForm(form({ cardType: "edge-case" })).cardType).toBe("edge-case");
    expect(buildCardFromForm(form({ cardType: "" })).cardType).toBe("task");
    expect(buildCardFromForm(form({ cardType: "bogus" })).cardType).toBe("task");
  });
});

describe("stepOptionsFor / statusOptions", () => {
  it("lists only the chosen activity's steps in order", () => {
    expect(stepOptionsFor(map, "Author spec")).toEqual(["Draft", "Review"]);
    expect(stepOptionsFor(map, "Run tests")).toEqual([]);
  });

  it("exposes the four planning statuses", () => {
    expect(statusOptions()).toEqual(["planned", "in-progress", "done", "blocked"]);
  });
});

const form = (overrides: Partial<Parameters<typeof buildCardFromForm>[0]> = {}) => ({
  activity: "Author spec",
  step: "",
  slice: "Walking skeleton",
  ref: "",
  title: "T",
  status: "",
  points: "",
  tags: "",
  color: "",
  cardType: "task",
  ...overrides,
});

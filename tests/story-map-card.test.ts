import { describe, it, expect } from "vitest";
import {
  nextStoryMapCardId,
  isCardType,
  cardColor,
  cardTypeLabel,
  CARD_TYPES,
  CARD_TYPE_COLORS,
} from "../src/domain/entities/story-map-card";

describe("nextStoryMapCardId", () => {
  it("starts at SMC-001 and increments past the max", () => {
    expect(nextStoryMapCardId([])).toBe("SMC-001");
    expect(nextStoryMapCardId([{ id: "SMC-001" }, { id: "SMC-004" }])).toBe("SMC-005");
  });
});

describe("cardTypeLabel", () => {
  it("capitalises a single-word type", () => {
    expect(cardTypeLabel("task")).toBe("Task");
    expect(cardTypeLabel("design")).toBe("Design");
  });

  it("spaces and sentence-cases a hyphenated type", () => {
    expect(cardTypeLabel("edge-case")).toBe("Edge case");
  });

  it("labels every declared card type without leaving a hyphen", () => {
    for (const type of CARD_TYPES) {
      const label = cardTypeLabel(type);
      expect(label).not.toContain("-");
      expect(label[0]).toBe(label[0]?.toUpperCase());
    }
  });
});

describe("isCardType", () => {
  it("accepts the five legend types only", () => {
    expect(CARD_TYPES).toEqual(["task", "note", "question", "edge-case", "design"]);
    expect(isCardType("task")).toBe(true);
    expect(isCardType("epic")).toBe(false);
  });
});

describe("cardColor", () => {
  it("derives colour from card_type", () => {
    expect(cardColor({ cardType: "note", color: undefined })).toBe(CARD_TYPE_COLORS.note);
  });
  it("honours an explicit colour override", () => {
    expect(cardColor({ cardType: "task", color: "#abcdef" })).toBe("#abcdef");
  });
  it("ignores a blank override and falls back to the type colour", () => {
    expect(cardColor({ cardType: "design", color: "   " })).toBe(CARD_TYPE_COLORS.design);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildStoryMapNote,
  cardAttributeSuffix,
  GRID_BLOCK_END,
  GRID_BLOCK_START,
  PRODUCT_BLOCK_END,
  PRODUCT_BLOCK_START,
  renderActivityTable,
  renderLegend,
  renderPointsRollup,
  renderProductParagraph,
  parseStoryMapNote,
  renderStoryMapGridTable,
  renderUsersLane,
  replaceGridBlock,
  replaceProductBlock,
  replaceStoryMapHeading,
  storyMapFolderName,
} from "../src/application/content/story-map-content";
import type { StoryMap } from "../src/domain/entities/story-map";
import { parseNote } from "../src/shared/utils/frontmatter";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const map: StoryMap = {
  id: "SM-001",
  title: "Authoring journey",
  status: "draft",
  product: "PRD-000",
  users: ["Test author", "Reviewer"],
  activities: ["Author spec", "Run tests"],
  steps: [{ activity: "Author spec", step: "Draft" }],
  slices: ["Walking skeleton", "Next"],
  cards: [
    {
      ref: "UC-037",
      title: "Author a Use Case",
      activity: "Author spec",
      step: "Draft",
      slice: "Walking skeleton",
      status: "planned",
      points: 3,
      tags: ["auth"],
    },
    { ref: "UC-011", title: "UC-011", activity: "Run tests", slice: "Walking skeleton", tags: [] },
  ],
  displayOrder: 0,
  path: unsafeVaultPath("Story Maps/SM-001-authoring-journey/SM-001-authoring-journey.md"),
};

describe("storyMapFolderName", () => {
  it("kebab-cases the id + title, falling back to the id for an empty title", () => {
    expect(storyMapFolderName("SM-001", "Authoring Journey!")).toBe("SM-001-authoring-journey");
    expect(storyMapFolderName("SM-002", "   ")).toBe("SM-002");
  });
});

describe("cardAttributeSuffix", () => {
  it("renders status, points, and tags compactly with `·` separators", () => {
    expect(
      cardAttributeSuffix({
        title: "T",
        activity: "A",
        slice: "S",
        status: "planned",
        points: 3,
        tags: ["x"],
      }),
    ).toBe(" · planned · 3pts · #x");
  });

  it("is empty for a card with no planning attributes", () => {
    expect(cardAttributeSuffix({ title: "T", activity: "A", slice: "S", tags: [] })).toBe("");
  });

  it("surfaces a non-default card type ahead of the other attributes", () => {
    expect(
      cardAttributeSuffix({
        title: "T",
        activity: "A",
        slice: "S",
        cardType: "question",
        status: "planned",
        tags: [],
      }),
    ).toBe(" · question · planned");
  });

  it("omits the card type for the default `task`", () => {
    expect(
      cardAttributeSuffix({ title: "T", activity: "A", slice: "S", cardType: "task", tags: [] }),
    ).toBe("");
  });
});

describe("renderActivityTable", () => {
  it("renders a step-columned table with resolved, pipe-escaped UC links and attributes", () => {
    const names = new Map([["UC-037", "UC-037 Author a Use Case"]]);
    const table = renderActivityTable(map, "Author spec", names);
    expect(table).toContain("### Author spec");
    expect(table).toContain("| Slice ↓ / Step → | Draft |");
    expect(table).toContain("[[UC-037 Author a Use Case\\|UC-037]]");
    expect(table).toContain("· planned · 3pts · #auth");
  });

  it("renders a single no-step column for a stepless activity", () => {
    const names = new Map<string, string>();
    const table = renderActivityTable(map, "Run tests", names);
    expect(table).toContain("(no step)");
    // The unresolved id falls back to a bare wikilink.
    expect(table).toContain("[[UC-011]]");
  });
});

describe("renderPointsRollup / renderLegend", () => {
  it("rolls up points per slice with a total row", () => {
    const rollup = renderPointsRollup(map);
    expect(rollup).toContain("| Walking skeleton | 3 |");
    expect(rollup).toContain("| Next | 0 |");
    expect(rollup).toContain("| **Total** | **3** |");
  });

  it("lists the four planning statuses in the legend", () => {
    const legend = renderLegend();
    expect(legend).toContain("planned · in-progress · done · blocked");
  });

  it("lists the card types in the legend", () => {
    expect(renderLegend()).toContain("Card type: task · note · question · edge-case · design");
  });
});

describe("renderUsersLane", () => {
  it("renders the personas lane, and nothing when there are no users", () => {
    expect(renderUsersLane(map)).toBe("**Users:** Test author · Reviewer");
    expect(renderUsersLane({ ...map, users: [] })).toBe("");
  });
});

describe("renderStoryMapGridTable", () => {
  it("includes the users lane above the activity sub-tables when users exist", () => {
    expect(renderStoryMapGridTable(map, new Map())).toContain("**Users:** Test author · Reviewer");
  });

  it("renders a sub-section per activity plus the roll-up and legend", () => {
    const table = renderStoryMapGridTable(map, new Map());
    expect(table).toContain("### Author spec");
    expect(table).toContain("### Run tests");
    expect(table).toContain("#### Points roll-up");
    expect(table).toContain("#### Legend");
  });

  it("renders a guidance line when there is no backbone yet", () => {
    const table = renderStoryMapGridTable({ ...map, activities: [], cards: [] }, new Map());
    expect(table).toContain("No activities yet");
  });
});

describe("buildStoryMapNote", () => {
  it("serializes parser-safe frontmatter (users, steps) and a grid block, with NO cards frontmatter", () => {
    const note = buildStoryMapNote(map, new Map());
    const { frontmatter } = parseNote(note);

    expect(frontmatter.type).toBe("story-map");
    expect(frontmatter.id).toBe("SM-001");
    expect(frontmatter.product).toBe("PRD-000");
    expect(frontmatter.users).toEqual(["Test author", "Reviewer"]);
    expect(frontmatter.activities).toEqual(["Author spec", "Run tests"]);
    expect(frontmatter.steps).toEqual(["Author spec | Draft"]);
    expect(frontmatter.slices).toEqual(["Walking skeleton", "Next"]);
    // Cards live as their own notes under `cards/` — never in the map frontmatter.
    expect(frontmatter.cards).toBeUndefined();
    expect(note).not.toContain("\ncards:");
    // The body no longer documents the nine-field inline card scalar.
    expect(note).not.toContain("status\n> | points");
    expect(note).toContain("Cards live as notes under `cards/`");
    // The managed grid still renders from the in-memory cards.
    expect(note).toContain(GRID_BLOCK_START);
    expect(note).toContain(GRID_BLOCK_END);
    expect(note).toContain("Author a Use Case");
  });

  it("omits users and steps from frontmatter when empty", () => {
    const note = buildStoryMapNote({ ...map, users: [], steps: [] }, new Map());
    const { frontmatter } = parseNote(note);
    expect(frontmatter.users).toBeUndefined();
    expect(frontmatter.steps).toBeUndefined();
  });

  it("renders the product as a resolved (unescaped) inline link in the body", () => {
    const note = buildStoryMapNote(map, new Map([["PRD-000", "PRD-000 Product Vision"]]));
    expect(note).toContain("[[PRD-000 Product Vision|PRD-000]]");
  });

  it("falls back to a bare product link when the PRD note name is unresolved", () => {
    const note = buildStoryMapNote(map, new Map());
    expect(note).toContain("[[PRD-000]]");
  });

  it("wraps the product paragraph in managed markers so it can be refreshed", () => {
    const note = buildStoryMapNote(map, new Map());
    expect(note).toContain(PRODUCT_BLOCK_START);
    expect(note).toContain(PRODUCT_BLOCK_END);
  });
});

describe("replaceProductBlock", () => {
  const paragraph = renderProductParagraph("PRD-002", new Map([["PRD-002", "PRD-002 New"]]));

  it("replaces the marked product block, leaving other body sections", () => {
    const body = [
      "# SM-001: J",
      "",
      PRODUCT_BLOCK_START,
      "Story map for [[PRD-001 Old|PRD-001]] — …",
      PRODUCT_BLOCK_END,
      "",
      "## Notes",
      "hand-written",
    ].join("\n");
    const next = replaceProductBlock(body, paragraph);
    expect(next).toContain("[[PRD-002 New|PRD-002]]");
    expect(next).not.toContain("PRD-001");
    expect(next).toContain("hand-written");
  });

  it("upgrades a legacy unmarked `Story map for …` line in place", () => {
    const body = "# SM-001: J\n\nStory map for [[PRD-001]] — old.\n\n## Notes\n";
    const next = replaceProductBlock(body, paragraph);
    expect(next).toContain(PRODUCT_BLOCK_START);
    expect(next).toContain("[[PRD-002 New|PRD-002]]");
    expect(next).not.toContain("PRD-001");
  });

  it("leaves the body untouched when no product paragraph is present", () => {
    const body = "# SM-001: J\n\n## Notes\nhand-written\n";
    expect(replaceProductBlock(body, paragraph)).toBe(body);
  });

  it("writes $-tokens in the new paragraph literally", () => {
    // A resolved PRD note name containing $& must not be expanded as a pattern.
    const dollarParagraph = renderProductParagraph(
      "PRD-002",
      new Map([["PRD-002", "PRD-002 $& Co"]]),
    );
    const body = [PRODUCT_BLOCK_START, "Story map for [[PRD-001]] — …", PRODUCT_BLOCK_END].join(
      "\n",
    );
    expect(replaceProductBlock(body, dollarParagraph)).toContain("[[PRD-002 $& Co|PRD-002]]");
  });
});

describe("parseStoryMapNote", () => {
  it("dedupes hand-edited duplicate axes so the grid + roll-up don't double-count", () => {
    const note = [
      "---",
      "id: SM-001",
      "type: story-map",
      "title: J",
      "activities:",
      "  - Author spec",
      "  - Author spec",
      "slices:",
      "  - Walking skeleton",
      "  - Walking skeleton",
      "steps:",
      "  - Author spec | Draft",
      "  - Author spec | Draft",
      "---",
      "",
    ].join("\n");
    const map = parseStoryMapNote(note, unsafeVaultPath("Story Maps/SM-001/SM-001.md"));
    expect(map?.activities).toEqual(["Author spec"]);
    expect(map?.slices).toEqual(["Walking skeleton"]);
    expect(map?.steps).toEqual([{ activity: "Author spec", step: "Draft" }]);
  });

  it("returns empty cards — cards are composed from the per-card notes, not the frontmatter", () => {
    const note = [
      "---",
      "id: SM-001",
      "type: story-map",
      "title: J",
      "activities:",
      "  - Author spec",
      "slices:",
      "  - Walking skeleton",
      // A stale hand-edited inline `cards:` key must NOT leak into the read model.
      "cards:",
      "  - UC-037 | Author spec | Walking skeleton",
      "---",
      "",
    ].join("\n");
    const map = parseStoryMapNote(note, unsafeVaultPath("Story Maps/SM-001/SM-001.md"));
    expect(map?.cards).toEqual([]);
  });
});

describe("replaceGridBlock", () => {
  it("replaces only the managed block, preserving other body sections", () => {
    const body = [
      "## Map",
      "",
      GRID_BLOCK_START,
      "old table",
      GRID_BLOCK_END,
      "",
      "## Notes",
      "hand-written",
    ].join("\n");

    const next = replaceGridBlock(body, "new table");
    expect(next).toContain("new table");
    expect(next).not.toContain("old table");
    expect(next).toContain("## Notes");
    expect(next).toContain("hand-written");
  });

  it("appends a fresh block when the markers are absent", () => {
    const next = replaceGridBlock("## Map\n\nno markers here", "fresh table");
    expect(next).toContain(GRID_BLOCK_START);
    expect(next).toContain("fresh table");
  });

  it("writes $-tokens in the new table literally (no replacement-pattern expansion)", () => {
    const body = [GRID_BLOCK_START, "old", GRID_BLOCK_END].join("\n");
    // A card title / resolved note name containing $&, $$, $` and $' must survive
    // verbatim — a string replacement would expand these into the matched text.
    const next = replaceGridBlock(body, "cost is $$5 for $& and $` and $'");
    expect(next).toContain("cost is $$5 for $& and $` and $'");
    expect(next).not.toContain("old");
  });
});

describe("replaceStoryMapHeading", () => {
  it("rewrites the title heading by its id prefix, leaving other headings and body untouched", () => {
    const body = [
      "# SM-001: Old",
      "",
      "## Notes",
      "# A hand-written heading",
      "Some prose mentioning SM-001 inline.",
    ].join("\n");
    const next = replaceStoryMapHeading(body, "SM-001", "New title");
    expect(next).toContain("# SM-001: New title");
    expect(next).not.toContain("# SM-001: Old");
    expect(next).toContain("## Notes");
    expect(next).toContain("# A hand-written heading");
    expect(next).toContain("Some prose mentioning SM-001 inline.");
  });

  it("returns the body unchanged when no matching heading is present", () => {
    const body = "## Notes\nhand-written, the title heading was removed by hand\n";
    expect(replaceStoryMapHeading(body, "SM-001", "New title")).toBe(body);
  });

  it("writes $-tokens in the new title literally", () => {
    const next = replaceStoryMapHeading("# SM-001: Old", "SM-001", "Pay $& earn $$");
    expect(next).toBe("# SM-001: Pay $& earn $$");
  });
});

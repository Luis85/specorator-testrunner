import { describe, expect, it } from "vitest";
import {
  buildStoryMapNote,
  GRID_BLOCK_END,
  GRID_BLOCK_START,
  renderStoryMapGridTable,
  replaceGridBlock,
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
  activities: ["Author spec", "Run tests"],
  slices: ["Walking skeleton", "Next"],
  cards: [
    { ucId: "UC-037", activity: "Author spec", slice: "Walking skeleton" },
    { ucId: "UC-011", activity: "Run tests", slice: "Walking skeleton" },
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

describe("renderStoryMapGridTable", () => {
  it("renders resolved, aliased, pipe-escaped UC links so cells never dangle", () => {
    const names = new Map([
      ["UC-037", "UC-037 Author a Use Case"],
      // UC-011 deliberately unresolved → falls back to a bare link.
    ]);
    const table = renderStoryMapGridTable(map, names);

    // Header + divider + one row per slice.
    expect(table).toContain("| Slice ↓ / Activity → | Author spec | Run tests |");
    // Resolved link uses the escaped-pipe alias so it survives the Markdown table.
    expect(table).toContain("[[UC-037 Author a Use Case\\|UC-037]]");
    // Unresolved id falls back to the bare wikilink.
    expect(table).toContain("[[UC-011]]");
    expect(table).toContain("| **Walking skeleton** |");
    expect(table).toContain("| **Next** |  |  |");
  });

  it("renders a guidance line when there is no backbone yet", () => {
    const table = renderStoryMapGridTable({ ...map, activities: [], cards: [] }, new Map());
    expect(table).toContain("No activities yet");
  });
});

describe("buildStoryMapNote", () => {
  it("serializes parser-safe frontmatter and a managed grid block", () => {
    const note = buildStoryMapNote(map, new Map());
    const { frontmatter } = parseNote(note);

    expect(frontmatter.type).toBe("story-map");
    expect(frontmatter.id).toBe("SM-001");
    expect(frontmatter.product).toBe("PRD-000");
    expect(frontmatter.activities).toEqual(["Author spec", "Run tests"]);
    expect(frontmatter.slices).toEqual(["Walking skeleton", "Next"]);
    expect(frontmatter.cards).toEqual([
      "UC-037 | Author spec | Walking skeleton",
      "UC-011 | Run tests | Walking skeleton",
    ]);
    expect(note).toContain(GRID_BLOCK_START);
    expect(note).toContain(GRID_BLOCK_END);
  });

  it("renders the product as a resolved (unescaped) inline link in the body", () => {
    const note = buildStoryMapNote(map, new Map([["PRD-000", "PRD-000 Product Vision"]]));
    // Body paragraph is not a table, so the alias pipe is NOT escaped here.
    expect(note).toContain("[[PRD-000 Product Vision|PRD-000]]");
  });

  it("falls back to a bare product link when the PRD note name is unresolved", () => {
    const note = buildStoryMapNote(map, new Map());
    expect(note).toContain("[[PRD-000]]");
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
});

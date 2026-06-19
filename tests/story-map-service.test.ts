import { describe, expect, it } from "vitest";
import { DefaultStoryMapService } from "../src/application/services/story-map-service";
import type { PrdGuard } from "../src/application/services/story-map-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";
import { ok, type Result } from "../src/shared/result/result";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

/**
 * Resolver that maps a fixed id → note path so links resolve in tests. Includes a
 * passthrough `withMutationLock` so it also satisfies {@link PrdGuard} when used
 * as the PRD dependency (tests don't exercise cross-service lock contention).
 */
const resolver = (paths: Record<string, string> = {}): PrdGuard => ({
  async findById(id: string): Promise<Result<{ path: VaultPath } | null>> {
    const path = paths[id];
    return ok(path ? { path: unsafeVaultPath(path) } : null);
  },
  withMutationLock: (operation) => operation(),
});

/** The default PRD set resolves the root PRD-000 (most create tests anchor there). */
const ROOT_PRD = { "PRD-000": "PRDs/PRD-000-product-vision/PRD-000-product-vision.md" };

const build = (ucPaths?: Record<string, string>, prdPaths: Record<string, string> = ROOT_PRD) => {
  const fs = new FakeVaultFileSystem();
  const { bus, types, events } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultStoryMapService(
    settings,
    fs,
    bus,
    silentLogger,
    resolver(ucPaths),
    resolver(prdPaths),
  );
  return { service, fs, types, events };
};

describe("DefaultStoryMapService.create", () => {
  it("creates a folder + note and emits storymap.created", async () => {
    const { service, fs, types, events } = build();

    const result = await service.create({
      title: "Authoring Journey",
      product: "PRD-000",
      users: ["Test author"],
      activities: ["Author spec", "Run tests"],
      steps: [{ activity: "Author spec", step: "Draft" }],
      slices: ["Walking skeleton", "Next"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("SM-001");
    expect(result.value.path).toBe(
      "Story Maps/SM-001-authoring-journey/SM-001-authoring-journey.md",
    );
    expect(fs.files.has(result.value.path)).toBe(true);

    expect(types()).toContain("storymap.created");
    expect(events.find((e) => e.type === "storymap.created")?.payload).toEqual({
      storyMapId: "SM-001",
      title: "Authoring Journey",
      path: result.value.path,
      product: "PRD-000",
    });
  });

  it("normalizes labels (trims, dedupes, drops the | delimiter) and defaults the product", async () => {
    const { service } = build();
    const result = await service.create({
      title: "Map",
      activities: ["  Author spec  ", "Author spec", "a | b", "  "],
      slices: ["Walking skeleton"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activities).toEqual(["Author spec", "a b"]);
    expect(result.value.product).toBe("PRD-000");
  });

  it("normalizes users and drops steps whose activity is off the backbone", async () => {
    const { service } = build();
    const result = await service.create({
      title: "Map",
      users: ["  Author  ", "Author", "  "],
      activities: ["Author spec"],
      steps: [
        { activity: "Author spec", step: "Draft" },
        { activity: "Author spec", step: "Draft" }, // duplicate dropped
        { activity: "Unknown", step: "Hangs nowhere" }, // off-backbone dropped
      ],
      slices: ["Walking skeleton"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.users).toEqual(["Author"]);
    expect(result.value.steps).toEqual([{ activity: "Author spec", step: "Draft" }]);
  });

  it("rejects a non-root product PRD that does not exist", async () => {
    const { service } = build(); // PRD-007 not known to the resolver
    const result = await service.create({
      title: "Map",
      product: "PRD-007",
      activities: ["a"],
      slices: ["s"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("PRD-007");
  });

  it("allows a non-root product PRD that exists", async () => {
    const { service } = build({}, { "PRD-007": "PRDs/PRD-007-x/PRD-007-x.md" });
    const result = await service.create({
      title: "Map",
      product: "PRD-007",
      activities: ["a"],
      slices: ["s"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects the reserved root PRD-000 when its note does not exist yet (would dangle)", async () => {
    const { service } = build({}, {}); // no PRD notes resolve at all
    const result = await service.create({ title: "Map", activities: ["a"], slices: ["s"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("PRD-000");
  });

  it("anchors to the root PRD-000 once its note exists", async () => {
    const { service } = build(); // ROOT_PRD resolves PRD-000
    const result = await service.create({ title: "Map", activities: ["a"], slices: ["s"] });
    expect(result.ok && result.value.product).toBe("PRD-000");
  });

  it("rejects a map with no activities or no slices", async () => {
    const { service } = build();
    const noActivities = await service.create({ title: "M", activities: [], slices: ["s"] });
    expect(noActivities.ok).toBe(false);
    const noSlices = await service.create({ title: "M", activities: ["a"], slices: [] });
    expect(noSlices.ok).toBe(false);
  });

  it("auto-increments ids past existing maps", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Story Maps/SM-001-x/SM-001-x.md",
      ["---", "id: SM-001", "type: story-map", "title: X", "---", ""].join("\n"),
    );
    const result = await service.create({
      title: "Second",
      activities: ["a"],
      slices: ["s"],
    });
    expect(result.ok && result.value.id).toBe("SM-002");
  });

  it("cleans up a newly created folder when the note write fails", async () => {
    const { service, fs } = build();
    fs.failOn = {
      path: "Story Maps/SM-001-cleanup/SM-001-cleanup.md",
      message: "disk full",
    };
    const result = await service.create({ title: "Cleanup", activities: ["a"], slices: ["s"] });
    expect(result.ok).toBe(false);
    expect([...fs.folders].some((f) => f.startsWith("Story Maps/SM-001"))).toBe(false);
  });
});

describe("DefaultStoryMapService.findAll/parse", () => {
  it("parses users, steps, rich + legacy cards, dropping malformed lines", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Story Maps/SM-001-j/SM-001-j.md",
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: Journey",
        "status: active",
        "product: PRD-000",
        "users:",
        "  - Test author",
        "activities:",
        "  - Author spec",
        "steps:",
        "  - Author spec | Draft",
        "  - bad-step",
        "slices:",
        "  - Walking skeleton",
        "cards:",
        '  - "UC-037 | Author spec | Draft | Walking skeleton | planned | 3 | auth | blue | Author a UC"',
        "  - UC-011 | Author spec | Walking skeleton",
        "  - bad-line",
        "display_order: 0",
        "---",
        "",
      ].join("\n"),
    );

    const result = await service.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = result.value[0];
    expect(map.status).toBe("active");
    expect(map.users).toEqual(["Test author"]);
    expect(map.activities).toEqual(["Author spec"]);
    expect(map.steps).toEqual([{ activity: "Author spec", step: "Draft" }]);
    expect(map.cards).toEqual([
      {
        ref: "UC-037",
        title: "Author a UC",
        activity: "Author spec",
        step: "Draft",
        slice: "Walking skeleton",
        status: "planned",
        points: 3,
        tags: ["auth"],
        color: "blue",
      },
      // The legacy 3-field card still parses (ADR-0027 back-compat).
      {
        ref: "UC-011",
        title: "UC-011",
        activity: "Author spec",
        slice: "Walking skeleton",
        tags: [],
      },
    ]);
  });

  it("drops notes whose type is not story-map", async () => {
    const { service, fs } = build();
    fs.files.set("Story Maps/not-a-map.md", "---\ntype: prd\nid: PRD-000\n---\n");
    const result = await service.findAll();
    expect(result.ok && result.value).toEqual([]);
  });
});

describe("DefaultStoryMapService.deleteStoryMap", () => {
  const seed = (fs: FakeVaultFileSystem) =>
    fs.files.set(
      "Story Maps/SM-001-j/SM-001-j.md",
      ["---", "id: SM-001", "type: story-map", "title: J", "---", ""].join("\n"),
    );

  it("deletes the note, preserves attachments, and emits storymap.deleted", async () => {
    const { service, fs, types, events } = build();
    seed(fs);
    fs.files.set("Story Maps/SM-001-j/diagram.png", "binary");

    const result = await service.deleteStoryMap("SM-001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preservedFiles).toBe(1);
    expect(fs.files.has("Story Maps/SM-001-j/SM-001-j.md")).toBe(false);
    expect(fs.files.has("Story Maps/SM-001-j/diagram.png")).toBe(true);
    expect(types()).toContain("storymap.deleted");
    expect(events.find((e) => e.type === "storymap.deleted")?.payload).toMatchObject({
      storyMapId: "SM-001",
      preservedFiles: 1,
    });
  });

  it("refuses to delete a map that does not exist", async () => {
    const { service } = build();
    const result = await service.deleteStoryMap("SM-404");
    expect(result.ok).toBe(false);
  });
});

describe("DefaultStoryMapService.rebuildGrid", () => {
  it("regenerates the managed grid block with a resolved, pipe-escaped UC link", async () => {
    const { service, fs, types } = build({ "UC-037": "Use Cases/UC-037 Author a Use Case.md" });
    // A hand-edited note: a card was added to the frontmatter, but the body grid
    // block is still empty (the user has not rebuilt yet).
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "product: PRD-000",
        "activities:",
        "  - Author spec",
        "slices:",
        "  - Walking skeleton",
        "cards:",
        "  - UC-037 | Author spec | Walking skeleton",
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
        "",
        "## Notes",
        "keep me",
      ].join("\n"),
    );

    const rebuilt = await service.rebuildGrid("SM-001");
    expect(rebuilt.ok).toBe(true);

    const note = fs.files.get(path) ?? "";
    expect(note).toContain("[[UC-037 Author a Use Case\\|UC-037]]");
    expect(note).not.toContain("(empty)");
    // Hand-written sections survive the managed-block replacement.
    expect(note).toContain("## Notes");
    expect(note).toContain("keep me");
    // The explorer refreshes on this event after a hand-edit + rebuild.
    expect(types()).toContain("storymap.updated");
  });

  it("rebuilds a CRLF note without corrupting the frontmatter boundary", async () => {
    const { service, fs } = build({ "UC-037": "Use Cases/UC-037 Author a Use Case.md" });
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    // A note saved with Windows CRLF line endings.
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "product: PRD-000",
        "activities:",
        "  - Author spec",
        "slices:",
        "  - Walking skeleton",
        "cards:",
        "  - UC-037 | Author spec | Walking skeleton",
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\r\n"),
    );

    const rebuilt = await service.rebuildGrid("SM-001");
    expect(rebuilt.ok).toBe(true);

    const note = fs.files.get(path) ?? "";
    // The frontmatter must not be duplicated or have body text spliced into it.
    expect(note.match(/^---$/gm)?.length).toBe(2);
    expect(note).toContain("[[UC-037 Author a Use Case\\|UC-037]]");
    expect(note).not.toContain("(empty)");
  });

  it("refuses to rebuild a map that does not exist", async () => {
    const { service } = build();
    const result = await service.rebuildGrid("SM-404");
    expect(result.ok).toBe(false);
  });
});

describe("DefaultStoryMapService card authoring (add/update/remove)", () => {
  /** Seeds a hand-edited note with one card and an empty grid block. */
  const seedNote = (fs: FakeVaultFileSystem, lineEnding = "\n"): string => {
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "product: PRD-000",
        "activities:",
        "  - Author spec",
        "steps:",
        "  - Author spec | Draft",
        "slices:",
        "  - Walking skeleton",
        "  - Next",
        "cards:",
        "  - UC-037 | Author spec | Walking skeleton",
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
        "",
        "## Notes",
        "keep me",
      ].join(lineEnding),
    );
    return path;
  };

  it("adds a card: rewrites the cards frontmatter and the grid block, emits storymap.updated", async () => {
    const { service, fs, types } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
    const path = seedNote(fs);

    const result = await service.addCard("SM-001", {
      ref: "UC-040",
      title: "Run the suite",
      activity: "Author spec",
      step: "Draft",
      slice: "Next",
      points: 5,
      tags: ["smoke"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cards).toHaveLength(2);
    // Live views (the explorer) refresh on this event.
    expect(types()).toContain("storymap.updated");

    const note = fs.files.get(path) ?? "";
    // Both cards survive in the frontmatter, the new one fully encoded.
    expect(note).toContain("UC-037 | Author spec |  | Walking skeleton");
    expect(note).toContain("UC-040 | Author spec | Draft | Next |  | 5 | smoke |  | Run the suite");
    // The grid block regenerated with the resolved link; the body is preserved.
    expect(note).toContain("[[UC-040 Run the suite\\|UC-040]]");
    expect(note).not.toContain("(empty)");
    expect(note).toContain("keep me");
  });

  it("rejects a card whose placement is invalid (slice off the map)", async () => {
    const { service, fs } = build();
    seedNote(fs);
    const result = await service.addCard("SM-001", {
      title: "Bad",
      activity: "Author spec",
      slice: "Later",
      tags: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("updates a card at an index", async () => {
    const { service, fs } = build();
    const path = seedNote(fs);
    const result = await service.updateCard("SM-001", 0, {
      title: "Edited story",
      activity: "Author spec",
      slice: "Next",
      tags: [],
    });
    expect(result.ok).toBe(true);
    const note = fs.files.get(path) ?? "";
    expect(note).toContain("Edited story");
    expect(note).not.toContain("UC-037");
  });

  it("removes a card at an index, clearing the cards field when empty", async () => {
    const { service, fs } = build();
    const path = seedNote(fs);
    const result = await service.removeCard("SM-001", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cards).toHaveLength(0);
    const note = fs.files.get(path) ?? "";
    // With no cards left the field is dropped entirely.
    expect(note).not.toContain("cards:");
  });

  it("rejects an out-of-range index for update and remove", async () => {
    const { service, fs } = build();
    seedNote(fs);
    expect(
      (
        await service.updateCard("SM-001", 9, {
          title: "X",
          activity: "Author spec",
          slice: "Next",
          tags: [],
        })
      ).ok,
    ).toBe(false);
    expect((await service.removeCard("SM-001", -1)).ok).toBe(false);
  });

  it("is CRLF-safe: no duplicated frontmatter fence after a card add", async () => {
    const { service, fs } = build({ "UC-040": "Use Cases/UC-040 Run.md" });
    const path = seedNote(fs, "\r\n");
    const result = await service.addCard("SM-001", {
      ref: "UC-040",
      title: "Run",
      activity: "Author spec",
      step: "Draft",
      slice: "Next",
      tags: [],
    });
    expect(result.ok).toBe(true);
    const note = fs.files.get(path) ?? "";
    expect(note.match(/^---$/gm)?.length).toBe(2);
    expect(note).toContain("[[UC-040 Run\\|UC-040]]");
  });

  it("aborts when the map was deleted (re-read under the lock returns null)", async () => {
    const { service } = build();
    const result = await service.addCard("SM-404", {
      title: "X",
      activity: "a",
      slice: "s",
      tags: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("serializes concurrent card adds through the mutation queue", async () => {
    const { service, fs } = build();
    const path = seedNote(fs);
    const [a, b] = await Promise.all([
      service.addCard("SM-001", {
        title: "First",
        activity: "Author spec",
        slice: "Next",
        tags: [],
      }),
      service.addCard("SM-001", {
        title: "Second",
        activity: "Author spec",
        slice: "Next",
        tags: [],
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    // Both writes landed (the second re-read the first's result under the lock),
    // so the final note has all three cards — no lost update.
    const note = fs.files.get(path) ?? "";
    expect(note).toContain("First");
    expect(note).toContain("Second");
    expect(note).toContain("UC-037");
  });
});

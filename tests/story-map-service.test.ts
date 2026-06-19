import { describe, expect, it } from "vitest";
import { DefaultStoryMapService } from "../src/application/services/story-map-service";
import type { NoteResolver } from "../src/application/services/story-map-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";
import { ok, type Result } from "../src/shared/result/result";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

/** Resolver that maps a fixed id → note path so links resolve in tests. */
const resolver = (paths: Record<string, string> = {}): NoteResolver => ({
  async findById(id: string): Promise<Result<{ path: VaultPath } | null>> {
    const path = paths[id];
    return ok(path ? { path: unsafeVaultPath(path) } : null);
  },
});

const build = (ucPaths?: Record<string, string>, prdPaths?: Record<string, string>) => {
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
      activities: ["Author spec", "Run tests"],
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
  it("parses notes, decoding cards and dropping malformed lines", async () => {
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
        "activities:",
        "  - Author spec",
        "slices:",
        "  - Walking skeleton",
        "cards:",
        "  - UC-037 | Author spec | Walking skeleton",
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
    expect(map.activities).toEqual(["Author spec"]);
    expect(map.cards).toEqual([
      { ucId: "UC-037", activity: "Author spec", slice: "Walking skeleton" },
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
    const { service, fs } = build({ "UC-037": "Use Cases/UC-037 Author a Use Case.md" });
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

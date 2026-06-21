import { describe, expect, it } from "vitest";
import { DefaultStoryMapService } from "../src/application/services/story-map-service";
import type { PrdGuard } from "../src/application/services/story-map-service";
import { DefaultPersonaService } from "../src/application/services/persona-service";
import {
  cardSignature,
  moveCard,
  reorderActivity,
  reorderSlice,
  storyMapSignature,
} from "../src/domain/entities/story-map";
import { buildCardNote } from "../src/application/content/story-map-card-content";
import type { StoryMapCardNote } from "../src/domain/entities/story-map-card";
import { appError } from "../src/shared/errors/errors";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";
import { ok, type Result } from "../src/shared/result/result";
import { FakeVaultFileSystem, failReadAt, serviceHarness, silentLogger } from "./fakes";

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
  const { fs, bus, types, events, settings } = serviceHarness();
  // A real PersonaService over the SAME fake fs/settings/bus so the map's
  // persona side-effects (find-or-create per user) land in this fs.
  const personaService = new DefaultPersonaService(settings, fs, bus, silentLogger);
  const service = new DefaultStoryMapService(
    settings,
    fs,
    bus,
    silentLogger,
    resolver(ucPaths),
    resolver(prdPaths),
    personaService,
  );
  return { service, fs, types, events };
};

/**
 * Seeds one card-NOTE under a map's `cards/` folder (cards live as their own
 * notes now, not inline `cards:` frontmatter). `card` carries at least an `id`,
 * the owning `map`, and a placement; tags default to `[]`.
 */
const seedCardNote = (
  fs: FakeVaultFileSystem,
  mapFolder: string,
  card: Partial<StoryMapCardNote> & Pick<StoryMapCardNote, "id" | "map" | "activity" | "slice">,
): void => {
  const note: StoryMapCardNote = {
    cardType: "task",
    tags: [],
    order: 0,
    title: card.id,
    body: "",
    path: unsafeVaultPath(`${mapFolder}/cards/${card.id}.md`),
    step: undefined,
    ...card,
  };
  fs.files.set(`${mapFolder}/cards/${card.id}.md`, buildCardNote(note));
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

  it("validates initial cards against the normalized axes (rejects an off-map placement)", async () => {
    const { service } = build();
    const result = await service.create({
      title: "Map",
      activities: ["Author spec"],
      slices: ["Walking skeleton"],
      cards: [{ title: "X", activity: "Off backbone", slice: "Walking skeleton", tags: [] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("backbone");
  });

  it("accepts a valid initial card placement", async () => {
    const { service } = build();
    const result = await service.create({
      title: "Map",
      activities: ["Author spec"],
      slices: ["Walking skeleton"],
      cards: [
        {
          ref: "UC-001",
          title: "Author",
          activity: "Author spec",
          slice: "Walking skeleton",
          tags: [],
        },
      ],
    });
    expect(result.ok && result.value.cards).toHaveLength(1);
  });

  // The reused folder a failed create cleans up after (the id/path freed by a
  // prior delete that preserved sibling files).
  const ROLLBACK_FOLDER = "Story Maps/SM-001-map";
  const authorCard = (id: string, title: string) => ({
    id,
    title,
    activity: "Author spec",
    slice: "Walking skeleton",
    tags: [] as string[],
  });
  const createMapWith = (
    service: ReturnType<typeof build>["service"],
    cards: ReturnType<typeof authorCard>[],
  ) =>
    service.create({
      title: "Map",
      activities: ["Author spec"],
      slices: ["Walking skeleton"],
      cards,
    });

  it("rolls back the created note (preserving pre-existing files) when an initial card write fails", async () => {
    const { service, fs } = build();
    await fs.createFolder(unsafeVaultPath(ROLLBACK_FOLDER));
    fs.files.set(`${ROLLBACK_FOLDER}/diagram.png`, "binary");
    // Make the initial card-note write fail after the map note is written.
    fs.failOn = { path: `${ROLLBACK_FOLDER}/cards/SMC-001.md`, message: "disk full" };

    const result = await createMapWith(service, [authorCard("SMC-001", "X")]);

    expect(result.ok).toBe(false);
    // The just-created map note is gone (no phantom map), but the pre-existing
    // attachment in the reused folder survives.
    expect(fs.files.has(`${ROLLBACK_FOLDER}/SM-001-map.md`)).toBe(false);
    expect(fs.files.has(`${ROLLBACK_FOLDER}/diagram.png`)).toBe(true);
  });

  it("preserves a pre-existing cards/ folder when an initial card write fails", async () => {
    const { service, fs } = build();
    // The reused folder ALREADY has a cards/ subfolder holding an unrelated note.
    await fs.createFolder(unsafeVaultPath(`${ROLLBACK_FOLDER}/cards`));
    fs.files.set(`${ROLLBACK_FOLDER}/cards/SMC-099.md`, "pre-existing card body");
    fs.failOn = { path: `${ROLLBACK_FOLDER}/cards/SMC-001.md`, message: "disk full" };

    const result = await createMapWith(service, [authorCard("SMC-001", "X")]);

    expect(result.ok).toBe(false);
    // No phantom map note, but the pre-existing card note is NOT recursively wiped.
    expect(fs.files.has(`${ROLLBACK_FOLDER}/SM-001-map.md`)).toBe(false);
    expect(fs.files.get(`${ROLLBACK_FOLDER}/cards/SMC-099.md`)).toBe("pre-existing card body");
  });

  it("removes this attempt's partial card notes (not pre-existing ones) when a later initial card fails", async () => {
    const { service, fs } = build();
    await fs.createFolder(unsafeVaultPath(`${ROLLBACK_FOLDER}/cards`));
    fs.files.set(`${ROLLBACK_FOLDER}/cards/SMC-099.md`, "pre-existing card body");
    // The SECOND initial card write fails, AFTER the first (SMC-001) was written.
    fs.failOn = { path: `${ROLLBACK_FOLDER}/cards/SMC-002.md`, message: "disk full" };

    const result = await createMapWith(service, [
      authorCard("SMC-001", "A"),
      authorCard("SMC-002", "B"),
    ]);

    expect(result.ok).toBe(false);
    expect(fs.files.has(`${ROLLBACK_FOLDER}/SM-001-map.md`)).toBe(false);
    // This attempt's partial note is removed (a later create reusing the id can't
    // silently adopt it)...
    expect(fs.files.has(`${ROLLBACK_FOLDER}/cards/SMC-001.md`)).toBe(false);
    // ...while the unrelated pre-existing note is preserved.
    expect(fs.files.get(`${ROLLBACK_FOLDER}/cards/SMC-099.md`)).toBe("pre-existing card body");
  });

  it("collapses a multi-line title into a single parser-safe line", async () => {
    const { service, fs } = build();
    const result = await service.create({
      title: "Login\nflow",
      activities: ["a"],
      slices: ["s"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Login flow");
    const note = fs.files.get(result.value.path) ?? "";
    expect(note).toContain("title: Login flow");
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

  it("materializes a shared persona note per user name (ADR-0030)", async () => {
    const { service, fs } = build();
    const result = await service.create({
      title: "Cooking Journey",
      users: ["Home Cook", "Chef"],
      activities: ["a"],
      slices: ["s"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Names stay as names in the map; the personas are a side-effect library.
    expect(result.value.users).toEqual(["Home Cook", "Chef"]);

    const personaNotes = [...fs.files.keys()].filter((k) => k.startsWith("Personas/"));
    expect(personaNotes.length).toBe(2);
    expect(personaNotes.some((k) => k.startsWith("Personas/PER-001"))).toBe(true);
    expect(personaNotes.some((k) => k.startsWith("Personas/PER-002"))).toBe(true);
  });

  it("reuses one persona note when two maps list the same user", async () => {
    const { service, fs } = build();
    const first = await service.create({
      title: "Map One",
      users: ["Home Cook"],
      activities: ["a"],
      slices: ["s"],
    });
    expect(first.ok).toBe(true);
    const second = await service.create({
      title: "Map Two",
      users: ["Home Cook"],
      activities: ["a"],
      slices: ["s"],
    });
    expect(second.ok).toBe(true);

    const homeCookNotes = [...fs.files.keys()].filter((k) => k.startsWith("Personas/PER-"));
    expect(homeCookNotes.length).toBe(1);
  });
});

describe("DefaultStoryMapService.findAll/parse", () => {
  it("parses users + steps and composes cards from the per-card notes under cards/", async () => {
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
        "display_order: 0",
        "---",
        "",
      ].join("\n"),
    );
    // Cards are their own notes under the map's `cards/` folder.
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      title: "Author a UC",
      activity: "Author spec",
      step: "Draft",
      slice: "Walking skeleton",
      status: "planned",
      points: 3,
      tags: ["auth"],
      color: "blue",
      order: 0,
    });
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-002",
      map: "SM-001",
      ref: "UC-011",
      title: "UC-011",
      activity: "Author spec",
      slice: "Walking skeleton",
      order: 1,
    });

    const result = await service.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = result.value[0];
    expect(map.status).toBe("active");
    expect(map.users).toEqual(["Test author"]);
    expect(map.activities).toEqual(["Author spec"]);
    expect(map.steps).toEqual([{ activity: "Author spec", step: "Draft" }]);
    // Sorted by cell then order: the no-step card sorts before the "Draft"-step card.
    expect(map.cards).toEqual([
      {
        id: "SMC-002",
        cardType: "task",
        ref: "UC-011",
        title: "UC-011",
        activity: "Author spec",
        step: undefined,
        slice: "Walking skeleton",
        status: undefined,
        points: undefined,
        color: undefined,
        tags: [],
        order: 1,
        notePath: "Story Maps/SM-001-j/cards/SMC-002.md",
      },
      {
        id: "SMC-001",
        cardType: "task",
        ref: "UC-037",
        title: "Author a UC",
        activity: "Author spec",
        step: "Draft",
        slice: "Walking skeleton",
        status: "planned",
        points: 3,
        tags: ["auth"],
        color: "blue",
        order: 0,
        notePath: "Story Maps/SM-001-j/cards/SMC-001.md",
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

  it("deletes only THIS map's card notes under a pre-existing cards/, preserving the rest", async () => {
    const { service, fs } = build();
    seed(fs); // map SM-001 note
    // A pre-existing cards/ folder holding: this map's generated note, a note from a
    // DIFFERENT map (a prior map that reused this path), and an unrelated user file.
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      activity: "A",
      slice: "S",
    });
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-009",
      map: "SM-OLD",
      activity: "A",
      slice: "S",
    });
    fs.files.set("Story Maps/SM-001-j/cards/notes.md", "user scratch — not a card note");

    const result = await service.deleteStoryMap("SM-001");

    expect(result.ok).toBe(true);
    // This map's card note is removed; the foreign-map note and the unrelated file survive.
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-001.md")).toBe(false);
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-009.md")).toBe(true);
    expect(fs.files.has("Story Maps/SM-001-j/cards/notes.md")).toBe(true);
  });

  it("fails closed (leaving the map note) when a card note under cards/ is unreadable", async () => {
    const { service, fs } = build();
    seed(fs); // map SM-001 note
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      activity: "A",
      slice: "S",
    });
    const cardPath = "Story Maps/SM-001-j/cards/SMC-001.md";
    failReadAt(fs, cardPath, appError("INIT_FAILED", "EIO card note"));

    const result = await service.deleteStoryMap("SM-001");

    // The unreadable generated note isn't orphaned — the delete fails closed and the
    // map note survives, so it stays retryable.
    expect(result.ok).toBe(false);
    expect(fs.files.has("Story Maps/SM-001-j/SM-001-j.md")).toBe(true);
    expect(fs.files.has(cardPath)).toBe(true);
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
    // A note whose body grid block is still empty (the user has not rebuilt yet),
    // with the card living as its own note under cards/.
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
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      activity: "Author spec",
      slice: "Walking skeleton",
    });

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
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\r\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      activity: "Author spec",
      slice: "Walking skeleton",
    });

    const rebuilt = await service.rebuildGrid("SM-001");
    expect(rebuilt.ok).toBe(true);

    const note = fs.files.get(path) ?? "";
    // The frontmatter must not be duplicated or have body text spliced into it.
    expect(note.match(/^---$/gm)?.length).toBe(2);
    expect(note).toContain("[[UC-037 Author a Use Case\\|UC-037]]");
    expect(note).not.toContain("(empty)");
  });

  it("refreshes the product paragraph after the map is reassigned to a new PRD", async () => {
    const { service, fs } = build(
      { "UC-037": "Use Cases/UC-037 Author a Use Case.md" },
      { "PRD-002": "PRDs/PRD-002-new/PRD-002-new.md" },
    );
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    // The user reassigned the map: the frontmatter `product` is now PRD-002, but
    // the visible body paragraph still links the old PRD-001. Rebuild must
    // refresh it, or deleting PRD-001 later leaves the body link dangling.
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "product: PRD-002",
        "activities:",
        "  - Author spec",
        "slices:",
        "  - Walking skeleton",
        "---",
        "# SM-001: J",
        "",
        "<!-- story-map-product:start -->",
        "Story map for [[PRD-001 Old|PRD-001]] — old.",
        "<!-- story-map-product:end -->",
        "",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      activity: "Author spec",
      slice: "Walking skeleton",
    });

    const rebuilt = await service.rebuildGrid("SM-001");
    expect(rebuilt.ok).toBe(true);

    const note = fs.files.get(path) ?? "";
    expect(note).toContain("[[PRD-002-new|PRD-002]]");
    expect(note).not.toContain("PRD-001");
    // The grid is still rebuilt in the same pass.
    expect(note).toContain("[[UC-037 Author a Use Case\\|UC-037]]");
  });

  it("refuses to rebuild when the product was hand-edited to a non-existent PRD", async () => {
    // Only PRD-000 resolves (default ROOT_PRD); the note was reassigned to a typo.
    const { service, fs } = build({ "UC-037": "Use Cases/UC-037 Author a Use Case.md" });
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "product: PRD-999",
        "activities:",
        "  - Author spec",
        "slices:",
        "  - Walking skeleton",
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );

    const result = await service.rebuildGrid("SM-001");
    expect(result.ok).toBe(false);
    // The note is left untouched — no bare/dangling product link written.
    expect(fs.files.get(path)).toContain("(empty)");
  });

  it("refuses to rebuild when a card-note was hand-edited to an off-map activity", async () => {
    // The card-note references an activity not on the backbone. buildStoryMapGrid
    // would drop it from the grid, but it would linger in the composed cards and
    // make every later board save fail; the rebuild must reject it now instead.
    const { service, fs } = build({ "UC-037": "Use Cases/UC-037 Author a Use Case.md" });
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
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      activity: "Ghost activity",
      slice: "Walking skeleton",
    });

    const result = await service.rebuildGrid("SM-001");
    expect(result.ok).toBe(false);
    // The note is left untouched — the bad row isn't written as a "successful" refresh.
    expect(fs.files.get(path)).toContain("(empty)");
  });

  it("refuses to rebuild a map that does not exist", async () => {
    const { service } = build();
    const result = await service.rebuildGrid("SM-404");
    expect(result.ok).toBe(false);
  });
});

describe("DefaultStoryMapService card authoring (add/update/remove)", () => {
  /**
   * Seeds a map note (empty grid block) plus one card-NOTE under cards/
   * (`SMC-001`: UC-037 on Author spec / Walking skeleton).
   */
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
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      activity: "Author spec",
      slice: "Walking skeleton",
    });
    return path;
  };

  it("fails closed (no update event) when the post-reconcile reload can't list the cards", async () => {
    const { service, fs, types } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
    seedNote(fs);
    // A transient vault list failure (not a missing folder) during the reload —
    // the card-notes are on disk, so the write must abort rather than republish
    // the board from a model that silently dropped them.
    fs.listFilesRecursive = async () => ({
      ok: false,
      error: { code: "INIT_FAILED", message: "vault indexing in progress" },
    });

    const result = await service.addCard("SM-001", {
      ref: "UC-040",
      title: "Run the suite",
      activity: "Author spec",
      slice: "Next",
      tags: [],
    });

    expect(result.ok).toBe(false);
    expect(types()).not.toContain("storymap.updated");
  });

  it("rolls back the new card note when the map-note write fails (no duplicate on retry)", async () => {
    const { service, fs } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
    const path = seedNote(fs); // map note + SMC-001
    // The map-note write fails AFTER the new card (SMC-002) was reconciled to disk.
    fs.failOn = { path, message: "disk full" };

    const result = await service.addCard("SM-001", {
      ref: "UC-040",
      title: "Run the suite",
      activity: "Author spec",
      slice: "Next",
      tags: [],
    });

    expect(result.ok).toBe(false);
    // The new card note is rolled back; only the original remains, so a retry can't
    // mint a duplicate.
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-002.md")).toBe(false);
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-001.md")).toBe(true);
  });

  it("adds a card: writes a new card-note, regenerates the grid block, emits storymap.updated", async () => {
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

    // The original card-note survives; the new card got its own note (next id).
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-001.md")).toBe(true);
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-002.md")).toBe(true);
    const newNote = fs.files.get("Story Maps/SM-001-j/cards/SMC-002.md") ?? "";
    expect(newNote).toContain("ref: UC-040");
    expect(newNote).toContain("title: Run the suite");

    const note = fs.files.get(path) ?? "";
    // No cards frontmatter on the map note (cards are their own notes now).
    expect(note).not.toContain("\ncards:");
    // The grid block regenerated with the resolved link; the body is preserved.
    expect(note).toContain("[[UC-040 Run the suite\\|UC-040]]");
    expect(note).not.toContain("(empty)");
    expect(note).toContain("keep me");
  });

  it("validates the full card list on a card write: blocks a new card while a pre-existing off-map card lingers, but still allows removing the bad card", async () => {
    const { service, fs } = build({ "UC-037": "Use Cases/UC-037 Author a Use Case.md" });
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
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    // index 0 (sorts first by activity): good. index 1: off-map (Ghost activity).
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      activity: "Author spec",
      slice: "Walking skeleton",
    });
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-002",
      map: "SM-001",
      ref: "UC-040",
      activity: "Ghost activity",
      slice: "Walking skeleton",
    });

    // Adding a valid card is rejected while the off-map card still lingers in the list.
    const add = await service.addCard("SM-001", {
      title: "New",
      activity: "Author spec",
      slice: "Walking skeleton",
      tags: [],
    });
    expect(add.ok).toBe(false);

    // But removing the offending card (index 1) yields a clean list and is allowed.
    const removed = await service.removeCard("SM-001", 1);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.cards).toHaveLength(1);
    expect(removed.value.cards[0].activity).toBe("Author spec");
    // The off-map card-note was deleted by the reconcile.
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-002.md")).toBe(false);
  });

  it("updateCard keeps the original card-note id and body when the form omits them", async () => {
    const { service, fs } = build({ "UC-037": "Use Cases/UC-037 x.md" });
    seedNote(fs);
    const cardPath = "Story Maps/SM-001-j/cards/SMC-001.md";
    // Give the card note a hand-written body the edit must preserve.
    fs.files.set(cardPath, `${fs.files.get(cardPath) ?? ""}\nHand-written body.\n`);

    // Edit via a form-style card that omits id/order (exactly what the modal builds).
    const result = await service.updateCard("SM-001", 0, {
      ref: "UC-037",
      title: "Renamed",
      activity: "Author spec",
      slice: "Walking skeleton",
      tags: [],
      cardType: "task",
    });

    expect(result.ok).toBe(true);
    // The SAME note id is updated in place — no orphaned note, no new SMC allocated.
    expect(fs.files.has(cardPath)).toBe(true);
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-002.md")).toBe(false);
    const note = fs.files.get(cardPath) ?? "";
    expect(note).toContain("title: Renamed");
    expect(note).toContain("Hand-written body.");
  });

  it("deleteStoryMap removes the generated cards/ notes (not counted as preserved)", async () => {
    const { service, fs } = build();
    seedNote(fs);
    const cardPath = "Story Maps/SM-001-j/cards/SMC-001.md";
    expect(fs.files.has(cardPath)).toBe(true);

    const result = await service.deleteStoryMap("SM-001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Map note and its generated card notes are gone; nothing left to re-adopt.
    expect(fs.files.has(cardPath)).toBe(false);
    expect(fs.files.has("Story Maps/SM-001-j/SM-001-j.md")).toBe(false);
    expect(result.value.preservedFiles).toBe(0);
  });

  it("deleteStoryMap fails closed when the cards/ cleanup listing hits an I/O error", async () => {
    const { service, fs } = build();
    seedNote(fs);
    // Fail the cleanup listing of the map folder ONLY (findById scans "Story Maps").
    const realList = fs.listFilesRecursive.bind(fs);
    fs.listFilesRecursive = async (path) => {
      if (path === "Story Maps/SM-001-j") {
        return { ok: false, error: { code: "INIT_FAILED", message: "EIO: i/o error" } };
      }
      return realList(path);
    };

    const result = await service.deleteStoryMap("SM-001");
    // A real I/O error must NOT be reported as a successful delete: that would
    // leave the generated card notes for a future map to re-adopt.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("EIO");
    // Cleanup runs BEFORE the map-note delete, so a failed cleanup leaves both the
    // map note and its card notes intact — the delete stays retryable (findById can
    // still locate the map to finish the job).
    expect(fs.files.has("Story Maps/SM-001-j/SM-001-j.md")).toBe(true);
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-001.md")).toBe(true);
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

  it("rejects a card write when the map's product no longer resolves", async () => {
    // No PRD resolves (empty PRD set), so the seeded note's product is dangling.
    const { service, fs } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" }, {});
    seedNote(fs);
    const result = await service.addCard("SM-001", {
      ref: "UC-040",
      title: "Run the suite",
      activity: "Author spec",
      step: "Draft",
      slice: "Next",
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

  it("removes a card at an index, deleting its note and leaving an empty grid", async () => {
    const { service, fs } = build();
    const path = seedNote(fs);
    const result = await service.removeCard("SM-001", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cards).toHaveLength(0);
    // The card-note was deleted by the reconcile.
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-001.md")).toBe(false);
    const note = fs.files.get(path) ?? "";
    // The map note never carries a cards frontmatter field.
    expect(note).not.toContain("\ncards:");
  });

  it("rejects an indexed remove/update whose expected card no longer matches (stale row)", async () => {
    const { service, fs } = build();
    seedNote(fs); // seeds one card-note: UC-037 | Author spec | Walking skeleton
    // The caller believed a different card sat at index 0 (e.g. cards were
    // reordered elsewhere while a Cards modal stayed open).
    const stale = cardSignature({
      ref: "UC-099",
      title: "Stale",
      activity: "Author spec",
      slice: "Walking skeleton",
      tags: [],
    });
    const removed = await service.removeCard("SM-001", 0, stale);
    expect(removed.ok).toBe(false);
    if (removed.ok) return;
    expect(removed.error.message).toMatch(/changed elsewhere/);
    // The real card-note survives (was not deleted by the stale-index action).
    expect(fs.files.has("Story Maps/SM-001-j/cards/SMC-001.md")).toBe(true);

    const updated = await service.updateCard(
      "SM-001",
      0,
      { title: "New", activity: "Author spec", slice: "Next", tags: [] },
      stale,
    );
    expect(updated.ok).toBe(false);
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

describe("DefaultStoryMapService.saveMap", () => {
  it("persists a moved card and echoes the origin on the update event", async () => {
    const { service, fs, events } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
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
        "  - Run tests",
        "slices:",
        "  - Walking skeleton",
        "---",
        "# SM-001: J",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-040",
      activity: "Author spec",
      slice: "Walking skeleton",
    });

    const loaded = await service.findById("SM-001");
    expect(loaded.ok && loaded.value).toBeTruthy();
    if (!loaded.ok || !loaded.value) return;
    const moved = moveCard(loaded.value, 0, { activity: "Run tests", slice: "Walking skeleton" });

    const result = await service.saveMap("SM-001", moved, "board-xyz");
    expect(result.ok).toBe(true);

    // The card-note's activity was rewritten by the reconcile (same id, moved cell).
    const cardNote = fs.files.get("Story Maps/SM-001-j/cards/SMC-001.md") ?? "";
    expect(cardNote).toContain("activity: Run tests");
    const updated = events.find((e) => e.type === "storymap.updated");
    expect(updated?.payload).toMatchObject({ storyMapId: "SM-001", origin: "board-xyz" });
  });

  it("rolls the card notes back to the saved axes when the map-note write fails", async () => {
    const { service, fs } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
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
        "  - Run tests",
        "slices:",
        "  - Walking skeleton",
        "---",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-040",
      activity: "Author spec",
      slice: "Walking skeleton",
    });
    const loaded = await service.findById("SM-001");
    if (!loaded.ok || !loaded.value) return;
    const moved = moveCard(loaded.value, 0, { activity: "Run tests", slice: "Walking skeleton" });
    // The map-note write fails AFTER the card reconcile has moved the note's cell.
    fs.failOn = { path, message: "disk full" };

    const result = await service.saveMap("SM-001", moved);

    expect(result.ok).toBe(false);
    // The card note is rolled back to its pre-save cell, so it stays on an axis the
    // (unchanged) map note declares — not stranded off-map at "Run tests".
    const cardNote = fs.files.get("Story Maps/SM-001-j/cards/SMC-001.md") ?? "";
    expect(cardNote).toContain("activity: Author spec");
    expect(cardNote).not.toContain("activity: Run tests");
  });

  it("persists a reordered backbone and slices (full structure), not just cards", async () => {
    const { service, fs } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
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
        "  - Run tests",
        "slices:",
        "  - Walking skeleton",
        "  - Next",
        "---",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-040",
      activity: "Author spec",
      slice: "Walking skeleton",
    });
    const loaded = await service.findById("SM-001");
    if (!loaded.ok || !loaded.value) return;
    const reordered = reorderActivity(reorderSlice(loaded.value, 0, 1), 0, 1);

    const result = await service.saveMap("SM-001", reordered, "board-xyz");
    expect(result.ok).toBe(true);

    const reread = await service.findById("SM-001");
    if (!reread.ok || !reread.value) return;
    expect(reread.value.activities).toEqual(["Run tests", "Author spec"]);
    expect(reread.value.slices).toEqual(["Next", "Walking skeleton"]);
  });

  it("rejects a stale board save whose signature no longer matches the on-disk map", async () => {
    const { service, fs } = build({
      "UC-040": "Use Cases/UC-040 Run the suite.md",
      "UC-041": "Use Cases/UC-041 Other.md",
    });
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
        "  - Run tests",
        "slices:",
        "  - Walking skeleton",
        "---",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-040",
      activity: "Author spec",
      slice: "Walking skeleton",
    });
    const loaded = await service.findById("SM-001");
    if (!loaded.ok || !loaded.value) return;
    const baseline = storyMapSignature(loaded.value);
    // Another surface adds a card after the board loaded.
    const added = await service.addCard("SM-001", {
      ref: "UC-041",
      title: "Other",
      activity: "Run tests",
      slice: "Walking skeleton",
      tags: [],
    });
    expect(added.ok).toBe(true);
    const result = await service.saveMap(
      "SM-001",
      reorderSlice(loaded.value, 0, 0),
      "board-xyz",
      baseline,
    );
    expect(result.ok).toBe(false);
    // The concurrent add landed (its card-note exists); the stale board save is rejected.
    expect(fs.files.get(path)).toContain("UC-041");
  });

  it("rejects a model whose card is off the map's axes, leaving the note untouched", async () => {
    const { service, fs } = build({ "UC-040": "Use Cases/UC-040 Run the suite.md" });
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
        "---",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-040",
      activity: "Author spec",
      slice: "Walking skeleton",
    });
    const loaded = await service.findById("SM-001");
    if (!loaded.ok || !loaded.value) return;
    // Move onto a slice that doesn't exist on the map.
    const bad = { ...loaded.value, cards: [{ ...loaded.value.cards[0], slice: "Ghost" }] };
    const result = await service.saveMap("SM-001", bad, "board-xyz");
    expect(result.ok).toBe(false);
    expect(fs.files.get(path)).toContain("(empty)");
  });
});

describe("DefaultStoryMapService.updateMapMeta", () => {
  /** Creates a map (status defaults to "draft") anchored to the given product. */
  const createMap = async (
    service: DefaultStoryMapService,
    product = "PRD-000",
  ): Promise<{ id: string; path: VaultPath }> => {
    const created = await service.create({
      title: "Original",
      product,
      activities: ["Author spec"],
      slices: ["Walking skeleton"],
    });
    if (!created.ok) throw new Error("setup: create failed");
    return { id: created.value.id, path: created.value.path };
  };

  it("updates the status only, persisting it without touching structure or the path", async () => {
    const { service, fs, types } = build();
    const { id, path } = await createMap(service);

    const result = await service.updateMapMeta(id, { status: "active" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("active");
    expect(result.value.title).toBe("Original");
    expect(result.value.activities).toEqual(["Author spec"]);
    expect(result.value.slices).toEqual(["Walking skeleton"]);
    // The folder/path is stable (identity is the id, not the slug).
    expect(result.value.path).toBe(path);

    const note = fs.files.get(path) ?? "";
    expect(note).toContain("status: active");
    expect(types()).toContain("storymap.updated");
  });

  it("renames the title, collapsing whitespace and rewriting the heading, path stable", async () => {
    const { service, fs } = build();
    const { id, path } = await createMap(service);

    const result = await service.updateMapMeta(id, { title: "  Renamed  Journey  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Renamed Journey");
    expect(result.value.path).toBe(path);

    const note = fs.files.get(path) ?? "";
    expect(note).toContain(`# ${id}: Renamed Journey`);
  });

  it("re-anchors the product to another resolvable PRD", async () => {
    const { service, fs } = build({}, { ...ROOT_PRD, "PRD-003": "PRDs/PRD-003-x/PRD-003-x.md" });
    const { id, path } = await createMap(service, "PRD-000");

    const result = await service.updateMapMeta(id, { product: "PRD-003" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.product).toBe("PRD-003");

    const note = fs.files.get(path) ?? "";
    expect(note).toContain("product: PRD-003");
  });

  it("rejects a product that does not resolve to a real PRD", async () => {
    const { service } = build();
    const { id } = await createMap(service);

    const result = await service.updateMapMeta(id, { product: "PRD-999" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.message).toContain("PRD-999");
  });

  it("rejects a blank title", async () => {
    const { service } = build();
    const { id } = await createMap(service);

    const result = await service.updateMapMeta(id, { title: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a map that does not exist", async () => {
    const { service } = build();
    const result = await service.updateMapMeta("SM-404", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("not found");
  });

  it("refuses a metadata save when a card was hand-edited to an off-map activity", async () => {
    // Same guard as rebuild/board/card writes: a card pointing at an unknown
    // activity would be dropped from the regenerated grid but linger in frontmatter,
    // so a Settings save (title/status/product) must reject it instead of refreshing
    // the managed blocks around the hidden bad card.
    const { service, fs } = build({ "UC-037": "Use Cases/UC-037 Author a Use Case.md" });
    const path = "Story Maps/SM-001-j/SM-001-j.md";
    fs.files.set(
      path,
      [
        "---",
        "id: SM-001",
        "type: story-map",
        "title: J",
        "status: draft",
        "product: PRD-000",
        "activities:",
        "  - Author spec",
        "slices:",
        "  - Walking skeleton",
        "---",
        "## Map",
        "",
        "<!-- story-map-grid:start -->",
        "(empty)",
        "<!-- story-map-grid:end -->",
      ].join("\n"),
    );
    seedCardNote(fs, "Story Maps/SM-001-j", {
      id: "SMC-001",
      map: "SM-001",
      ref: "UC-037",
      activity: "Ghost activity",
      slice: "Walking skeleton",
    });

    const result = await service.updateMapMeta("SM-001", { status: "active" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
    // The note is left untouched — the status change isn't written around the bad card.
    expect(fs.files.get(path)).toContain("status: draft");
    expect(fs.files.get(path)).toContain("(empty)");
  });
});

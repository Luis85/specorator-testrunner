import { describe, it, expect } from "vitest";
import {
  loadCards,
  reconcileCards,
  reloadCards,
} from "../src/application/services/story-map-cards-store";
import { buildCardNote, cardFileName } from "../src/application/content/story-map-card-content";
import type { StoryMapCard } from "../src/domain/entities/story-map";
import type { StoryMapCardNote } from "../src/domain/entities/story-map-card";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { joinVaultPath } from "../src/shared/utils/vault-path";
import { KeyedSerialQueue } from "../src/shared/async/serial-queue";
import { FakeVaultFileSystem } from "./fakes";

const CARDS_DIR = "Story Maps/SM-001-x/cards" as VaultPath;
const MAP_ID = "SM-001";

const cardNote = (overrides: Partial<StoryMapCardNote>): StoryMapCardNote => ({
  id: "SMC-001",
  map: MAP_ID,
  cardType: "task",
  ref: undefined,
  status: undefined,
  points: undefined,
  tags: [],
  color: undefined,
  activity: "Find",
  step: undefined,
  slice: "MVP",
  order: 0,
  title: "Untitled",
  body: "",
  path: joinVaultPath(CARDS_DIR, cardFileName(overrides.id ?? "SMC-001")),
  ...overrides,
});

const seedNote = (fs: FakeVaultFileSystem, note: StoryMapCardNote): void => {
  fs.files.set(String(note.path), buildCardNote(note));
};

describe("loadCards", () => {
  it("orders cards within a cell by ascending order", async () => {
    const fs = new FakeVaultFileSystem();
    seedNote(fs, cardNote({ id: "SMC-001", title: "b", order: 1 }));
    seedNote(fs, cardNote({ id: "SMC-002", title: "a", order: 0 }));

    const cards = await loadCards(fs, CARDS_DIR, MAP_ID);

    expect(cards.map((c) => c.title)).toEqual(["a", "b"]);
  });

  it("returns [] when the cards folder does not exist", async () => {
    const fs = new FakeVaultFileSystem();
    // listFilesRecursive in the fake never errors; simulate a missing folder by
    // overriding it to surface an ENOENT for this path.
    const original = fs.listFilesRecursive.bind(fs);
    fs.listFilesRecursive = async (path: VaultPath) => {
      if (path === CARDS_DIR) {
        return { ok: false, error: { code: "RUNNER_MISSING_FILE", message: "ENOENT not found" } };
      }
      return original(path);
    };

    const cards = await loadCards(fs, CARDS_DIR, MAP_ID);

    expect(cards).toEqual([]);
  });

  it("excludes notes belonging to a different map", async () => {
    const fs = new FakeVaultFileSystem();
    seedNote(fs, cardNote({ id: "SMC-001", title: "mine", map: MAP_ID }));
    seedNote(fs, cardNote({ id: "SMC-002", title: "theirs", map: "SM-999" }));

    const cards = await loadCards(fs, CARDS_DIR, MAP_ID);

    expect(cards.map((c) => c.title)).toEqual(["mine"]);
  });
});

describe("reloadCards (fail-closed write-path reload)", () => {
  it("returns the cards on success", async () => {
    const fs = new FakeVaultFileSystem();
    seedNote(fs, cardNote({ id: "SMC-001", title: "a", order: 0 }));
    seedNote(fs, cardNote({ id: "SMC-002", title: "b", order: 1 }));

    const result = await reloadCards(fs, CARDS_DIR, MAP_ID);

    expect(result.ok && result.value.map((c) => c.title)).toEqual(["a", "b"]);
  });

  it("treats a genuinely-missing cards/ folder as no cards (ok empty)", async () => {
    const fs = new FakeVaultFileSystem();
    fs.listFilesRecursive = async () => ({
      ok: false,
      error: { code: "RUNNER_MISSING_FILE", message: "ENOENT" },
    });

    const result = await reloadCards(fs, CARDS_DIR, MAP_ID);

    expect(result.ok && result.value).toEqual([]);
  });

  it("fails closed on a transient list error (not a missing folder)", async () => {
    const fs = new FakeVaultFileSystem();
    fs.listFilesRecursive = async () => ({
      ok: false,
      error: { code: "INIT_FAILED", message: "vault indexing in progress" },
    });

    const result = await reloadCards(fs, CARDS_DIR, MAP_ID);

    expect(result.ok).toBe(false);
  });

  it("fails closed when a listed card note can't be read", async () => {
    const fs = new FakeVaultFileSystem();
    seedNote(fs, cardNote({ id: "SMC-001", title: "a" }));
    const original = fs.readFile.bind(fs);
    fs.readFile = async (p: VaultPath) =>
      String(p).endsWith("SMC-001.md")
        ? { ok: false as const, error: { code: "INIT_FAILED" as const, message: "disk" } }
        : original(p);

    const result = await reloadCards(fs, CARDS_DIR, MAP_ID);

    expect(result.ok).toBe(false);
  });
});

const modelCard = (overrides: Partial<StoryMapCard>): StoryMapCard => ({
  title: "Untitled",
  activity: "Find",
  step: undefined,
  slice: "MVP",
  tags: [],
  ...overrides,
});

describe("reconcileCards", () => {
  it("writes an id-less model card as SMC-001.md with id + map frontmatter", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    const model = [modelCard({ title: "New card" })];

    const result = await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    expect(result.ok).toBe(true);
    const path = String(joinVaultPath(CARDS_DIR, "SMC-001.md"));
    const written = fs.files.get(path);
    expect(written).toBeDefined();
    expect(written).toContain("id: SMC-001");
    expect(written).toContain(`map: ${MAP_ID}`);
  });

  it("assigns distinct ids to two id-less cards in one call", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    const model = [modelCard({ title: "first" }), modelCard({ title: "second" })];

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-001.md")))).toBe(true);
    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-002.md")))).toBe(true);
  });

  it("deletes the note of an existing card dropped from the model", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    seedNote(fs, cardNote({ id: "SMC-001", title: "keep" }));
    seedNote(fs, cardNote({ id: "SMC-002", title: "drop", order: 1 }));
    const existing: StoryMapCard[] = [
      modelCard({ id: "SMC-001", title: "keep" }),
      modelCard({ id: "SMC-002", title: "drop" }),
    ];
    const model = [modelCard({ id: "SMC-001", title: "keep" })];

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, existing);

    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-001.md")))).toBe(true);
    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-002.md")))).toBe(false);
  });

  it("preserves the hand-written body when rewriting a card", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    seedNote(
      fs,
      cardNote({ id: "SMC-005", title: "old title", body: "A hand-written paragraph." }),
    );
    const existing = [modelCard({ id: "SMC-005", title: "old title" })];
    const model = [modelCard({ id: "SMC-005", title: "new title" })];

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, existing);

    const written = fs.files.get(String(joinVaultPath(CARDS_DIR, "SMC-005.md")));
    expect(written).toBeDefined();
    expect(written).toContain("A hand-written paragraph.");
    expect(written).toContain("title: new title");
  });

  it("deletes a renamed card note by its loaded path, not a reconstructed canonical path", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    // The user renamed cards/SMC-003.md to a meaningful filename; it still loads
    // by its id/map frontmatter.
    const renamed = joinVaultPath(CARDS_DIR, "Login flow.md");
    seedNote(fs, cardNote({ id: "SMC-003", title: "Login", path: renamed }));
    const existing = await loadCards(fs, CARDS_DIR, MAP_ID); // carries notePath = renamed

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, [], existing);

    expect(fs.files.has(String(renamed))).toBe(false);
    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-003.md")))).toBe(false);
  });

  it("rewrites a renamed card note in place without creating a duplicate canonical note", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    const renamed = joinVaultPath(CARDS_DIR, "Login flow.md");
    seedNote(fs, cardNote({ id: "SMC-003", title: "old", body: "Body kept.", path: renamed }));
    const existing = await loadCards(fs, CARDS_DIR, MAP_ID);
    const model = [modelCard({ id: "SMC-003", title: "new" })];

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, existing);

    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-003.md")))).toBe(false);
    const written = fs.files.get(String(renamed));
    expect(written).toContain("title: new");
    expect(written).toContain("Body kept.");
  });

  it("allocates a fresh id for a caller-supplied id that isn't a well-formed SMC-NNN", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    // A traversal id must never reach cardFileName/joinVaultPath (joinVaultPath
    // throws on "..", escaping the Result-returning service boundary).
    const model = [modelCard({ id: "../escape", title: "evil" })];

    const result = await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    expect(result.ok).toBe(true);
    // Written under a safe, freshly-allocated canonical id — never the bad one.
    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-001.md")))).toBe(true);
    expect(fs.files.get(String(joinVaultPath(CARDS_DIR, "SMC-001.md")))).toContain("id: SMC-001");
  });

  it("updates order frontmatter when two cards in a cell are reordered", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    seedNote(fs, cardNote({ id: "SMC-001", title: "a", order: 0 }));
    seedNote(fs, cardNote({ id: "SMC-002", title: "b", order: 1 }));
    const existing = [
      modelCard({ id: "SMC-001", title: "a" }),
      modelCard({ id: "SMC-002", title: "b" }),
    ];
    // New model order: b before a (same cell).
    const model = [
      modelCard({ id: "SMC-002", title: "b" }),
      modelCard({ id: "SMC-001", title: "a" }),
    ];

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, existing);

    const reloaded = await loadCards(fs, CARDS_DIR, MAP_ID);
    expect(reloaded.map((c) => c.title)).toEqual(["b", "a"]);
    const noteB = fs.files.get(String(joinVaultPath(CARDS_DIR, "SMC-002.md")));
    const noteA = fs.files.get(String(joinVaultPath(CARDS_DIR, "SMC-001.md")));
    expect(noteB).toContain("order: 0");
    expect(noteA).toContain("order: 1");
  });
});

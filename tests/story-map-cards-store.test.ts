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

  it("reserves a preassigned id so a later id-less card can't re-mint (and clobber) it", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    // Preassigned SMC-001 first, then an id-less card — the id-less one must NOT
    // also become SMC-001 (both would write to cards/SMC-001.md, one clobbered).
    const model = [modelCard({ id: "SMC-001", title: "kept" }), modelCard({ title: "fresh" })];

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    const reloaded = await loadCards(fs, CARDS_DIR, MAP_ID);
    expect(reloaded.map((c) => c.id).sort()).toEqual(["SMC-001", "SMC-002"]);
    expect(reloaded.map((c) => c.title).sort()).toEqual(["fresh", "kept"]);
  });

  it("reallocates a duplicate preassigned id so two cards never share a note", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    const model = [
      modelCard({ id: "SMC-001", title: "first" }),
      modelCard({ id: "SMC-001", title: "second" }),
    ];

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    const reloaded = await loadCards(fs, CARDS_DIR, MAP_ID);
    expect(reloaded).toHaveLength(2);
    expect(new Set(reloaded.map((c) => c.id)).size).toBe(2);
    expect(reloaded.map((c) => c.title).sort()).toEqual(["first", "second"]);
  });

  it("fails closed (does not blank the body) when an existing card note can't be read", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    seedNote(fs, cardNote({ id: "SMC-005", title: "t", body: "Precious hand-written body." }));
    const original = fs.readFile.bind(fs);
    fs.readFile = async (p: VaultPath) =>
      String(p).endsWith("SMC-005.md")
        ? { ok: false as const, error: { code: "INIT_FAILED" as const, message: "indexing" } }
        : original(p);
    const existing = [modelCard({ id: "SMC-005", title: "t" })];
    const model = [modelCard({ id: "SMC-005", title: "t updated" })];

    const result = await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, existing);

    expect(result.ok).toBe(false);
    // The note on disk is untouched — the body survives rather than being blanked.
    expect(fs.files.get(String(joinVaultPath(CARDS_DIR, "SMC-005.md")))).toContain(
      "Precious hand-written body.",
    );
  });

  it("allocates past an occupied filename so a new card never overwrites a pre-existing file", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    // A hand-edited / unparsable file occupies cards/SMC-001.md.
    fs.files.set(String(joinVaultPath(CARDS_DIR, "SMC-001.md")), "not a card note");
    const model = [modelCard({ title: "new" })]; // id-less → would naively mint SMC-001

    const result = await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    expect(result.ok).toBe(true);
    // The pre-existing file survives; the new card took the next free id.
    expect(fs.files.get(String(joinVaultPath(CARDS_DIR, "SMC-001.md")))).toBe("not a card note");
    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-002.md")))).toBe(true);
  });

  it("fails closed instead of overwriting a foreign note when a preassigned id collides", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    // A valid card note from a PRIOR map occupies cards/SMC-001.md.
    seedNote(
      fs,
      cardNote({ id: "SMC-001", map: "SM-OLD", title: "theirs", body: "Prior map body." }),
    );
    const model = [modelCard({ id: "SMC-001", title: "mine" })]; // preassigned, collides

    const result = await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    expect(result.ok).toBe(false);
    // The prior map's note is preserved, not clobbered with this map's content.
    expect(fs.files.get(String(joinVaultPath(CARDS_DIR, "SMC-001.md")))).toContain(
      "Prior map body.",
    );
  });

  it("removes a duplicate-id note from disk when one of two same-id cards is dropped", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    // Two files under cards/ carry the same id SMC-001 (a user-duplicated note).
    const pathA = joinVaultPath(CARDS_DIR, "SMC-001.md");
    const pathB = joinVaultPath(CARDS_DIR, "SMC-001-copy.md");
    seedNote(fs, cardNote({ id: "SMC-001", title: "A", path: pathA }));
    seedNote(fs, cardNote({ id: "SMC-001", title: "B", path: pathB }));
    const existing = await loadCards(fs, CARDS_DIR, MAP_ID); // 2 cards, same id, distinct paths
    expect(existing).toHaveLength(2);
    const model = [modelCard({ id: "SMC-001", title: "A" })]; // board keeps only ONE

    await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, existing);

    // Exactly one SMC-001 file remains — the dropped duplicate no longer reappears.
    const remaining = [pathA, pathB].filter((p) => fs.files.has(String(p)));
    expect(remaining).toHaveLength(1);
  });

  it("fails closed on a real list error before allocating or writing card notes", async () => {
    const fs = new FakeVaultFileSystem();
    const queue = new KeyedSerialQueue();
    // A real I/O/indexing error listing cards/ (NOT a missing folder).
    fs.listFilesRecursive = async () => ({
      ok: false,
      error: { code: "INIT_FAILED", message: "vault indexing in progress" },
    });
    const model = [modelCard({ title: "new" })];

    const result = await reconcileCards(fs, queue, CARDS_DIR, MAP_ID, model, []);

    expect(result.ok).toBe(false);
    // No partial card-note side effects from an operation reported as failed.
    expect(fs.files.has(String(joinVaultPath(CARDS_DIR, "SMC-001.md")))).toBe(false);
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

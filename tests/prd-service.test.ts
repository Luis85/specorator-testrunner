import { describe, expect, it } from "vitest";
import { DefaultPrdService } from "../src/application/services/prd-service";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { appError } from "../src/shared/errors/errors";
import { FakeVaultFileSystem, failReadAt, serviceHarness, silentLogger } from "./fakes";

const build = () => {
  const { fs, bus, types, events, settings } = serviceHarness();
  const service = new DefaultPrdService(settings, fs, bus, silentLogger);
  return { service, fs, types, events };
};

describe("DefaultPrdService.create", () => {
  it("creates a sub-PRD folder + note and emits prd.created", async () => {
    const { service, fs, types, events } = build();
    // The root must already exist for a sub-PRD to reference it as parent.
    fs.files.set(
      "PRDs/PRD-000-vision/PRD-000-vision.md",
      "---\nid: PRD-000\ntype: prd\nparent-prd:\n---\n",
    );

    const result = await service.create({
      title: "Dashboard & KPI Tracking",
      parentPrdId: "PRD-000",
      domains: ["dashboard"],
      vision: "Single source of truth",
      scopeIn: ["KPI tiles"],
      scopeOut: ["historical analytics"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("PRD-001");
    expect(result.value.path).toBe(
      "PRDs/PRD-001-dashboard-kpi-tracking/PRD-001-dashboard-kpi-tracking.md",
    );
    expect(fs.files.has(result.value.path)).toBe(true);

    expect(types()).toContain("prd.created");
    const created = events.find((e) => e.type === "prd.created");
    expect(created?.payload).toEqual({
      prdId: "PRD-001",
      title: "Dashboard & KPI Tracking",
      path: result.value.path,
      parentPrdId: "PRD-000",
    });
    expect(created?.correlationId).toBe("PRD-001");
  });

  it("auto-increments ids past existing PRDs (PRD-000 reserved)", async () => {
    const { service, fs } = build();
    fs.files.set(
      "PRDs/PRD-000-product-vision/PRD-000-product-vision.md",
      "---\nid: PRD-000\ntype: prd\n---\n",
    );
    fs.files.set("PRDs/PRD-001-x/PRD-001-x.md", "---\nid: PRD-001\ntype: prd\n---\n");

    const result = await service.create({
      title: "Second",
      parentPrdId: "PRD-000",
      domains: ["d"],
      vision: "v",
      scopeIn: ["a"],
      scopeOut: ["b"],
    });
    expect(result.ok && result.value.id).toBe("PRD-002");
  });

  // Both cleanup tests create a sub-PRD ("Cleanup Test" → PRD-001-cleanup-test)
  // whose note write is rigged to fail after the folder step; they differ only
  // in whether the target folder pre-exists.
  const createWithFailingNote = (service: DefaultPrdService, fs: FakeVaultFileSystem) => {
    fs.files.set(
      "PRDs/PRD-000-vision/PRD-000-vision.md",
      "---\nid: PRD-000\ntype: prd\nparent-prd:\n---\n",
    );
    fs.failOn = {
      path: "PRDs/PRD-001-cleanup-test/PRD-001-cleanup-test.md",
      message: "disk full",
    };
    return service.create({
      title: "Cleanup Test",
      parentPrdId: "PRD-000",
      domains: ["d"],
      vision: "v",
      scopeIn: ["a"],
      scopeOut: ["b"],
    });
  };

  it("cleans up the new folder when the note write fails (no orphaned empty folder)", async () => {
    const { service, fs } = build();
    const result = await createWithFailingNote(service, fs);

    expect(result.ok).toBe(false);
    // The just-created folder must not be left behind on a note-write failure.
    expect([...fs.folders].some((f) => f.startsWith("PRDs/PRD-001"))).toBe(false);
  });

  it("never deletes a PRE-EXISTING folder (with user content) when the note write fails", async () => {
    const { service, fs } = build();
    // The target folder already exists and holds user content (e.g. a diagram).
    fs.folders.add("PRDs/PRD-001-cleanup-test");
    fs.files.set("PRDs/PRD-001-cleanup-test/diagram.md", "# my notes");

    const result = await createWithFailingNote(service, fs);

    expect(result.ok).toBe(false);
    // Cleanup must be limited to folders THIS call created — the pre-existing
    // folder and its user content survive (codex P2).
    expect(fs.files.get("PRDs/PRD-001-cleanup-test/diagram.md")).toBe("# my notes");
  });
});

describe("DefaultPrdService.findAll/parse", () => {
  it("parses PRD notes and normalizes empty parent-prd to root", async () => {
    const { service, fs } = build();
    fs.files.set(
      "PRDs/PRD-000-product-vision/PRD-000-product-vision.md",
      [
        "---",
        "id: PRD-000",
        "type: prd",
        "title: Vision",
        "status: active",
        "parent-prd:",
        "vision: V",
        "display_order: 0",
        "---",
        "# PRD-000: Vision",
        "",
      ].join("\n"),
    );
    fs.files.set(
      "PRDs/PRD-001-dash/PRD-001-dash.md",
      [
        "---",
        "id: PRD-001",
        "type: prd",
        "title: Dash",
        "status: draft",
        "parent-prd: PRD-000",
        "domains:",
        "  - dashboard",
        "vision: V",
        "scope_in:",
        "  - tiles",
        "scope_out:",
        "  - exports",
        "display_order: 1",
        "---",
        "# PRD-001: Dash",
        "",
      ].join("\n"),
    );

    const result = await service.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.value.find((p) => p.id === "PRD-000");
    const sub = result.value.find((p) => p.id === "PRD-001");
    expect(root?.parentPrdId).toBeUndefined();
    expect(sub?.parentPrdId).toBe("PRD-000");
    expect(sub?.domains).toEqual(["dashboard"]);
    expect(sub?.scopeIn).toEqual(["tiles"]);
  });

  it("drops notes whose type is not prd", async () => {
    const { service, fs } = build();
    fs.files.set("PRDs/not-a-prd.md", "---\ntype: use-case\nid: UC-001\n---\n");
    const result = await service.findAll();
    expect(result.ok && result.value).toEqual([]);
  });
});

describe("DefaultPrdService.create id allocation", () => {
  it("gives the first root PRD the reserved PRD-000", async () => {
    const { service, fs } = build();
    const result = await service.create({
      title: "Product Vision",
      // a root: no parent
      domains: [],
      vision: "The single source of truth",
      scopeIn: ["everything in"],
      scopeOut: ["everything out"],
    });
    expect(result.ok && result.value.id).toBe("PRD-000");
    expect(fs.files.has("PRDs/PRD-000-product-vision/PRD-000-product-vision.md")).toBe(true);
  });

  it("gives the first sub-PRD PRD-001 once the root exists", async () => {
    const { service, fs } = build();
    fs.files.set(
      "PRDs/PRD-000-vision/PRD-000-vision.md",
      ["---", "id: PRD-000", "type: prd", "title: V", "parent-prd:", "---", ""].join("\n"),
    );
    const result = await service.create({
      title: "Dashboard",
      parentPrdId: "PRD-000",
      domains: ["dashboard"],
      vision: "v",
      scopeIn: ["a"],
      scopeOut: ["b"],
    });
    expect(result.ok && result.value.id).toBe("PRD-001");
  });
});

describe("DefaultPrdService.create parent validation", () => {
  const seedRoot = (fs: FakeVaultFileSystem) =>
    fs.files.set(
      "PRDs/PRD-000-vision/PRD-000-vision.md",
      ["---", "id: PRD-000", "type: prd", "title: V", "parent-prd:", "---", ""].join("\n"),
    );

  it("rejects an explicit parent that does not exist", async () => {
    const { service } = build();
    const result = await service.create({
      title: "Orphan",
      parentPrdId: "PRD-999",
      domains: ["d"],
      vision: "v",
      scopeIn: ["a"],
      scopeOut: ["b"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("PRD-999");
  });

  it("defaults an omitted parent under the root instead of creating a second root", async () => {
    const { service, fs, events } = build();
    seedRoot(fs);

    const result = await service.create({
      // No parentPrdId, but a root already exists → must become its child.
      title: "Reporting",
      domains: ["reporting"],
      vision: "v",
      scopeIn: ["a"],
      scopeOut: ["b"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("PRD-001");
    expect(result.value.parentPrdId).toBe("PRD-000");
    // The event payload carries the resolved parent, not the (omitted) request value.
    expect(events.find((e) => e.type === "prd.created")?.payload).toMatchObject({
      prdId: "PRD-001",
      parentPrdId: "PRD-000",
    });
  });

  it("requires a domain when an omitted parent resolves to a sub-PRD", async () => {
    const { service, fs } = build();
    seedRoot(fs);

    const result = await service.create({
      title: "No domain",
      domains: [],
      vision: "v",
      scopeIn: ["a"],
      scopeOut: ["b"],
    });
    expect(result.ok).toBe(false);
  });
});

describe("DefaultPrdService.create normalization", () => {
  it("collapses a multiline vision into a single-line frontmatter scalar", async () => {
    const { service, fs } = build();

    const result = await service.create({
      title: "Vision Test",
      domains: [],
      vision: "Line one\nLine two\n  with   spaces",
      scopeIn: ["a"],
      scopeOut: ["b"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The root gets PRD-000; its note's frontmatter vision must be one line.
    expect(result.value.vision).toBe("Line one Line two with spaces");
    const note = fs.files.get(result.value.path) ?? "";
    expect(note).toContain("vision: Line one Line two with spaces");
    // And it round-trips through the read model unchanged.
    const reloaded = await service.findAll();
    expect(reloaded.ok && reloaded.value[0]?.vision).toBe("Line one Line two with spaces");
  });
});

describe("DefaultPrdService.deletePrd", () => {
  const seedRoot = (fs: FakeVaultFileSystem) =>
    fs.files.set(
      "PRDs/PRD-000-vision/PRD-000-vision.md",
      [
        "---",
        "id: PRD-000",
        "type: prd",
        "title: Vision",
        "parent-prd:",
        "---",
        "# PRD-000",
        "",
      ].join("\n"),
    );
  const seedSub = (fs: FakeVaultFileSystem, id = "PRD-001", folder = "PRD-001-dash") =>
    fs.files.set(
      `PRDs/${folder}/${folder}.md`,
      [
        "---",
        `id: ${id}`,
        "type: prd",
        "title: Dash",
        "parent-prd: PRD-000",
        "---",
        "# Dash",
        "",
      ].join("\n"),
    );

  it("deletes a leaf sub-PRD note and emits prd.deleted", async () => {
    const { service, fs, types, events } = build();
    seedRoot(fs);
    seedSub(fs);

    const result = await service.deletePrd("PRD-001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preservedFiles).toBe(0);
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(false);
    expect(types()).toContain("prd.deleted");
    expect(events.find((e) => e.type === "prd.deleted")?.payload).toEqual({
      prdId: "PRD-001",
      path: "PRDs/PRD-001-dash/PRD-001-dash.md",
      preservedFiles: 0,
    });
  });

  it("preserves sibling attachments and reports the count", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    fs.files.set("PRDs/PRD-001-dash/diagram.png", "binary");

    const result = await service.deletePrd("PRD-001");
    expect(result.ok && result.value.preservedFiles).toBe(1);
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(false);
    expect(fs.files.has("PRDs/PRD-001-dash/diagram.png")).toBe(true);
  });

  it("refuses to delete a PRD with children", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs, "PRD-001", "PRD-001-dash");
    fs.files.set(
      "PRDs/PRD-002-child/PRD-002-child.md",
      ["---", "id: PRD-002", "type: prd", "title: Child", "parent-prd: PRD-001", "---", ""].join(
        "\n",
      ),
    );

    const result = await service.deletePrd("PRD-001");
    expect(result.ok).toBe(false);
  });

  it("refuses to delete a PRD that still has linked use cases", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    fs.files.set(
      "Use Cases/UC-001.md",
      ["---", "id: UC-001", "type: use-case", "title: A", "prd-id: PRD-001", "---", ""].join("\n"),
    );

    const result = await service.deletePrd("PRD-001");
    expect(result.ok).toBe(false);
  });

  it("refuses to delete a PRD that is a Story Map's product anchor", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    fs.files.set(
      "Story Maps/SM-001-j/SM-001-j.md",
      ["---", "id: SM-001", "type: story-map", "title: J", "product: PRD-001", "---", ""].join(
        "\n",
      ),
    );

    const result = await service.deletePrd("PRD-001");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Story Map");
    // The PRD note survives so the map's anchor can't dangle.
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(true);
  });

  it("ignores a non-story-map note under Story Maps that merely carries a product field", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    // An auxiliary note (e.g. a preserved attachment) with a `product:` field but
    // not type: story-map must NOT block deletion (mirrors findAll's type filter).
    fs.files.set(
      "Story Maps/SM-001-j/notes.md",
      ["---", "type: note", "product: PRD-001", "---", "scratch"].join("\n"),
    );

    const result = await service.deletePrd("PRD-001");
    expect(result.ok).toBe(true);
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(false);
  });

  it("does not fail-close PRD deletion when a generated card note under cards/ is unreadable", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    // A valid map (anchored to the root, not PRD-001) plus an UNREADABLE generated
    // card note under its cards/ subtree — card notes can't anchor a PRD, so a bad
    // one must not block deleting an unrelated PRD.
    fs.files.set(
      "Story Maps/SM-001-j/SM-001-j.md",
      ["---", "id: SM-001", "type: story-map", "title: J", "product: PRD-000", "---", ""].join(
        "\n",
      ),
    );
    const cardPath = "Story Maps/SM-001-j/cards/SMC-001.md";
    fs.files.set(cardPath, "unreadable card note");
    failReadAt(fs, cardPath, appError("INIT_FAILED", "EIO card note"));

    const result = await service.deletePrd("PRD-001");

    expect(result.ok).toBe(true);
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(false);
  });

  it("counts a map note under a top-level 'cards' folder (only <map>/cards/ is skipped)", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    // A map note the user placed under a top-level "cards" folder — NOT the generated
    // <map>/cards/ child — must still count as an anchor.
    fs.files.set(
      "Story Maps/cards/SM-001-j.md",
      ["---", "id: SM-001", "type: story-map", "title: J", "product: PRD-001", "---", ""].join(
        "\n",
      ),
    );

    const result = await service.deletePrd("PRD-001");

    expect(result.ok).toBe(false);
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(true);
  });

  it("still counts map notes as anchors when storyMapsPath is nested under a 'cards' segment", async () => {
    // A storyMapsPath that itself contains a `cards` segment: the card-note skip must
    // be RELATIVE to the maps root, else every map-note path matches and the guard
    // counts zero — deleting a PRD still used as a map's `product` (dangling anchor).
    const { fs, bus, settings } = serviceHarness({
      schemaVersion: 1,
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, storyMapsPath: "Planning/cards/Story Maps" },
    });
    const service = new DefaultPrdService(settings, fs, bus, silentLogger);
    seedRoot(fs);
    seedSub(fs);
    fs.files.set(
      "Planning/cards/Story Maps/SM-001-j/SM-001-j.md",
      ["---", "id: SM-001", "type: story-map", "title: J", "product: PRD-001", "---", ""].join(
        "\n",
      ),
    );

    const result = await service.deletePrd("PRD-001");

    // PRD-001 is still the map's product anchor → deletion refused (map note counted).
    expect(result.ok).toBe(false);
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(true);
  });

  it("treats a Story Map with a blank product as anchored to PRD-000, not a sub-PRD", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    // A map with an omitted/blank `product` resolves to PRD-000 (ADR-0027 default),
    // so it anchors the root — it must NOT over-block deleting an unrelated sub-PRD.
    // The guard reuses parseStoryMapNote so this default can't drift from findAll.
    fs.files.set(
      "Story Maps/SM-001-j/SM-001-j.md",
      ["---", "id: SM-001", "type: story-map", "title: J", "---", ""].join("\n"),
    );

    const result = await service.deletePrd("PRD-001");
    expect(result.ok).toBe(true);
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(false);
  });

  it("never deletes the root PRD-000", async () => {
    const { service, fs } = build();
    seedRoot(fs);

    const result = await service.deletePrd("PRD-000");
    expect(result.ok).toBe(false);
    expect(fs.files.has("PRDs/PRD-000-vision/PRD-000-vision.md")).toBe(true);
  });

  it("fails closed: refuses to delete when a linked Use Case note can't be read", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs);
    const ucPath = "Use Cases/UC-001.md";
    fs.files.set(
      ucPath,
      ["---", "id: UC-001", "type: use-case", "title: A", "prd-id: PRD-001", "---", ""].join("\n"),
    );
    // Simulate a transient read error on the linked Use Case note.
    failReadAt(fs, ucPath, appError("INIT_FAILED", "locked"));

    const result = await service.deletePrd("PRD-001");
    expect(result.ok).toBe(false);
    // The PRD note must survive — we couldn't prove it had no linked Use Cases.
    expect(fs.files.has("PRDs/PRD-001-dash/PRD-001-dash.md")).toBe(true);
  });

  it("serializes delete with create so a concurrent sub-PRD can't be orphaned", async () => {
    const { service, fs } = build();
    seedRoot(fs);
    seedSub(fs); // PRD-001 under PRD-000

    // Concurrently create a sub-PRD under PRD-001 and delete PRD-001. The shared
    // mutation lock makes these atomic: exactly one wins and the tree stays
    // consistent — no PRD is ever left pointing at a deleted parent.
    const [created, deleted] = await Promise.all([
      service.create({
        title: "Grandchild",
        parentPrdId: "PRD-001",
        domains: ["d"],
        vision: "v",
        scopeIn: ["a"],
        scopeOut: ["b"],
      }),
      service.deletePrd("PRD-001"),
    ]);

    if (created.ok) {
      // create landed first → PRD-001 now has a child, so delete must refuse.
      expect(deleted.ok).toBe(false);
    } else {
      // delete landed first → create must reject the now-missing parent.
      expect(deleted.ok).toBe(true);
      expect(created.ok).toBe(false);
    }
  });
});

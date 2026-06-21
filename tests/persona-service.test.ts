import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPersonaService } from "../src/application/services/persona-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { buildNote } from "../src/shared/utils/frontmatter";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types, events } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const svc = new DefaultPersonaService(settings, fs, bus, silentLogger);
  return { svc, fs, types, events };
};

describe("DefaultPersonaService", () => {
  it("creates a persona note and indexes it", async () => {
    const { svc } = build();
    const created = await svc.create({ name: "Home Cook" });
    expect(created.ok && created.value.id).toBe("PER-001");
    const all = await svc.findAll();
    expect(all.ok && all.value.map((p) => p.name)).toEqual(["Home Cook"]);
  });

  it("allocates PER-001 for the first persona and writes the note file", async () => {
    const { svc, fs } = build();
    const result = await svc.create({ name: "Home Cook" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("PER-001");
    expect(result.value.name).toBe("Home Cook");
    expect(result.value.path).toBe("Personas/PER-001 home-cook.md");
    expect(fs.files.has(result.value.path)).toBe(true);
  });

  it("allocates the next id from existing personas", async () => {
    const { svc, fs } = build();
    fs.files.set(
      "Personas/PER-001 cook.md",
      buildNote({ type: "persona", id: "PER-001", name: "Cook" }, "# Cook"),
    );

    const result = await svc.create({ name: "Baker" });
    expect(result.ok && result.value.id).toBe("PER-002");
  });

  it("serializes concurrent creates so two personas never share an id", async () => {
    const { svc, fs } = build();
    const [a, b] = await Promise.all([svc.create({ name: "Alice" }), svc.create({ name: "Bob" })]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(new Set([a.value.id, b.value.id]).size).toBe(2);
    expect(fs.files.size).toBe(2);
  });

  it("persists color when provided", async () => {
    const { svc, fs } = build();
    const result = await svc.create({ name: "Chef", color: "#ff5500" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.color).toBe("#ff5500");
    const note = fs.files.get(result.value.path) ?? "";
    expect(note).toContain("#ff5500");
  });

  it("persists body when provided", async () => {
    const { svc, fs } = build();
    const result = await svc.create({ name: "Chef", body: "A professional cook." });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = fs.files.get(result.value.path) ?? "";
    expect(note).toContain("A professional cook.");
  });

  it("emits persona.created with correct payload", async () => {
    const { svc, types, events } = build();
    const result = await svc.create({ name: "Home Cook" });

    expect(result.ok).toBe(true);
    expect(types()).toContain("persona.created");

    const created = events.find((e) => e.type === "persona.created");
    expect(created?.payload).toEqual({
      personaId: "PER-001",
      name: "Home Cook",
      path: "Personas/PER-001 home-cook.md",
    });
  });

  it("rejects a blank name", async () => {
    const { svc } = build();
    const result = await svc.create({ name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an empty name", async () => {
    const { svc } = build();
    const result = await svc.create({ name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("findOrCreateByName creates a persona when none with that name exists (PER-001)", async () => {
    const { svc, fs } = build();
    const result = await svc.findOrCreateByName("Home Cook");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("PER-001");
    expect(result.value.name).toBe("Home Cook");
    expect(fs.files.has(result.value.path)).toBe(true);
  });

  it("findOrCreateByName reuses an existing persona with the same name (no second note)", async () => {
    const { svc, fs } = build();
    const first = await svc.findOrCreateByName("Home Cook");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await svc.findOrCreateByName("Home Cook");
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.value.id);
    expect(fs.files.size).toBe(1);
  });

  it("findOrCreateByName matches on the trimmed name", async () => {
    const { svc, fs } = build();
    const first = await svc.findOrCreateByName("Home Cook");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await svc.findOrCreateByName("  Home Cook  ");
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.value.id);
    expect(fs.files.size).toBe(1);
  });

  it("concurrent findOrCreateByName of the same name yields ONE persona (serialized)", async () => {
    const { svc, fs } = build();
    const [a, b] = await Promise.all([
      svc.findOrCreateByName("Home Cook"),
      svc.findOrCreateByName("Home Cook"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.id).toBe(b.value.id);
    expect(fs.files.size).toBe(1);
  });

  it("findOrCreateByName rejects a blank name", async () => {
    const { svc } = build();
    const result = await svc.findOrCreateByName("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("findAll scans notes recursively and sorts by id", async () => {
    const { svc, fs } = build();
    fs.files.set(
      "Personas/PER-002 b.md",
      buildNote({ type: "persona", id: "PER-002", name: "Baker" }, "# Baker"),
    );
    fs.files.set(
      "Personas/PER-001 a.md",
      buildNote({ type: "persona", id: "PER-001", name: "Artist" }, "# Artist"),
    );
    // Not a persona — must be ignored
    fs.files.set(
      "Personas/Notes.md",
      buildNote({ type: "use-case", id: "UC-001", name: "Not a persona" }, "# Other"),
    );

    const result = await svc.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.id)).toEqual(["PER-001", "PER-002"]);
    expect(result.value.map((p) => p.name)).toEqual(["Artist", "Baker"]);
  });

  it("findAll returns empty list when the personas folder does not exist (ENOENT)", async () => {
    const { svc, fs } = build();
    // Simulate ENOENT by making listFilesRecursive fail with a "not found" error.
    const realList = fs.listFilesRecursive.bind(fs);
    fs.listFilesRecursive = async (path) => {
      if (path === "Personas") {
        return {
          ok: false,
          error: { code: "RUNNER_MISSING_FILE", message: "ENOENT: no such file" },
        };
      }
      return realList(path);
    };

    const result = await svc.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("findById returns the matching persona", async () => {
    const { svc, fs } = build();
    fs.files.set(
      "Personas/PER-002 b.md",
      buildNote({ type: "persona", id: "PER-002", name: "Baker" }, "# Baker"),
    );

    const found = await svc.findById("PER-002");
    expect(found.ok && found.value?.id).toBe("PER-002");
  });

  it("findById returns null for a missing id", async () => {
    const { svc } = build();
    const missing = await svc.findById("PER-999");
    expect(missing.ok && missing.value).toBe(null);
  });

  it("rename updates the note name in frontmatter and H1 without renaming the file", async () => {
    const { svc, types } = build();
    const created = await svc.create({ name: "Old Name" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const originalPath = created.value.path;

    const renamed = await svc.rename("PER-001", "New Name");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;

    // Path must be unchanged (id-stable)
    expect(renamed.value.path).toBe(originalPath);
    expect(renamed.value.name).toBe("New Name");
    expect(types()).toContain("persona.updated");

    // The file at the original path must contain the new name
    const all = await svc.findAll();
    expect(all.ok && all.value[0].name).toBe("New Name");
    expect(all.ok && all.value[0].path).toBe(originalPath);
  });

  it("rename rejects a blank name", async () => {
    const { svc } = build();
    await svc.create({ name: "Someone" });
    const result = await svc.rename("PER-001", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rename rejects an unknown id", async () => {
    const { svc } = build();
    const result = await svc.rename("PER-999", "Anything");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rename rejects a name already used by another persona (no duplicate names)", async () => {
    const { svc } = build();
    await svc.create({ name: "Home Cook" }); // PER-001
    await svc.create({ name: "Reviewer" }); // PER-002

    const result = await svc.rename("PER-002", "Home Cook");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    // PER-002 keeps its name; there is exactly one "Home Cook" (no duplicate the
    // user-materialization could later resolve to the wrong id).
    const all = await svc.findAll();
    expect(all.ok && all.value.map((p) => p.name).sort()).toEqual(["Home Cook", "Reviewer"]);
  });

  it("rename allows renaming a persona to its own current name (idempotent)", async () => {
    const { svc } = build();
    await svc.create({ name: "Home Cook" });
    const result = await svc.rename("PER-001", "Home Cook");
    expect(result.ok).toBe(true);
  });

  it("rename emits persona.updated with correct payload", async () => {
    const { svc, events } = build();
    await svc.create({ name: "Old" });

    await svc.rename("PER-001", "New");
    const updated = events.find((e) => e.type === "persona.updated");
    expect(updated?.payload).toMatchObject({ personaId: "PER-001", name: "New" });
  });

  it("rename preserves color and body", async () => {
    const { svc, fs } = build();
    const created = await svc.create({ name: "Old", color: "#abc", body: "Some bio." });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await svc.rename("PER-001", "New");

    // Re-read the persona from disk
    const all = await svc.findAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const persona = all.value[0];
    expect(persona.name).toBe("New");
    expect(persona.color).toBe("#abc");
    expect(persona.body).toContain("Some bio.");

    // Note file must contain the color frontmatter
    const note = fs.files.get(created.value.path) ?? "";
    expect(note).toContain("#abc");
  });
});

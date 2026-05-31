import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultUseCaseService, nextUseCaseId } from "../src/application/services/use-case-service";
import { buildDemoUseCaseNote } from "../src/application/content/demo-content";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { UseCase } from "../src/domain/entities/use-case";
import { buildNote } from "../src/shared/utils/frontmatter";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultUseCaseService(settings, fs, bus, silentLogger);
  return { service, fs, types };
};

describe("nextUseCaseId", () => {
  it("starts at UC-001 and increments past the highest existing id", () => {
    expect(nextUseCaseId([])).toBe("UC-001");
    expect(
      nextUseCaseId([
        { id: "UC-001" } as UseCase,
        { id: "UC-003" } as UseCase,
        { id: "not-a-uc" } as UseCase,
      ]),
    ).toBe("UC-004");
  });
});

describe("DefaultUseCaseService", () => {
  it("creates a Use Case with generated frontmatter and emits usecase.created", async () => {
    const { service, fs, types } = build();

    const result = await service.create({ title: "Checkout with a saved card" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("UC-001");
    expect(result.value.status).toBe("draft");
    expect(result.value.automationStatus).toBe("not-planned");
    expect(result.value.path).toBe("Use Cases/UC-001 Checkout with a saved card.md");
    expect(fs.files.has(result.value.path)).toBe(true);
    expect(types()).toContain("usecase.created");
  });

  it("collapses a multi-line description into a single frontmatter line", async () => {
    const { service } = build();
    const result = await service.create({
      title: "Multi",
      description: "First line.\nSecond line.\n\nThird.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBe("First line. Second line. Third.");
    // The written note must round-trip the full description (no truncation/corruption).
    const reread = await service.findAll();
    expect(reread.ok && reread.value[0].description).toBe("First line. Second line. Third.");
  });

  it("allocates the next id from existing use cases", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/UC-001 Demo.md",
      buildDemoUseCaseNote("Specifications/features/demo.feature"),
    );

    const result = await service.create({ title: "Second" });

    expect(result.ok && result.value.id).toBe("UC-002");
  });

  it("indexes use cases nested in subfolders (recursive)", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/archive/UC-002 Old.md",
      buildNote({ type: "use-case", id: "UC-002", title: "Old", status: "deprecated" }, "# UC-002"),
    );

    const all = await service.findAll();
    expect(all.ok && all.value.map((u) => u.id)).toEqual(["UC-002"]);

    // create() must see the nested id so it does not reallocate UC-002.
    const created = await service.create({ title: "New" });
    expect(created.ok && created.value.id).toBe("UC-003");
  });

  it("rejects an empty title", async () => {
    const { service } = build();
    const result = await service.create({ title: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("indexes only use-case notes, sorted by id", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/UC-002 Later.md",
      buildNote(
        { type: "use-case", id: "UC-002", title: "Later", status: "specified" },
        "# UC-002",
      ),
    );
    fs.files.set(
      "Use Cases/UC-001 First.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "First",
          automation_status: "passing",
          feature_file: "f.feature",
        },
        "# UC-001",
      ),
    );
    // Not a use case — must be ignored by the index.
    fs.files.set("Use Cases/Notes.md", buildNote({ type: "test-suite", id: "smoke" }, "# Suite"));

    const result = await service.findAll();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((u) => u.id)).toEqual(["UC-001", "UC-002"]);
    expect(result.value[0].automationStatus).toBe("passing");
    expect(result.value[0].featureFiles).toEqual(["f.feature"]);
  });

  it("findById returns the matching use case or null", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Use Cases/UC-002 Later.md",
      buildNote(
        { type: "use-case", id: "UC-002", title: "Later", status: "specified" },
        "# UC-002",
      ),
    );

    const found = await service.findById("UC-002");
    expect(found.ok && found.value?.id).toBe("UC-002");

    const missing = await service.findById("UC-999");
    expect(missing.ok && missing.value).toBe(null);
  });

  it("update drops the legacy singular feature_file so features aren't duplicated", async () => {
    const { service, fs } = build();
    // A note using the legacy `feature_file` key (e.g. the seeded demo).
    const path = "Use Cases/UC-001 Legacy.md";
    fs.files.set(
      path,
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "Legacy",
          feature_file: "Specifications/features/UC-001-happy-path.feature",
        },
        "# UC-001",
      ),
    );
    const loaded = await service.findById("UC-001");
    if (!loaded.ok || !loaded.value) throw new Error("expected UC-001");
    expect(loaded.value.featureFiles).toEqual([
      "Specifications/features/UC-001-happy-path.feature",
    ]);

    // Add a second feature and persist.
    await service.update({
      ...loaded.value,
      featureFiles: [
        ...loaded.value.featureFiles,
        "Specifications/features/UC-001-feature-2.feature",
      ],
    });

    // Re-read: no duplication from the old feature_file lingering.
    const reread = await service.findById("UC-001");
    if (!reread.ok || !reread.value) throw new Error("expected UC-001");
    expect(reread.value.featureFiles).toEqual([
      "Specifications/features/UC-001-happy-path.feature",
      "Specifications/features/UC-001-feature-2.feature",
    ]);
    expect(fs.files.get(path)).not.toContain("feature_file:");
  });

  it("update preserves the note body + unknown fields and emits usecase.updated", async () => {
    const { service, fs, types } = build();
    // A note with a hand-written body and a frontmatter field the builder
    // doesn't emit (owner) — both must survive a featureFiles link update.
    const path = "Use Cases/UC-001 Hand Edited.md";
    fs.files.set(
      path,
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "Hand Edited",
          status: "specified",
          owner: "qa-team",
        },
        "# UC-001\n\n## Notes\n\nHand-written analysis that must not be deleted.",
      ),
    );
    const loaded = await service.findById("UC-001");
    expect(loaded.ok && loaded.value).not.toBeNull();
    if (!loaded.ok || !loaded.value) return;

    const updated = await service.update({
      ...loaded.value,
      featureFiles: ["Specifications/features/UC-001-happy-path.feature"],
    });
    expect(updated.ok).toBe(true);

    const note = fs.files.get(path) ?? "";
    expect(note).toContain("Specifications/features/UC-001-happy-path.feature");
    expect(note).toContain("Hand-written analysis that must not be deleted.");
    expect(note).toContain("owner: qa-team"); // unknown field preserved
    expect(types()).toContain("usecase.updated");
  });
});

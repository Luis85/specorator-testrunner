import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import {
  DefaultUseCaseService,
  nextUseCaseId,
} from "../src/application/services/use-case-service";
import { buildDemoUseCaseNote } from "../src/application/content/demo-content";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { UseCase } from "../src/domain/entities/use-case";
import { buildNote } from "../src/shared/utils/frontmatter";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types } = recordingEventBus();
  const settings = new DefaultSettingsService(new FakeDataStore(), new DefaultPathSafetyPolicy(), bus);
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

  it("allocates the next id from existing use cases", async () => {
    const { service, fs } = build();
    fs.files.set("Use Cases/UC-001 Demo.md", buildDemoUseCaseNote("Specifications/features/demo.feature"));

    const result = await service.create({ title: "Second" });

    expect(result.ok && result.value.id).toBe("UC-002");
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
      buildNote({ type: "use-case", id: "UC-002", title: "Later", status: "specified" }, "# UC-002"),
    );
    fs.files.set(
      "Use Cases/UC-001 First.md",
      buildNote(
        { type: "use-case", id: "UC-001", title: "First", automation_status: "passing", feature_file: "f.feature" },
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
});

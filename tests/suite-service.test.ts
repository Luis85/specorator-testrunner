import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultSuiteService } from "../src/application/services/suite-service";
import { buildSuiteNote } from "../src/application/content/default-suites";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { buildNote } from "../src/shared/utils/frontmatter";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types } = recordingEventBus();
  const settings = new DefaultSettingsService(new FakeDataStore(), new DefaultPathSafetyPolicy(), bus);
  const service = new DefaultSuiteService(settings, fs, bus);
  return { service, fs, types };
};

describe("DefaultSuiteService", () => {
  it("creates a suite from a name, slugifying the id, and emits suite.created", async () => {
    const { service, fs, types } = build();

    const result = await service.create({
      name: "Checkout Smoke",
      description: "Critical checkout path.",
      tagExpression: "@smoke and not @wip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("checkout-smoke");
    expect(result.value.tagExpression).toBe("@smoke and not @wip");
    expect(result.value.path).toBe("Test Suites/Checkout Smoke.md");
    expect(fs.files.has(result.value.path)).toBe(true);
    expect(types()).toContain("suite.created");
  });

  it("rejects a name with no usable characters", async () => {
    const { service } = build();
    const result = await service.create({ name: "  !!!  ", tagExpression: "@smoke" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a blank tag expression", async () => {
    const { service } = build();
    const result = await service.create({ name: "Empty Tags", tagExpression: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a duplicate suite id", async () => {
    const { service } = build();
    const first = await service.create({ name: "Checkout", tagExpression: "@checkout" });
    expect(first.ok).toBe(true);
    // "Checkout!" slugifies to the same id "checkout".
    const dup = await service.create({ name: "Checkout!", tagExpression: "@checkout2" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("VALIDATION_FAILED");
  });

  it("collapses a multi-line description into a single frontmatter line", async () => {
    const { service, fs } = build();
    const result = await service.create({
      name: "Multi",
      description: "Line one.\nLine two.",
      tagExpression: "@smoke",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reread = await service.findAll();
    expect(reread.ok && reread.value[0].description).toBe("Line one. Line two.");
  });

  it("indexes suites nested in subfolders (recursive)", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Test Suites/archive/Old Suite.md",
      buildSuiteNote({ id: "old", name: "Old Suite", description: "", tagExpression: "@old" }),
    );
    const result = await service.findAll();
    expect(result.ok && result.value.map((s) => s.id)).toEqual(["old"]);
    expect((await service.resolveTagExpression("old")).ok).toBe(true);
  });

  it("createDefaults seeds the Smoke and Regression suites", async () => {
    const { service } = build();
    const result = await service.createDefaults();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.id)).toEqual(["smoke", "regression"]);
  });

  it("indexes only test-suite notes, sorted by id", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Test Suites/Regression Suite.md",
      buildSuiteNote({
        id: "regression",
        name: "Regression Suite",
        description: "Full set.",
        tagExpression: "@regression",
      }),
    );
    fs.files.set(
      "Test Suites/Smoke Suite.md",
      buildSuiteNote({
        id: "smoke",
        name: "Smoke Suite",
        description: "Critical path.",
        tagExpression: "@smoke",
      }),
    );
    // Not a suite — must be ignored by the index.
    fs.files.set("Test Suites/Notes.md", buildNote({ type: "use-case", id: "UC-001" }, "# UC"));

    const result = await service.findAll();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.id)).toEqual(["regression", "smoke"]);
    expect(result.value[0].name).toBe("Regression Suite");
    expect(result.value[1].tagExpression).toBe("@smoke");
  });

  it("resolveTagExpression returns a suite's tag expression verbatim", async () => {
    const { service, fs } = build();
    fs.files.set(
      "Test Suites/Smoke Suite.md",
      buildSuiteNote({
        id: "smoke",
        name: "Smoke Suite",
        description: "Critical path.",
        tagExpression: "@smoke and not @wip",
      }),
    );

    const result = await service.resolveTagExpression("smoke");

    expect(result.ok).toBe(true);
    // Literal per AD-4 — never rewritten.
    if (result.ok) expect(result.value).toBe("@smoke and not @wip");
  });

  it("resolveTagExpression fails with VALIDATION_FAILED when no suite has the id", async () => {
    const { service } = build();
    const result = await service.resolveTagExpression("does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

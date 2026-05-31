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
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
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

  it("sanitizes path separators / reserved chars in the suite filename", async () => {
    const { service, fs } = build();
    const result = await service.create({ name: "Checkout/Smoke?", tagExpression: "@checkout" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No subfolder and no reserved chars in the path; display name kept in note.
    expect(result.value.path).toBe("Test Suites/Checkout Smoke.md");
    expect(result.value.name).toBe("Checkout/Smoke?");
    expect(fs.files.has(result.value.path)).toBe(true);
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
    const { service } = build();
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

  it("skips a malformed suite note whose tag expression is empty (ADR-0011)", async () => {
    const { service, fs } = build();
    // A test-suite note missing tag_expression would resolve to "" — the
    // createSuite factory rejects it, so the index must omit it rather than
    // surface a suite that runs nothing.
    fs.files.set(
      "Test Suites/Broken.md",
      buildNote({ type: "test-suite", id: "broken", title: "Broken" }, "# Broken"),
    );
    const result = await service.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((s) => s.id === "broken")).toBe(false);
  });

  it("repairs a malformed same-id note at the target path instead of faking success (review)", async () => {
    const { service, fs, types } = build();
    // A malformed test-suite note (no tag_expression) is hidden from findAll, but
    // create() must still REPAIR it rather than emit suite.created over an
    // unresolvable note. Target path for "Smoke" is "Test Suites/Smoke.md".
    fs.files.set(
      "Test Suites/Smoke.md",
      buildNote({ type: "test-suite", id: "smoke", title: "Smoke" }, "# Smoke"),
    );
    const result = await service.create({ name: "Smoke", tagExpression: "@smoke" });
    expect(result.ok).toBe(true);
    expect(types()).toContain("suite.created");
    expect(fs.files.get("Test Suites/Smoke.md")).toContain("@smoke");
    const resolved = await service.resolveTagExpression("smoke");
    expect(resolved.ok && resolved.value).toBe("@smoke");
  });

  it("blocks a duplicate id even when the existing same-id note is malformed and elsewhere (review)", async () => {
    const { service, fs, types } = build();
    // A malformed same-id note at a DIFFERENT path is hidden from findAll; the
    // duplicate-id guard must still see it (via the full index) and refuse, so we
    // don't write a second note with the same id.
    fs.files.set(
      "Test Suites/archive/Old.md",
      buildNote({ type: "test-suite", id: "smoke", title: "Old Smoke" }, "# Old"),
    );
    const result = await service.create({ name: "Smoke", tagExpression: "@smoke" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    // No second note written at the new target path.
    expect(fs.files.has("Test Suites/Smoke.md")).toBe(false);
    expect(types()).not.toContain("suite.created");
  });

  it("rejects create() for a valid same-id suite already at the target path (review)", async () => {
    const { service, fs, types } = build();
    // A valid suite already exists at the target path with a DIFFERENT tag
    // expression. create() must reject (not silently keep the old on-disk note
    // while returning the new tag expression) — createDefaults' idempotent skip
    // is "seed" mode only.
    const old = buildSuiteNote({
      id: "smoke",
      name: "Smoke",
      description: "",
      tagExpression: "@old",
    });
    fs.files.set("Test Suites/Smoke.md", old);
    const result = await service.create({ name: "Smoke", tagExpression: "@new" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    // On-disk note is untouched and no duplicate event was emitted.
    expect(fs.files.get("Test Suites/Smoke.md")).toBe(old);
    expect(types()).not.toContain("suite.created");
  });

  it("createDefaults is idempotent: re-seeding an existing default suite is not an error", async () => {
    const { service } = build();
    expect((await service.createDefaults()).ok).toBe(true);
    // Second run (e.g. a UC-024 reset) must succeed, not fail on "duplicate id".
    const second = await service.createDefaults();
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.map((s) => s.id)).toEqual(["smoke", "regression"]);
  });

  it("refuses to clobber a foreign / different-id note at the target path (review)", async () => {
    const { service, fs, types } = build();
    // A non-suite note that merely collides on the sanitized filename must be
    // preserved verbatim, not overwritten.
    const foreign = buildNote({ type: "use-case", id: "UC-001" }, "# my notes");
    fs.files.set("Test Suites/Smoke.md", foreign);
    const result = await service.create({ name: "Smoke", tagExpression: "@smoke" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(fs.files.get("Test Suites/Smoke.md")).toBe(foreign);
    expect(types()).not.toContain("suite.created");
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

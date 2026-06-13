import { describe, expect, it } from "vitest";
import { DefaultPrdService } from "../src/application/services/prd-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types, events } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultPrdService(settings, fs, bus, silentLogger);
  return { service, fs, types, events };
};

describe("DefaultPrdService.create", () => {
  it("creates a sub-PRD folder + note and emits prd.created", async () => {
    const { service, fs, types, events } = build();

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

describe("DefaultPrdService.assignUseCaseToPrd", () => {
  it("adds prd-id to the use case note, preserving other frontmatter", async () => {
    const { service, fs } = build();
    const ucPath = "Use Cases/UC-001 Init.md";
    fs.files.set(
      ucPath,
      [
        "---",
        "id: UC-001",
        "type: use-case",
        "title: Init",
        "domain: Installation",
        "status: specified",
        "---",
        "# UC-001 Init",
        "",
      ].join("\n"),
    );

    const result = await service.assignUseCaseToPrd(
      // pass a VaultPath; in tests use unsafeVaultPath
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ucPath as any,
      "PRD-001",
    );
    expect(result.ok).toBe(true);
    const updated = fs.files.get(ucPath) ?? "";
    expect(updated).toContain("prd-id: PRD-001");
    expect(updated).toContain("domain: Installation"); // preserved
    expect(updated).toContain("# UC-001 Init"); // body preserved
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

  it("never deletes the root PRD-000", async () => {
    const { service, fs } = build();
    seedRoot(fs);

    const result = await service.deletePrd("PRD-000");
    expect(result.ok).toBe(false);
    expect(fs.files.has("PRDs/PRD-000-vision/PRD-000-vision.md")).toBe(true);
  });
});

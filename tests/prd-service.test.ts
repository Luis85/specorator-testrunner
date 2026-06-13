import { describe, expect, it } from "vitest";
import { DefaultPrdService } from "../src/application/services/prd-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types, events } = recordingEventBus();
  const settings = new DefaultSettingsService(new FakeDataStore(), new DefaultPathSafetyPolicy(), bus);
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
    fs.files.set("PRDs/PRD-000-product-vision/PRD-000-product-vision.md", "---\nid: PRD-000\ntype: prd\n---\n");
    fs.files.set("PRDs/PRD-001-x/PRD-001-x.md", "---\nid: PRD-001\ntype: prd\n---\n");

    const result = await service.create({
      title: "Second", parentPrdId: "PRD-000", domains: ["d"], vision: "v", scopeIn: ["a"], scopeOut: ["b"],
    });
    expect(result.ok && result.value.id).toBe("PRD-002");
  });
});

describe("DefaultPrdService.findAll/parse", () => {
  it("parses PRD notes and normalizes empty parent-prd to root", async () => {
    const { service, fs } = build();
    fs.files.set(
      "PRDs/PRD-000-product-vision/PRD-000-product-vision.md",
      ["---", "id: PRD-000", "type: prd", "title: Vision", "status: active", "parent-prd:", "vision: V", "display_order: 0", "---", "# PRD-000: Vision", ""].join("\n"),
    );
    fs.files.set(
      "PRDs/PRD-001-dash/PRD-001-dash.md",
      ["---", "id: PRD-001", "type: prd", "title: Dash", "status: draft", "parent-prd: PRD-000", "domains:", "  - dashboard", "vision: V", "scope_in:", "  - tiles", "scope_out:", "  - exports", "display_order: 1", "---", "# PRD-001: Dash", ""].join("\n"),
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
    fs.files.set(ucPath, ["---", "id: UC-001", "type: use-case", "title: Init", "domain: Installation", "status: specified", "---", "# UC-001 Init", ""].join("\n"));

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

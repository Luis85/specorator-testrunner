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

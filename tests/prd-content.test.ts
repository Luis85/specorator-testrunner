import { describe, expect, it } from "vitest";
import { prdFolderName, buildPrdNote } from "../src/application/content/prd-content";
import type { Prd } from "../src/domain/entities/prd";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const samplePrd = (overrides: Partial<Prd> = {}): Prd => ({
  id: "PRD-001",
  title: "Dashboard & KPI Tracking",
  status: "draft",
  parentPrdId: "PRD-000",
  domains: ["dashboard", "reporting"],
  vision: "Single source of truth for test health",
  scopeIn: ["KPI tiles", "recent runs"],
  scopeOut: ["historical analytics"],
  displayOrder: 1,
  path: unsafeVaultPath("PRDs/PRD-001-dashboard-kpi-tracking/PRD-001-dashboard-kpi-tracking.md"),
  ...overrides,
});

describe("prdFolderName", () => {
  it("kebab-cases the title and prefixes the id", () => {
    expect(prdFolderName("PRD-001", "Dashboard & KPI Tracking")).toBe(
      "PRD-001-dashboard-kpi-tracking",
    );
  });
});

describe("buildPrdNote", () => {
  it("emits block-sequence arrays and an H1 heading", () => {
    const note = buildPrdNote(samplePrd());
    expect(note).toContain("id: PRD-001");
    expect(note).toContain("type: prd");
    expect(note).toContain("parent-prd: PRD-000");
    expect(note).toContain("domains:\n  - dashboard\n  - reporting");
    expect(note).toContain("scope_in:\n  - KPI tiles\n  - recent runs");
    expect(note).toContain("# PRD-001: Dashboard & KPI Tracking");
    // never inline arrays
    expect(note).not.toContain("[dashboard");
  });

  it("writes an empty parent-prd and omits domains for the root PRD", () => {
    const note = buildPrdNote(
      samplePrd({ id: "PRD-000", parentPrdId: undefined, domains: [], displayOrder: 0 }),
    );
    // empty parent-prd line (root marker), no literal null
    expect(note).toMatch(/parent-prd:\s*\n/);
    expect(note).not.toContain("null");
    expect(note).not.toContain("domains:");
  });
});

import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs migration helper, no type declarations
import { buildPrdNote, prdFolderName } from "../scripts/lib/prd-note.mjs";

describe("prdFolderName", () => {
  it("kebab-cases the title and prefixes the id", () => {
    expect(prdFolderName("PRD-000", "Product Vision")).toBe("PRD-000-product-vision");
    expect(prdFolderName("PRD-001", "Spec Authoring")).toBe("PRD-001-spec-authoring");
  });
});

describe("buildPrdNote", () => {
  it("writes block-sequence arrays, never inline brackets", () => {
    const note = buildPrdNote({
      id: "PRD-001",
      title: "Spec Authoring",
      status: "draft",
      parentPrdId: "PRD-000",
      domains: ["dashboard", "specifications"],
      vision: "Author specs without leaving Obsidian.",
      scopeIn: ["Feature editor"],
      scopeOut: ["Cloud sync"],
      displayOrder: 1,
    });

    expect(note).toContain("domains:\n  - dashboard\n  - specifications");
    expect(note).not.toContain("[dashboard");
    expect(note).toContain("scope_in:\n  - Feature editor");
    expect(note).toContain("scope_out:\n  - Cloud sync");
  });

  it("renders the H1 as `# <id>: <title>`", () => {
    const note = buildPrdNote({
      id: "PRD-001",
      title: "Spec Authoring",
      status: "draft",
      parentPrdId: "PRD-000",
      domains: [],
      vision: "v",
      scopeIn: [],
      scopeOut: [],
      displayOrder: 1,
    });
    expect(note).toContain("# PRD-001: Spec Authoring");
  });

  it("writes an empty parent-prd line for a root PRD (no literal null)", () => {
    const note = buildPrdNote({
      id: "PRD-000",
      title: "Product Vision",
      status: "active",
      parentPrdId: undefined,
      domains: [],
      vision: "The product vision.",
      scopeIn: [],
      scopeOut: [],
      displayOrder: 0,
    });

    expect(note).toContain("\nparent-prd:\n");
    expect(note).not.toContain("parent-prd: null");
    expect(note).not.toContain("parent-prd:null");
  });

  it("omits empty domains/scope arrays from the frontmatter", () => {
    const note = buildPrdNote({
      id: "PRD-000",
      title: "Product Vision",
      status: "active",
      parentPrdId: undefined,
      domains: [],
      vision: "v",
      scopeIn: [],
      scopeOut: [],
      displayOrder: 0,
    });
    expect(note).not.toContain("domains:");
    expect(note).not.toContain("scope_in:");
    expect(note).not.toContain("scope_out:");
  });
});

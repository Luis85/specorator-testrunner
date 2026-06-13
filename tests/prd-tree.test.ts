import { describe, expect, it } from "vitest";
import { buildPrdTree } from "../src/presentation/views/prd-explorer-view";
import type { Prd } from "../src/domain/entities/prd";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const prd = (id: string, parent: string | undefined, order: number): Prd => ({
  id,
  title: id,
  status: "draft",
  parentPrdId: parent,
  domains: [],
  vision: "",
  scopeIn: [],
  scopeOut: [],
  displayOrder: order,
  path: unsafeVaultPath(`PRDs/${id}/${id}.md`),
});

describe("buildPrdTree", () => {
  it("nests sub-PRDs under root and orders by displayOrder", () => {
    const tree = buildPrdTree(
      [prd("PRD-002", "PRD-000", 2), prd("PRD-000", undefined, 0), prd("PRD-001", "PRD-000", 1)],
      new Map([["PRD-001", 4]]),
    );
    expect(tree.map((n) => n.prd.id)).toEqual(["PRD-000"]);
    expect(tree[0].children.map((n) => n.prd.id)).toEqual(["PRD-001", "PRD-002"]);
    expect(tree[0].children[0].ucCount).toBe(4);
    expect(tree[0].children[1].ucCount).toBe(0);
  });

  it("treats a PRD with an unknown parent as a root (orphan tolerance)", () => {
    const tree = buildPrdTree([prd("PRD-005", "PRD-999", 0)], new Map());
    expect(tree.map((n) => n.prd.id)).toEqual(["PRD-005"]);
  });

  it("breaks displayOrder ties by id", () => {
    const tree = buildPrdTree(
      [prd("PRD-002", "PRD-000", 1), prd("PRD-001", "PRD-000", 1), prd("PRD-000", undefined, 0)],
      new Map(),
    );
    expect(tree[0].children.map((n) => n.prd.id)).toEqual(["PRD-001", "PRD-002"]);
  });
});

import { describe, expect, it } from "vitest";
import { projectPrdRoadmap } from "../src/presentation/views/dashboard-prd-projection";
import type { Prd } from "../src/domain/entities/prd";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const prd = (
  id: string,
  parent: string | undefined,
  order: number,
  over: Partial<Prd> = {},
): Prd => ({
  id,
  title: `${id} title`,
  status: "active",
  parentPrdId: parent,
  domains: [],
  vision: id === "PRD-000" ? "The product vision" : "",
  scopeIn: [],
  scopeOut: [],
  displayOrder: order,
  path: unsafeVaultPath(`PRDs/${id}/${id}.md`),
  ...over,
});

describe("projectPrdRoadmap", () => {
  it("projects the root card and its ordered sub-PRDs with counts", () => {
    const roadmap = projectPrdRoadmap(
      [prd("PRD-002", "PRD-000", 2), prd("PRD-000", undefined, 0), prd("PRD-001", "PRD-000", 1)],
      new Map([
        ["PRD-000", 1],
        ["PRD-001", 4],
        ["PRD-002", 2],
      ]),
    );

    expect(roadmap.root).toEqual({
      id: "PRD-000",
      title: "PRD-000 title",
      vision: "The product vision",
      status: "active",
      subPrdCount: 2,
      totalUseCases: 7,
    });
    expect(roadmap.children).toEqual([
      { id: "PRD-001", title: "PRD-001 title", status: "active", ucCount: 4 },
      { id: "PRD-002", title: "PRD-002 title", status: "active", ucCount: 2 },
    ]);
  });

  it("returns a null root when there are no PRDs", () => {
    expect(projectPrdRoadmap([], new Map())).toEqual({ root: null, children: [] });
  });
});

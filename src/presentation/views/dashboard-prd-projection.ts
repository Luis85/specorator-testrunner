import type { Prd } from "../../domain/entities/prd";

export interface PrdRoadmapChild {
  id: string;
  title: string;
  status: string;
  ucCount: number;
}

export interface PrdRoadmapRoot {
  id: string;
  title: string;
  vision: string;
  status: string;
  subPrdCount: number;
  /** Use Cases linked to the root and its direct sub-PRDs. */
  totalUseCases: number;
}

export interface PrdRoadmap {
  root: PrdRoadmapRoot | null;
  children: PrdRoadmapChild[];
}

/**
 * Pure dashboard projection of the PRD hierarchy: the root product-vision card
 * plus its direct sub-PRDs (ordered by displayOrder, id as tiebreak) with their
 * Use Case counts. Returns a null root when no PRDs exist yet.
 */
export const projectPrdRoadmap = (prds: Prd[], ucCounts: Map<string, number>): PrdRoadmap => {
  const root =
    prds.find((p) => p.id === "PRD-000") ?? prds.find((p) => p.parentPrdId === undefined);
  if (!root) return { root: null, children: [] };

  const count = (id: string): number => ucCounts.get(id) ?? 0;
  const children = prds
    .filter((p) => p.parentPrdId === root.id)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))
    .map((p) => ({ id: p.id, title: p.title, status: p.status, ucCount: count(p.id) }));
  const totalUseCases = count(root.id) + children.reduce((sum, c) => sum + c.ucCount, 0);

  return {
    root: {
      id: root.id,
      title: root.title,
      vision: root.vision,
      status: root.status,
      subPrdCount: children.length,
      totalUseCases,
    },
    children,
  };
};

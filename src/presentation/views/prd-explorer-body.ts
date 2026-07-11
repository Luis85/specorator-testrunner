import type { Prd } from "../../domain/entities/prd";

/**
 * The pure PRD-tree projection (ADR-0033 Phase 3): the rendering moved to the
 * Vue-native `PrdExplorerBody`/`PrdNode` components, but the tree shaping stays a
 * framework-agnostic, unit-tested projection consumed by those components (and
 * re-exported from `prd-explorer-view` for its historical test path).
 */
export interface PrdTreeNode {
  prd: Prd;
  ucCount: number;
  children: PrdTreeNode[];
}

/**
 * Build the single-parent PRD tree from a flat list plus per-PRD Use Case
 * counts. Sub-PRDs nest under their parent; a PRD whose parent is missing is
 * treated as a root (orphan tolerance). Siblings sort by `displayOrder` then id
 * — ids are immutable, so reordering never renames them.
 */
export const buildPrdTree = (prds: Prd[], ucCounts: Map<string, number>): PrdTreeNode[] => {
  const nodes = new Map<string, PrdTreeNode>();
  for (const prd of prds) {
    nodes.set(prd.id, { prd, ucCount: ucCounts.get(prd.id) ?? 0, children: [] });
  }
  const roots: PrdTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.prd.parentPrdId ? nodes.get(node.prd.parentPrdId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: PrdTreeNode[]): void => {
    list.sort(
      (a, b) => a.prd.displayOrder - b.prd.displayOrder || a.prd.id.localeCompare(b.prd.id),
    );
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
};

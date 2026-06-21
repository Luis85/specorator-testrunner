import { Notice, type WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { PrdService } from "../../application/services/prd-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { Prd } from "../../domain/entities/prd";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { buttonElementControl, wireConfirmAction } from "./confirm-action";
import { openOrNotice, renderEmptyState, renderLoadError } from "./modal-helpers";
import { LiveDashboardView } from "./live-dashboard-view";

export const PRD_VIEW_TYPE = "e2e-test-hub-prds";

/**
 * Refresh the tree when a PRD is created/deleted or a Use Case's PRD link
 * changes (the per-PRD Use Case counts depend on `prd-id`).
 */
const REFRESH_ON: DomainEventType[] = [
  "prd.created",
  "prd.deleted",
  "usecase.created",
  "usecase.updated",
];

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

export interface PrdExplorerDeps {
  prdService: PrdService;
  useCaseService: UseCaseService;
  workspace: WorkspacePort;
  eventBus: EventBus;
  /** Opens the PRD Builder; a node's "＋ sub-PRD" button passes its id as parent. */
  openPrdBuilder: (parentPrdId?: string) => void;
}

/**
 * Live "PRDs" panel: the hierarchical PRD tree (root product vision → sub-PRDs)
 * with per-PRD Use Case counts. Mirrors the Suites explorer (ItemView +
 * LiveRefresh). Ids are immutable; the tree orders by `displayOrder`.
 */
export class PrdExplorerView extends LiveDashboardView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: PrdExplorerDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
  }

  getViewType(): string {
    return PRD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "PRDs";
  }

  getIcon(): string {
    return "git-fork";
  }

  protected async render(): Promise<void> {
    const container = this.renderListHeader({
      headerCls: "e2e-test-hub-prd-header",
      title: "PRDs",
      actionLabel: "New PRD",
      onAction: () => this.deps.openPrdBuilder(),
    });

    const [prds, counts] = await Promise.all([
      this.deps.prdService.findAll(),
      this.deps.useCaseService.countUseCasesByPrd(),
    ]);
    if (!prds.ok) {
      renderLoadError(
        container,
        `Could not load PRDs: ${prds.error.message}`,
        "Retry loading the PRDs",
        () => void this.live.schedule(),
      );
      return;
    }

    if (prds.value.length === 0) {
      renderEmptyState(
        container,
        "No PRDs yet. Create PRD-000 (the product vision) to get started.",
      );
      return;
    }

    const tree = buildPrdTree(prds.value, counts.ok ? counts.value : new Map<string, number>());
    const root = container.createEl("ul", { cls: "e2e-test-hub-prd-tree" });
    for (const node of tree) this.renderNode(root, node);
  }

  private renderNode(parent: HTMLElement, node: PrdTreeNode): void {
    const li = parent.createEl("li", { cls: "e2e-test-hub-prd-node" });
    const row = li.createDiv({ cls: "e2e-test-hub-prd-row" });

    const ucs = node.ucCount === 1 ? "1 UC" : `${node.ucCount} UCs`;
    const open = row.createEl("button", {
      text: `${node.prd.id}: ${node.prd.title} (${ucs})`,
      cls: "e2e-test-hub-link-button",
      attr: { "aria-label": `Open PRD ${node.prd.id} ${node.prd.title}` },
    });
    open.addEventListener("click", () => void openOrNotice(this.deps.workspace, node.prd.path));

    row.createEl("span", {
      text: node.prd.status,
      cls: "spec-pill",
      attr: { "data-status": node.prd.status },
    });

    row
      .createEl("button", {
        text: "＋ sub-PRD",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Add a sub-PRD under ${node.prd.id}` },
      })
      .addEventListener("click", () => this.deps.openPrdBuilder(node.prd.id));

    // The root PRD anchors the tree and is never deletable (the service also
    // refuses it); only offer Delete on sub-PRDs.
    if (node.prd.parentPrdId !== undefined) {
      const deleteButton = row.createEl("button", {
        text: "Delete",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": `Delete PRD ${node.prd.id}` },
      });
      // 05-M3 safety fix: gate the (previously immediate) delete behind the same
      // two-click arm/disarm confirm the rest of the app uses for destructive
      // actions. Disarms on blur too, since a tree row is easy to tab away from.
      wireConfirmAction(buttonElementControl(deleteButton), {
        config: {
          idleLabel: "Delete",
          armedLabel: "Delete — click again to confirm",
          destructiveWhenIdle: false,
        },
        onConfirm: () => void this.deletePrd(node.prd),
        disarmOnBlur: true,
      });
    }

    if (node.children.length > 0) {
      const childList = li.createEl("ul", { cls: "e2e-test-hub-prd-tree" });
      for (const child of node.children) this.renderNode(childList, child);
    }
  }

  private async deletePrd(prd: Prd): Promise<void> {
    const result = await this.deps.prdService.deletePrd(prd.id);
    if (!result.ok) {
      new Notice(`Could not delete ${prd.id}: ${result.error.message}`);
      return;
    }
    const preserved = result.value.preservedFiles;
    const suffix =
      preserved > 0 ? ` (kept ${preserved} other file${preserved === 1 ? "" : "s"})` : "";
    new Notice(`Deleted ${prd.id}${suffix}.`);
    void this.live.schedule();
  }
}

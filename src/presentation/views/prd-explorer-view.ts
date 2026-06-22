import { type WorkspaceLeaf } from "obsidian";
import type { PrdService } from "../../application/services/prd-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { renderPrdExplorerBody } from "./prd-explorer-body";
import { LiveDashboardView } from "./live-dashboard-view";
import { type NavigationTarget } from "../navigation/navigation-target";

// `buildPrdTree` is re-exported because tests/prd-tree.test.ts imports it from
// this module (its historical home); the tree types live with the body now.
export { buildPrdTree } from "./prd-explorer-body";

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

export interface PrdExplorerDeps {
  prdService: PrdService;
  useCaseService: UseCaseService;
  eventBus: EventBus;
  /** Opens the PRD Builder; a node's "＋ sub-PRD" button passes its id as parent. */
  openPrdBuilder: (parentPrdId?: string) => void;
  // WS-A4/B4 deep-link port: a PRD row opens the PRD itself (by id) and gains an
  // affordance to jump into its Use Cases (the first linked UC's detail, 01-§3.2)
  // — both through the one unified navigator.
  navigate: (target: NavigationTarget) => void;
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
    // Thin caller: the body builds entirely into this leaf's `contentEl` via the
    // host-agnostic renderer, so the standalone leaf and the (later) Test Hub
    // body render identically (ADR-0031).
    await renderPrdExplorerBody(this.contentEl, {
      prdService: this.deps.prdService,
      useCaseService: this.deps.useCaseService,
      openPrdBuilder: this.deps.openPrdBuilder,
      navigate: this.deps.navigate,
      refresh: () => void this.live.schedule(),
    });
  }
}

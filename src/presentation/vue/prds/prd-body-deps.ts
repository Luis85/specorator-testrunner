import type { PrdService } from "../../../application/services/prd-service";
import type { UseCaseService } from "../../../application/services/use-case-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { NavigationTarget } from "../../navigation/navigation-target";

/**
 * Everything {@link PrdExplorerBody} needs to load, render, and stay live — the
 * services it reads, the deep-link/navigation callbacks, the PRD-Builder opener,
 * and the bus it subscribes its own refresh to (ADR-0033). The standalone PRDs
 * leaf and the hub's Plan section both construct this and pass it as a prop; the
 * body's `refresh` is internal (a useEventBus binding), so it is NOT a dep.
 */
export interface PrdBodyDeps {
  prdService: PrdService;
  useCaseService: UseCaseService;
  /** Opens the PRD Builder; a node's "＋ sub-PRD" button passes its id as parent. */
  openPrdBuilder: (parentPrdId?: string) => void;
  // WS-A4/B4 deep-link port: a PRD row opens the PRD itself (by id) and gains an
  // affordance to jump into its Use Cases (the first linked UC's detail), both
  // through the one unified navigator.
  navigate: (target: NavigationTarget) => void;
  eventBus: EventBus;
}

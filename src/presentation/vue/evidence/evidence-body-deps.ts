import type { RunHistoryService } from "../../../application/services/run-history-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { NavigationTarget } from "../../navigation/navigation-target";

/**
 * Everything {@link EvidenceExplorerBody} needs to load, render, and stay live —
 * the run-history service it reads, the deep-link navigate callback, and the bus
 * it subscribes its own refresh to (ADR-0033). The standalone Evidence Explorer
 * leaf and the hub's Review section both construct this and pass it as a prop.
 *
 * The status `filter` and paging `visibleLimit` are NOT here: they are ephemeral
 * view-state, passed as SEPARATE reactive props. The hub feeds them from its
 * Pinia store (so they survive a section switch, which unmounts the body); the
 * standalone leaf omits them and the component keeps its own local state for the
 * leaf's lifetime (it never unmounts mid-life).
 */
export interface EvidenceBodyDeps {
  runHistory: RunHistoryService;
  navigate: (target: NavigationTarget) => void;
  eventBus: EventBus;
}

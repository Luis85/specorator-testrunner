import type { InjectionKey } from "vue";
import type { GuidedTourViewDeps } from "../../views/guided-tour-view";

/**
 * The provide/inject key carrying the Guided Tour leaf's dependency slice
 * (tour service + event bus + action flows) from the view's `onOpen` into the
 * mounted Vue component tree (ADR-0033). A `type`-only import of the deps shape
 * keeps this free of a runtime cycle with the view module.
 */
export const GUIDED_TOUR_DEPS = Symbol("guided-tour-deps") as InjectionKey<GuidedTourViewDeps>;

import type { GuidedTourService } from "../../../application/services/guided-tour-service";
import type { TourActionId } from "../../../domain/onboarding/tour-steps";
import type { EventBus } from "../../../shared/event-bus/event-bus";

/**
 * The docked onboarding rail's deps (ADR-0033 Phase 3): the live inputs it
 * resolves (init signal, Use Case count, tour state), the tour service it reads +
 * calls through, the action-dispatch router, and the CTAs. Hub-only; the
 * `collapsed`/`onToggleCollapsed` chrome is a reactive PROP pair (fed from the
 * Pinia hub store), and `refresh` is internal (a useEventBus binding).
 */
export interface OnboardingBodyDeps {
  /** Real init signal — does the Test Hub vault structure exist (mirrors the hero)? */
  isInitialized: () => Promise<boolean>;
  /** The snapshot's totalUseCases, or `null` when the snapshot read FAILED. */
  ucCount: () => Promise<number | null>;
  /** The tour service the rail READS + dismiss/restart/markDone/skip CALLS through. */
  tour: Pick<GuidedTourService, "getState" | "dismiss" | "restart" | "markDone" | "skip">;
  /** Routes a tour step's action button (the shared dispatchTourAction). */
  dispatchTourAction: (id: TourActionId) => void;
  /** Opens the setup wizard from the Initialize CTA. */
  openWizard: () => void;
  /** Primary first-Use-Case CTA: create a Use Case. */
  openCreateUseCase: () => void;
  /** Secondary first-Use-Case aside: start (restart) the guided tour. */
  startTour: () => void | Promise<void>;
  eventBus: EventBus;
}

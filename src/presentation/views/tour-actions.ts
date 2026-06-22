import type { TourActionId } from "../../domain/onboarding/tour-steps";

/**
 * The action-id → flow routing for a tour step's action button, extracted so the
 * sidebar GuidedTourView and the hub's onboarding rail (WS-B2 PR3) dispatch every
 * step IDENTICALLY rather than each carrying its own copy of the switch. Every
 * flow is an EXISTING action (modal, launcher, workspace, command body) — the
 * tour guides, it never re-implements one (spec 2026-06-11).
 */
export interface TourActionFlows {
  runDemo: () => void | Promise<void>;
  openCreateUseCase: () => void;
  openUseCases: () => void | Promise<void>;
  openCreateSuite: () => void;
  openSuites: () => void | Promise<void>;
  openLatestEvidence: () => void;
  generateCiWorkflow: () => Promise<void>;
}

/** Routes one {@link TourActionId} to its flow (exhaustive — no default). */
export const dispatchTourAction = (id: TourActionId, flows: TourActionFlows): void => {
  switch (id) {
    case "run-demo":
      void flows.runDemo();
      return;
    case "open-create-use-case":
      flows.openCreateUseCase();
      return;
    case "open-use-cases":
      void flows.openUseCases();
      return;
    case "open-create-suite":
      flows.openCreateSuite();
      return;
    case "open-suites":
      void flows.openSuites();
      return;
    case "open-latest-evidence":
      flows.openLatestEvidence();
      return;
    case "generate-ci":
      void flows.generateCiWorkflow();
      return;
  }
};

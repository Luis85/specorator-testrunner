import type { WorkspaceLeaf } from "obsidian";
import type { GuidedTourService } from "../../application/services/guided-tour-service";
import type { TourActionId } from "../../domain/onboarding/tour-steps";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { projectTour, TOUR_DONE_MESSAGE } from "./guided-tour-rows";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderTourStep } from "./tour-step-body";

export const GUIDED_TOUR_VIEW_TYPE = "e2e-test-hub-guided-tour";

/**
 * Callbacks the tour's action buttons dispatch to. Every callback is wired in
 * main.ts to an EXISTING flow (modal, launcher, workspace, command body) — the
 * tour guides, it never re-implements an action (spec 2026-06-11).
 */
export interface GuidedTourViewDeps {
  tour: GuidedTourService;
  eventBus: EventBus;
  runDemo: () => void | Promise<void>;
  openCreateUseCase: () => void;
  openUseCases: () => void | Promise<void>;
  openCreateSuite: () => void;
  openSuites: () => void | Promise<void>;
  openLatestEvidence: () => void;
  generateCiWorkflow: () => Promise<void>;
}

/**
 * The Guided Tour: a right-sidebar checklist over the full V1 loop that
 * auto-advances as the GuidedTourService observes the user's real actions.
 */
export class GuidedTourView extends LiveDashboardView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: GuidedTourViewDeps,
  ) {
    // tour.* drives progress repaints; evidence.generated flips the manual
    // step's in-memory "armed" hint, which publishes no tour event.
    super(leaf, deps.eventBus, [
      "tour.started",
      "tour.step.completed",
      "tour.step.skipped",
      "tour.completed",
      "evidence.generated",
    ]);
  }

  getViewType(): string {
    return GUIDED_TOUR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Guided tour";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  protected render(): void {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Guided tour" });

    const model = projectTour(this.deps.tour.getState());
    container.createDiv({ cls: "e2e-test-hub-tour-progress", text: model.progressLabel });

    if (model.completed) {
      container.createEl("p", { text: TOUR_DONE_MESSAGE });
    } else {
      container.createEl("p", {
        text: "Each step completes by itself when you perform the real action.",
        cls: "e2e-test-hub-tour-hint",
      });
    }

    for (const row of model.rows) {
      renderTourStep(container, row, {
        dispatch: (id) => this.dispatch(id),
        markDone: (id) => void this.deps.tour.markDone(id),
        skip: (id) => void this.deps.tour.skip(id),
      });
    }

    const footer = container.createDiv({ cls: "e2e-test-hub-tour-actions" });
    const restart = footer.createEl("button", {
      text: "Restart tour",
      attr: { "aria-label": "Restart the guided tour from the beginning" },
    });
    restart.addEventListener("click", () => void this.deps.tour.restart());
    if (!model.dismissed && !model.completed) {
      const dismiss = footer.createEl("button", {
        text: "Dismiss",
        attr: { "aria-label": "Hide the guided tour call to action on the dashboard" },
      });
      dismiss.addEventListener("click", () => void this.deps.tour.dismiss());
    }
  }

  private dispatch(id: TourActionId): void {
    switch (id) {
      case "run-demo":
        void this.deps.runDemo();
        break;
      case "open-create-use-case":
        this.deps.openCreateUseCase();
        break;
      case "open-use-cases":
        void this.deps.openUseCases();
        break;
      case "open-create-suite":
        this.deps.openCreateSuite();
        break;
      case "open-suites":
        void this.deps.openSuites();
        break;
      case "open-latest-evidence":
        this.deps.openLatestEvidence();
        break;
      case "generate-ci":
        void this.deps.generateCiWorkflow();
        break;
    }
  }
}

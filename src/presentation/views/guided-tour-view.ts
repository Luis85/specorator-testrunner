import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import type { GuidedTourService } from "../../application/services/guided-tour-service";
import type { TourActionId } from "../../domain/onboarding/tour-steps";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { projectTour, TOUR_DONE_MESSAGE, type TourStepRow } from "./guided-tour-rows";
import { RenderScheduler } from "./render-scheduler";

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
export class GuidedTourView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly scheduler = new RenderScheduler(() => Promise.resolve(this.render()));

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: GuidedTourViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return GUIDED_TOUR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Guided Tour";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen(): Promise<void> {
    // tour.* drives progress repaints; evidence.generated flips the manual
    // step's in-memory "armed" hint, which publishes no tour event.
    for (const type of [
      "tour.started",
      "tour.step.completed",
      "tour.step.skipped",
      "tour.completed",
      "evidence.generated",
    ] as const) {
      this.subscriptions.push(this.deps.eventBus.subscribe(type, () => this.scheduler.schedule()));
    }
    await this.scheduler.schedule();
  }

  async onClose(): Promise<void> {
    // Unsubscribe BEFORE disposing the scheduler so a handler firing
    // mid-teardown can't schedule() on a disposed scheduler (PRES-M1 ordering).
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Guided Tour" });

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

    for (const row of model.rows) this.renderStep(container, row);

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

  private renderStep(container: HTMLElement, row: TourStepRow): void {
    const step = container.createDiv({ cls: "e2e-test-hub-tour-step" });
    step.dataset.status = row.status;
    step.setAttr("aria-label", row.ariaLabel);
    step.createDiv({
      cls: "e2e-test-hub-tour-step-title",
      text: `${row.statusIcon} ${row.index}. ${row.title}`,
    });
    if (!row.expanded) return;

    step.createDiv({ cls: "e2e-test-hub-tour-teach", text: row.teach });
    for (const snippet of row.snippets) {
      const block = step.createDiv({ cls: "e2e-test-hub-tour-snippet" });
      block.createDiv({ cls: "e2e-test-hub-tour-step-title", text: snippet.title });
      block.createEl("pre").createEl("code", { text: snippet.code });
      const copy = block.createEl("button", {
        text: "Copy",
        attr: { "aria-label": `Copy the ${snippet.title} snippet` },
      });
      copy.addEventListener("click", () => {
        // Promise.resolve().then keeps a synchronously-missing clipboard API
        // (no navigator.clipboard) on the SAME failure path as a rejected
        // write, so the user always gets the manual-selection fallback notice.
        void Promise.resolve()
          .then(() => navigator.clipboard.writeText(snippet.code))
          .then(() => new Notice("Copied to clipboard."))
          .catch(() => new Notice("Could not copy — select the snippet text manually.", 10000));
      });
    }
    if (row.hint) step.createDiv({ cls: "e2e-test-hub-tour-hint", text: row.hint });

    const actions = step.createDiv({ cls: "e2e-test-hub-tour-actions" });
    if (row.action) {
      const button = actions.createEl("button", {
        text: row.action.label,
        cls: "mod-cta",
        attr: { "aria-label": row.action.ariaLabel },
      });
      const actionId = row.action.id;
      button.addEventListener("click", () => this.dispatch(actionId));
    }
    if (row.showMarkDone) {
      const done = actions.createEl("button", {
        text: "Mark done",
        attr: { "aria-label": `Mark step ${row.index} done` },
      });
      done.addEventListener("click", () => void this.deps.tour.markDone(row.id));
    }
    if (row.showSkip) {
      const skip = actions.createEl("button", {
        text: "Skip",
        attr: { "aria-label": `Skip step ${row.index}` },
      });
      skip.addEventListener("click", () => void this.deps.tour.skip(row.id));
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

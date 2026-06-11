import { type App, FuzzySuggestModal, ItemView, type WorkspaceLeaf } from "obsidian";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import {
  NO_EVIDENCE_TOOLTIP,
  ONBOARDING_STEPS,
  projectDashboard,
  projectEnvironmentBadge,
  QUICK_ACTION_GROUPS,
  QUICK_ACTIONS,
  shouldShowOnboarding,
  type DashboardNavTarget,
  type OnboardingActionId,
  type QuickActionId,
} from "./dashboard-rows";
import { activateOnEnterOrSpace } from "./keyboard-activation";
import { RenderScheduler } from "./render-scheduler";
import { renderLoadError } from "./modal-helpers";

export const DASHBOARD_VIEW_TYPE = "e2e-test-hub-dashboard";

/**
 * Events that should re-aggregate the KPIs / recent runs (UC-018). Use Case
 * changes move the roll-up counts (ADR-0017), test runs move the recent-run
 * list, and evidence links surface freshly-generated reports.
 */
const REFRESH_ON: DomainEventType[] = [
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
  "evidence.generated",
  "evidence.linkedToUseCase",
  // KPI automation status is derived from parsed feature files, so a feature
  // edit (steps/scenarios/@wip) changes the counts — refresh on it too.
  "specification.updated",
  // The PostRunCoordinator PUSHES a refresh after a run settles, even when no
  // view was open during the run (P2-6); react to it so an already-open
  // dashboard repaints with the new run/KPIs. Re-rendering reads the
  // NON-emitting snapshot() (see render()), so reacting here cannot loop.
  "dashboard.refreshed",
  "dashboard.kpi.updated",
];

/** The documentation entry points reachable from the dashboard (AC-016). */
export type DashboardDocumentType = "getting-started" | "manual" | "troubleshooting";

/**
 * Callbacks the dashboard hub drives (Wave C). Every entry is a callback (never
 * a service) so the view stays decoupled from the composition root: main.ts
 * wires these to the EXISTING helpers and the Wave B {@link RunLauncher} rather
 * than the view reimplementing create/run/open/persist logic.
 */
export interface DashboardViewDeps {
  traceabilityService: TraceabilityService;
  eventBus: EventBus;
  // AC-016: open the Getting Started guide / User Manual straight from the
  // dashboard.
  openDocumentation: (documentType: DashboardDocumentType) => void | Promise<void>;
  // Wave C §1: a REAL initialization signal (does the Test Hub vault structure
  // exist yet?), wired in main.ts to a vault folder-existence check. snapshot()
  // can't tell us — a fresh vault's missing Use Cases folder lists as ok([]), so
  // it succeeds with zero Use Cases and would hide the Initialize CTA from
  // first-time users.
  isInitialized: () => Promise<boolean>;
  // Wave C §1 quick actions. Create / run entry points reuse the openCreate*
  // helpers + the RunLauncher; open* navigates via the workspace adapter.
  openWizard: () => void;
  openCreateUseCase: () => void;
  openCreateSuite: () => void;
  runAll: () => void | Promise<void>;
  runDemo: () => void | Promise<void>;
  generateDocumentation: () => void | Promise<void>;
  // Wave C §4: KPI tiles + the Open quick-actions navigate the explorers.
  navigate: (target: DashboardNavTarget) => void | Promise<void>;
  openSuites: () => void | Promise<void>;
  openConsole: () => void | Promise<void>;
  // Wave C §3: open the Evidence note a recent-run row links to.
  openEvidence: (path: VaultPath) => void | Promise<void>;
  // EPIC-008: the Recent Runs header links into the full history explorer
  // (Recent Runs shows only the latest run per Use Case).
  openEvidenceExplorer: () => void | Promise<void>;
  // Wave C §2: the active environment + the full list, read fresh each render
  // so a switch (persisted via switchEnvironment) repaints with the new active.
  getEnvironments: () => { active: string; names: string[] };
  // Persists the chosen environment through the settings save path main.ts owns
  // (the view never writes settings directly). main.ts shows the Notice + the
  // settings.updated event drives the refresh; the resolved Result lets the view
  // skip a redundant local refresh on failure.
  switchEnvironment: (name: string) => Promise<void>;
}

/**
 * Live "Test Hub Dashboard" panel (FEAT-019, US-037/US-038, UC-018) turned into
 * the home/hub a user lands on (Wave C). Shows a quick-action bar, the active-
 * environment badge + switcher, navigable KPI tiles, and actionable recent-run
 * rows, refreshing on use-case / test-run / evidence / settings events.
 *
 * Counts + ordering are aggregated by {@link TraceabilityService.refreshDashboard}
 * (which itself emits `dashboard.refreshed` + `dashboard.kpi.updated`); this view
 * adds the `dashboard.opened` event on open and projects the snapshot to a view
 * model via the pure {@link projectDashboard}.
 */
export class DashboardView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  // Renders are async (they await refreshDashboard). Firing them concurrently
  // lets a slower render with STALE data empty + rebuild the container last,
  // clobbering fresher output. The scheduler chains them so they run one at a
  // time, and coalesces a burst of events into a single trailing render.
  private readonly scheduler = new RenderScheduler(() => this.render());

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: DashboardViewDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Hub dashboard";
  }

  getIcon(): string {
    return "gauge";
  }

  async onOpen(): Promise<void> {
    // UC-018 step 1: opening the dashboard is itself an event.
    await this.deps.eventBus.publish(
      createEvent("dashboard.opened", { dashboardPath: DASHBOARD_VIEW_TYPE }),
    );
    for (const type of REFRESH_ON) {
      this.subscriptions.push(this.deps.eventBus.subscribe(type, () => this.scheduler.schedule()));
    }
    // An active-environment switch persists through settings, which emits
    // `settings.updated`; repaint the badge (+ anything env-derived) on it.
    this.subscriptions.push(
      this.deps.eventBus.subscribe("settings.updated", () => this.scheduler.schedule()),
    );
    // First paint: PUSH a refresh once (emits dashboard.refreshed + kpi.updated
    // per UC-018 steps 2–3). Subsequent event-driven re-renders read the
    // non-emitting snapshot() so they never loop. The subscriptions above ignore
    // this self-published refresh while it is already rendering (coalesced).
    await this.deps.traceabilityService.refreshDashboard().catch(() => undefined);
    // Route the initial render through the same chain so an event arriving while
    // its async refresh is in flight can't start a concurrent render that
    // finishes first and is then clobbered by this stale initial render.
    await this.scheduler.schedule();
  }

  async onClose(): Promise<void> {
    // Unsubscribe BEFORE disposing the scheduler so a handler firing mid-teardown
    // can't schedule() on an already-disposed scheduler (PRES-M1 ordering).
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Test Hub dashboard" });

    // Wave C §1: gate on a REAL initialization signal (the vault structure
    // exists). A fresh vault returns ok([]) from the snapshot — the missing Use
    // Cases folder lists empty — so snapshot success can't distinguish
    // "not set up yet" from "set up but empty". Show the prominent Initialize
    // CTA for the former.
    if (!(await this.deps.isInitialized())) {
      this.renderInitializeCta(container);
      return;
    }

    // Read the NON-emitting snapshot (P2-6): the tiles/rows are projected from
    // it without re-publishing dashboard.* events, so a render driven by a
    // dashboard.refreshed/kpi.updated event can't re-trigger a refresh (no loop).
    // The one-time emitting push happens in onOpen and from the coordinator.
    const result = await this.deps.traceabilityService.snapshot();
    if (!result.ok) {
      // Initialized but the snapshot failed (a real I/O error, not a fresh
      // vault) — surface it rather than masquerading as "not initialized",
      // and offer a retry instead of a bare terminal message.
      renderLoadError(
        container,
        `Could not load dashboard: ${result.error.message}`,
        "Retry loading the dashboard",
        () => void this.scheduler.schedule(),
      );
      return;
    }

    // Top bar: active-environment badge (Wave C §2).
    this.renderEnvironmentBadge(container);

    // Quick actions (Wave C §1): the common entry points as real buttons.
    this.renderQuickActions(container);

    // Onboarding (Wave G §2): when the hub is initialized but holds no Use
    // Cases yet (a first-time user right after the wizard), guide the
    // create-UC → demo-run → docs path. We only reach this branch when
    // isInitialized() returned true above. Disappears once a Use Case exists.
    if (shouldShowOnboarding(result.value.totalUseCases)) {
      this.renderOnboarding(container);
    }

    // Documentation access (AC-016): open the Getting Started guide / User
    // Manual without leaving the dashboard.
    this.renderDocumentationActions(container);

    const view = projectDashboard(result.value);

    // KPI tiles (US-037). The grid gets its own h3 so the heading hierarchy
    // under the h2 root is h3 peers ("Coverage" / "Recent Runs") for screen
    // readers and the outline view.
    container.createEl("h3", { text: "Coverage" });
    const tiles = container.createDiv({ cls: "e2e-test-hub-kpi-tiles" });
    for (const kpi of view.kpis) {
      // data-status (lowercased label, e.g. "passing" / "failing") drives a
      // color-blind-safe border accent in styles.css. The text label always
      // remains, so the status is never communicated by colour alone. Each tile
      // is a <button> so it is keyboard-focusable and navigates (Wave C §4).
      const tile = tiles.createEl("button", {
        cls: "e2e-test-hub-kpi-tile",
        attr: { "data-status": kpi.label.toLowerCase(), "aria-label": kpi.ariaLabel },
      });
      tile.createDiv({ cls: "e2e-test-hub-kpi-value", text: String(kpi.value) });
      tile.createDiv({ cls: "e2e-test-hub-kpi-label", text: kpi.label });
      tile.addEventListener("click", () => {
        void this.deps.navigate(kpi.navigateTo);
      });
    }

    // Recent runs (US-038).
    container.createEl("h3", { text: "Recent runs" });
    if (view.recentRuns.length === 0) {
      container.createEl("p", { text: "No Test Runs yet. Run a Test Suite to see results here." });
      return;
    }
    // EPIC-008: only rendered once at least one run exists — an empty history
    // has nothing to "view all" of.
    container
      .createEl("button", {
        text: "View all runs",
        cls: "e2e-test-hub-doc-button",
        attr: { "aria-label": "Open the Evidence Explorer with the full run history" },
      })
      .addEventListener("click", () => {
        void this.deps.openEvidenceExplorer();
      });

    const table = container.createEl("table", { cls: "e2e-test-hub-runs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const label of ["Run", "Status", "Date"]) {
      // scope="col" ties each header to its column for screen-reader tables.
      headRow.createEl("th", { text: label, attr: { scope: "col" } });
    }
    const body = table.createEl("tbody");
    for (const run of view.recentRuns) {
      // Clicking a row opens its linked Evidence note (Wave C §3). Rows without
      // evidence (e.g. errored runs) are inert with an explanatory tooltip.
      // The row itself carries no link role/tabindex — that would destroy its
      // table semantics for screen readers; the Run ID cell holds the real
      // link-button and the whole-row click is a sighted-user convenience.
      const tr = body.createEl("tr", {
        cls: run.navigable ? "e2e-test-hub-run-row is-navigable" : "e2e-test-hub-run-row",
      });
      if (run.navigable && run.evidencePath !== undefined) {
        const path = run.evidencePath;
        const open = (): void => {
          void this.deps.openEvidence(path);
        };
        // Same pattern as the Use Cases table's id link-button.
        const link = tr.createEl("td").createEl("button", {
          text: run.runId,
          cls: "e2e-test-hub-link-button",
          attr: { "aria-label": run.ariaLabel },
        });
        link.addEventListener("click", (event) => {
          // The row's convenience click listener below would fire open() again.
          event.stopPropagation();
          open();
        });
        activateOnEnterOrSpace(link, open);
        tr.addEventListener("click", open);
      } else {
        tr.createEl("td", { text: run.runId });
        tr.setAttr("title", NO_EVIDENCE_TOOLTIP);
      }
      // data-status mirrors the raw TestRunStatus so styles.css can tint the
      // cell via Obsidian theme vars. The status TEXT stays, so the outcome is
      // legible without colour (colour-blind / high-contrast safe).
      tr.createEl("td", {
        text: run.status,
        cls: "e2e-test-hub-run-status",
        attr: { "data-status": run.status },
      });
      tr.createEl("td", { text: run.date });
    }
  }

  /**
   * Wave C §1: the prominent "Initialize Test Hub" call-to-action shown when the
   * hub is not set up yet, with a one-line explanation. Opens the wizard.
   */
  private renderInitializeCta(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "e2e-test-hub-init-cta" });
    panel.createEl("p", {
      cls: "e2e-test-hub-init-cta-text",
      text: "Set up your Test Hub to create Use Cases, write specifications, and run tests in this vault.",
    });
    panel
      .createEl("button", {
        text: "Initialize Test Hub",
        cls: "mod-cta",
        attr: { "aria-label": "Initialize the Test Hub" },
      })
      .addEventListener("click", () => this.deps.openWizard());
  }

  /**
   * Wave C §2: "Environment: <active>" badge in the top bar. With 2+
   * environments it is a button that opens a fuzzy picker to switch the active
   * environment; with one it renders non-interactive. Persisting + the success
   * Notice are owned by main.ts (the view never writes settings).
   */
  private renderEnvironmentBadge(container: HTMLElement): void {
    const { active, names } = this.deps.getEnvironments();
    const badge = projectEnvironmentBadge(active, names);
    const bar = container.createDiv({ cls: "e2e-test-hub-topbar" });
    const text = `Environment: ${badge.active}`;
    if (!badge.switchable) {
      bar.createEl("span", {
        cls: "e2e-test-hub-env-badge",
        text,
        attr: { "aria-label": badge.ariaLabel },
      });
      return;
    }
    const button = bar.createEl("button", {
      cls: "e2e-test-hub-env-badge is-switchable",
      text,
      attr: { "aria-label": badge.ariaLabel },
    });
    button.addEventListener("click", () => {
      new EnvironmentPickerModal(this.app, badge.options, badge.active, (name) => {
        if (name !== badge.active) void this.deps.switchEnvironment(name);
      }).open();
    });
  }

  /**
   * Wave C §1: the quick-action bar. A single primary "New Use Case" CTA plus a
   * compact grouped row (Create / Run / Open) so it stays scannable. The view is
   * thin — labels, grouping, and the primary flag come from {@link QUICK_ACTIONS}
   * and each id dispatches to a deps callback.
   */
  private renderQuickActions(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "e2e-test-hub-quick-actions" });
    for (const { group, heading } of QUICK_ACTION_GROUPS) {
      const groupEl = bar.createDiv({ cls: "e2e-test-hub-quick-group" });
      groupEl.createEl("span", { cls: "e2e-test-hub-quick-group-label", text: heading });
      const row = groupEl.createDiv({ cls: "e2e-test-hub-quick-row" });
      for (const action of QUICK_ACTIONS.filter((a) => a.group === group)) {
        const button = row.createEl("button", {
          text: action.label,
          cls: action.primary ? "e2e-test-hub-quick-button mod-cta" : "e2e-test-hub-quick-button",
          attr: { "aria-label": action.ariaLabel },
        });
        button.addEventListener("click", () => this.dispatchQuickAction(action.id));
      }
    }
  }

  /**
   * Wave G §2: the "Get started" panel for a first-time user — three numbered
   * steps as real buttons (create a Use Case, run the shipped demo, open the
   * Getting Started guide), each with a one-line explanation. The step model is
   * the pure {@link ONBOARDING_STEPS}; the view only renders and dispatches.
   */
  private renderOnboarding(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "e2e-test-hub-onboarding" });
    panel.createEl("h3", { text: "Get started" });
    panel.createEl("p", {
      cls: "e2e-test-hub-onboarding-intro",
      text: "Your Test Hub is ready. Three steps take you to your first green run:",
    });
    // A real <ol> so the numbering is semantic (screen readers announce
    // "list, 3 items" and the step position).
    const list = panel.createEl("ol", { cls: "e2e-test-hub-onboarding-steps" });
    for (const step of ONBOARDING_STEPS) {
      const item = list.createEl("li", { cls: "e2e-test-hub-onboarding-step" });
      item
        .createEl("button", {
          text: step.label,
          cls: "e2e-test-hub-onboarding-button",
          attr: { "aria-label": step.ariaLabel },
        })
        .addEventListener("click", () => this.dispatchOnboarding(step.action));
      item.createDiv({ cls: "e2e-test-hub-onboarding-desc", text: step.description });
    }
  }

  /** Maps an {@link OnboardingActionId} to the EXISTING deps callback for it. */
  private dispatchOnboarding(id: OnboardingActionId): void {
    switch (id) {
      case "create-use-case":
        this.deps.openCreateUseCase();
        return;
      case "run-demo":
        void this.deps.runDemo();
        return;
      case "open-getting-started":
        void this.deps.openDocumentation("getting-started");
        return;
    }
  }

  /** Maps a {@link QuickActionId} to the deps callback that performs it. */
  private dispatchQuickAction(id: QuickActionId): void {
    switch (id) {
      case "new-use-case":
        this.deps.openCreateUseCase();
        return;
      case "new-suite":
        this.deps.openCreateSuite();
        return;
      case "run-all":
        void this.deps.runAll();
        return;
      case "run-demo":
        void this.deps.runDemo();
        return;
      case "generate-docs":
        void this.deps.generateDocumentation();
        return;
      case "open-use-cases":
        void this.deps.navigate("use-cases");
        return;
      case "open-suites":
        void this.deps.openSuites();
        return;
      case "open-console":
        void this.deps.openConsole();
        return;
    }
  }

  /** AC-016 documentation buttons (US-046: Getting Started / Manual / Troubleshooting). */
  private renderDocumentationActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "e2e-test-hub-doc-actions" });
    // All three guides US-046 maps to UC-021/022/023 must be reachable here.
    const buttons: readonly [string, DashboardDocumentType][] = [
      ["Getting Started", "getting-started"],
      ["User Manual", "manual"],
      ["Troubleshooting", "troubleshooting"],
    ];
    for (const [label, documentType] of buttons) {
      // aria-label spells out the action for assistive tech (the visible text
      // alone reads as a bare noun) — same pattern as the link-buttons in the
      // Use Case / Test Suite views.
      const button = actions.createEl("button", {
        text: label,
        cls: "e2e-test-hub-doc-button",
        attr: { "aria-label": `Open ${label} documentation` },
      });
      button.addEventListener("click", () => {
        void this.deps.openDocumentation(documentType);
      });
    }
  }
}

/**
 * Fuzzy picker for switching the active environment (Wave C §2). Mirrors
 * {@link RunPickerModal} — a thin {@link FuzzySuggestModal} over the environment
 * names; the chosen name is handed back to the view, which persists it through
 * the main.ts-owned settings save path.
 */
class EnvironmentPickerModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly names: string[],
    private readonly active: string,
    private readonly onChoose: (name: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Switch active environment");
  }

  getItems(): string[] {
    return this.names;
  }

  getItemText(name: string): string {
    return name === this.active ? `${name} (active)` : name;
  }

  onChooseItem(name: string): void {
    this.onChoose(name);
  }
}

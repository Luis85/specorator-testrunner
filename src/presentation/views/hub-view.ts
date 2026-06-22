import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { DomainEventType } from "../../domain/events/domain-event";
import {
  DEFAULT_HUB_SECTION,
  projectHubRail,
  readPersistedActiveSection,
  resolveActiveSection,
  type HubBodyId,
  type HubContentRef,
  type HubRail,
  type HubRailNode,
  type HubSectionDescriptor,
  type HubSectionId,
} from "../navigation/hub-sections";
import { renderDashboardBody } from "./dashboard-view-body";
import type { DashboardViewDeps } from "./dashboard-view-deps";
import {
  renderEvidenceExplorerBody,
  type EvidenceExplorerBodyDeps,
} from "./evidence-explorer-body";
import { EVIDENCE_PAGE_SIZE, type EvidenceStatusFilter } from "./evidence-explorer-rows";
import { LiveDashboardView } from "./live-dashboard-view";
import { renderPrdExplorerBody, type PrdExplorerBodyDeps } from "./prd-explorer-body";
import {
  renderStoryMapExplorerBody,
  type StoryMapExplorerBodyDeps,
} from "./story-map-explorer-body";
import { renderSuiteDashboardBody, type SuiteDashboardBodyDeps } from "./suite-dashboard-body";
import {
  renderUseCaseDashboardBody,
  type UseCaseDashboardBodyDeps,
} from "./use-case-dashboard-body";

export const HUB_VIEW_TYPE = "e2e-test-hub-hub";

/**
 * The union of refresh events the hosted bodies need (ADR-0031): the hub
 * subscribes to ALL of them, but a refresh only re-renders the ACTIVE section's
 * content (render() dispatches on `this.activeSection`), so an event a hidden
 * section cares about repaints nothing until that section is shown. The set is
 * the union of every hosted view's `REFRESH_ON` — dashboard (overview), PRDs +
 * Story Maps (plan), Use Cases (build), Test Suites (run), Evidence (review) —
 * so whichever section is open stays as live as its standalone leaf was.
 */
const REFRESH_ON: DomainEventType[] = [
  // Use Case lifecycle (overview KPIs, Use Cases list, PRD roadmap counts).
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
  // Test runs (overview recent runs, Evidence list, automation columns).
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
  "scenario.history.recorded",
  // Evidence (overview recent runs + the Evidence list).
  "evidence.generated",
  "evidence.linkedToUseCase",
  // Feature lifecycle (Use Cases/Suites counts, overview KPIs).
  "specification.created",
  "specification.updated",
  // Dashboard roll-up pushes (overview KPIs + recent runs).
  "dashboard.refreshed",
  "dashboard.kpi.updated",
  // Settings (active-environment badge + history-derived columns).
  "settings.updated",
  // Guided tour CTA on the overview body hides once the tour completes.
  "tour.completed",
  // PRD lifecycle (overview roadmap + the PRDs tree).
  "prd.created",
  "prd.deleted",
  // Story Maps list (plan section).
  "storymap.created",
  "storymap.updated",
  "storymap.deleted",
  // Test Suites list (run section).
  "suite.created",
  "suite.updated",
  "suite.deleted",
];

/**
 * Everything the hub leaf renders: the union of the hosted bodies' deps (the
 * overview dashboard is the superset {@link DashboardViewDeps}; the explorer
 * bodies add their own service slices), the workspace port a `leaf` content ref
 * opens through, and the `app` the dashboard's environment picker needs. The
 * composition root wires this in `register-views.ts` exactly once.
 */
export interface HubViewDeps {
  app: App;
  /** Opens a `leaf` content ref (the Test Console) at its declared location. */
  workspace: WorkspacePort;
  /** The overview section's body deps (KPI summary + recent runs); the superset. */
  dashboard: DashboardViewDeps;
  /** The plan section's PRD roadmap body deps. */
  prds: PrdExplorerBodyDeps;
  /** The plan section's Story Maps list body deps. */
  storyMaps: StoryMapExplorerBodyDeps;
  /** The build section's Use Cases list body deps. */
  useCases: UseCaseDashboardBodyDeps;
  /** The run section's Test Suites list body deps. */
  suites: SuiteDashboardBodyDeps;
  /** The review section's Evidence list body deps. */
  evidence: EvidenceExplorerBodyDeps;
}

/**
 * The Test Hub home shell (WS-B1, ADR-0031): a SINGLE leaf with a persistent
 * left-rail section switcher. Top to bottom it renders an identity bar (wordmark
 * drawing the brand `--spec-accent` chrome), the left rail (exactly one node
 * marked active carries the accent), the content panel (each active section's
 * `HubContentRef` dispatched exhaustively — in-hub body vs navigate-out leaf),
 * and an empty onboarding-rail slot (B2 fills it later).
 *
 * The active section is ephemeral-but-persisted view state: `getState()` returns
 * `{ activeSection }` and `setState()` reads it back through the pure
 * {@link resolveActiveSection}, so the rail survives a workspace reload. Only the
 * content panel re-renders on a section switch or a refresh — the rail and
 * identity bar are built once on open and the panel swapped underneath them.
 */
export class HubView extends LiveDashboardView {
  private activeSection: HubSectionId = DEFAULT_HUB_SECTION;
  private isOpen = false;
  /** The content panel host the active section renders into; rebuilt on switch. */
  private panelEl: HTMLElement | null = null;
  /** The Evidence body's ephemeral filter/limit state (review section only). */
  private evidenceFilter: EvidenceStatusFilter = "all";
  private evidenceVisibleLimit = EVIDENCE_PAGE_SIZE;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: HubViewDeps,
  ) {
    super(leaf, deps.dashboard.eventBus, REFRESH_ON);
  }

  getViewType(): string {
    return HUB_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Hub";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  /** Persist the active section so the rail survives a workspace reload. */
  getState(): Record<string, unknown> {
    return { activeSection: this.activeSection };
  }

  // Untested Obsidian-lifecycle override — mirrors UseCaseDetailView's restore-gap
  // handling (render only when already open; onOpen drives the first render). The
  // persisted value is read WITHOUT an unsafe cast via the pure
  // readPersistedActiveSection, then sanitized by resolveActiveSection.
  // fallow-ignore-next-line complexity
  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const next = resolveActiveSection(readPersistedActiveSection(state));
    if (next !== this.activeSection) {
      this.activeSection = next;
      // On a workspace RESTORE, Obsidian calls setState() BEFORE onOpen() — the
      // bus subscriptions don't exist yet, so a render here could paint content an
      // event in that gap already invalidated. Let onOpen() do the first render
      // (after subscribing); only re-render here when the view is already open.
      if (this.isOpen) this.renderActivePanel();
    }
    await super.setState(state, result);
  }

  // The isOpen-tracked open/close lifecycle deliberately MIRRORS UseCaseDetailView
  // / StoryMapBoardView (ADR-0031 restore-gap handling): setState() must defer its
  // first render to onOpen() so an event in the subscribe gap can't paint stale
  // content. It is a 13-line lifecycle convention, not extractable shared logic —
  // each view's onOpen body diverges past these lines (the board subscribes
  // manually, the dashboard pushes a refresh), so a shared base method would not
  // fit. Kept verbatim so the proven guard reads identically across the views.
  // fallow-ignore-next-line code-duplication
  async onOpen(): Promise<void> {
    this.isOpen = true;
    await this.live.open(this.refreshOn);
  }

  async onClose(): Promise<void> {
    this.isOpen = false;
    this.live.close();
  }

  /**
   * Switches the active rail section: stores it, persists it through the
   * workspace save path (so the rail survives a reload), and re-renders the
   * chrome (so the rail's active marker moves) plus the content panel. Marking
   * the active node is cheap, so we rebuild the whole shell rather than diff it.
   */
  private setActiveSection(id: HubSectionId): void {
    if (id === this.activeSection) return;
    this.activeSection = id;
    // Persist the new active section so the rail survives a workspace reload:
    // requestSaveLayout serializes the layout, which re-reads every leaf's
    // getState() (returning our { activeSection }). The debounced save coalesces
    // rapid switches into one write.
    void this.app.workspace.requestSaveLayout();
    void this.live.schedule();
  }

  /**
   * Rebuilds the whole shell: identity bar, rail, content panel, onboarding slot.
   * Scheduled through {@link LiveRefresh} on open, on a section switch, and on any
   * refresh event — the panel always re-renders the ACTIVE section's content only.
   */
  protected render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("spec-hub");

    this.renderIdentityBar(container);
    const layout = container.createDiv({ cls: "spec-hub-layout" });
    this.renderRail(layout, projectHubRail(this.activeSection));
    this.panelEl = layout.createDiv({ cls: "spec-hub-panel" });
    // The onboarding rail region is ALWAYS created (B2 fills it later); empty for
    // now so the structure is in place without building the onboarding projection.
    container.createDiv({ cls: "spec-hub-onboarding-rail" });

    this.renderActivePanel();
  }

  /**
   * The top identity strip: a wordmark drawing the brand `--spec-accent` chrome
   * (a small icon swatch + the product title). Kept light — the full health hero
   * and the environment context are deferred (ADR-0031). Built once per shell
   * render and not touched by a content refresh.
   */
  private renderIdentityBar(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "spec-hub-identity" });
    const mark = bar.createDiv({ cls: "spec-hub-wordmark-icon", attr: { "aria-hidden": "true" } });
    setIcon(mark, "layout-dashboard");
    bar.createEl("span", { cls: "spec-hub-wordmark", text: "Test Hub" });
  }

  /**
   * The persistent left rail: one node per section, rendered as a thin DOM writer
   * over the pure {@link projectHubRail}. Exactly one node carries `is-active`
   * (the `--spec-accent` chrome marker, never a status colour); clicking a node
   * switches the active section. Built once per shell render.
   */
  private renderRail(layout: HTMLElement, rail: HubRail): void {
    const railEl = layout.createEl("nav", {
      cls: "spec-hub-rail",
      attr: { "aria-label": "Test Hub sections" },
    });
    for (const node of rail.nodes) this.renderRailNode(railEl, node);
  }

  /** Renders one rail node — its icon + label, the active accent marker, and the switch. */
  private renderRailNode(railEl: HTMLElement, node: HubRailNode): void {
    const { descriptor, active } = node;
    const button = railEl.createEl("button", {
      cls: active ? "spec-hub-rail-node is-active" : "spec-hub-rail-node",
      attr: {
        "aria-label": descriptor.ariaLabel,
        "aria-current": active ? "page" : "false",
      },
    });
    const icon = button.createSpan({ cls: "spec-hub-rail-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, descriptor.icon);
    button.createSpan({ cls: "spec-hub-rail-label", text: descriptor.label });
    button.addEventListener("click", () => this.setActiveSection(descriptor.id));
  }

  /**
   * Re-renders ONLY the active section's content into the content panel (ADR-0031:
   * re-render bodies, not child leaves). Clears the panel then dispatches each of
   * the section descriptor's `HubContentRef`s in order — a `section-body` builds
   * its PR2 renderer into a fresh panel child, a `leaf` renders an action button
   * that opens the leaf at its declared location. Inactive sections are never
   * built, so a hidden section's data is never loaded.
   */
  private renderActivePanel(): void {
    if (this.panelEl === null) return;
    const panel = this.panelEl;
    panel.empty();
    const descriptor = projectHubRail(this.activeSection).active;
    for (const content of descriptor.contents) this.renderContent(panel, descriptor, content);
  }

  /** Dispatches one content ref exhaustively: in-hub body vs navigate-out leaf. */
  private renderContent(
    panel: HTMLElement,
    descriptor: HubSectionDescriptor,
    content: HubContentRef,
  ): void {
    switch (content.kind) {
      case "section-body": {
        const bodyEl = panel.createDiv({ cls: "spec-hub-section-body" });
        void this.renderBody(content.body, bodyEl);
        return;
      }
      case "leaf":
        this.renderLeafAction(panel, descriptor, content);
        return;
    }
  }

  /**
   * Renders the matching PR2 host-agnostic body into `el`, mirroring each
   * standalone leaf's thin caller (each body loads its own data and takes a
   * `refresh` that re-renders the active panel). The exhaustive switch over the
   * body id is the same routing data the pure model encodes (ADR-0031).
   */
  // fallow-ignore-next-line complexity
  private async renderBody(body: HubBodyId, el: HTMLElement): Promise<void> {
    const refresh = (): void => void this.live.schedule();
    switch (body) {
      case "kpi-overview":
      case "recent-runs":
        // The overview dashboard body renders the KPI summary + recent runs (and
        // its own quick actions/badge) in one pass; both overview content refs map
        // to it, so render it once on the FIRST ref and let the second be a no-op
        // (the panel child for the second ref stays empty).
        if (body === "kpi-overview") {
          await renderDashboardBody(el, this.deps.app, this.deps.dashboard, refresh);
        }
        return;
      case "prd-roadmap":
        await renderPrdExplorerBody(el, { ...this.deps.prds, refresh });
        return;
      case "story-maps":
        await renderStoryMapExplorerBody(el, { ...this.deps.storyMaps, refresh });
        return;
      case "use-cases":
        await renderUseCaseDashboardBody(el, { ...this.deps.useCases, refresh });
        return;
      case "suites":
        await renderSuiteDashboardBody(el, { ...this.deps.suites, refresh });
        return;
      case "evidence":
        await renderEvidenceExplorerBody(
          el,
          { ...this.deps.evidence, refresh },
          {
            filter: this.evidenceFilter,
            visibleLimit: this.evidenceVisibleLimit,
            onFilterChange: (filter) => {
              this.evidenceFilter = filter;
              void this.live.schedule();
            },
            onLoadOlder: () => {
              this.evidenceVisibleLimit += EVIDENCE_PAGE_SIZE;
              void this.live.schedule();
            },
          },
        );
        return;
    }
  }

  /**
   * Renders a navigate-out `leaf` content ref as a section action button (the
   * Test Console opens in the sidebar). Mirrors the dashboard's "Open console"
   * affordance — the button opens the leaf at the location the pure model carries.
   */
  private renderLeafAction(
    panel: HTMLElement,
    descriptor: HubSectionDescriptor,
    content: Extract<HubContentRef, { kind: "leaf" }>,
  ): void {
    const actions = panel.createDiv({ cls: "spec-hub-section-actions" });
    const label = labelForLeaf(content.viewType);
    actions
      .createEl("button", {
        text: label,
        cls: "spec-hub-section-action mod-cta",
        attr: { "aria-label": `${label} (${descriptor.label} section)` },
      })
      .addEventListener("click", () => {
        void this.deps.workspace.openView(content.viewType, content.location);
      });
  }
}

/** The visible label for a section's `leaf` action (the Test Console is the only one). */
const labelForLeaf = (viewType: string): string =>
  viewType === "e2e-test-hub-console" ? "Open Test Console" : "Open";

/** The legacy dashboard view type the hub supersedes (ADR-0031 alias migration). */
const DASHBOARD_ALIAS_VIEW_TYPE = "e2e-test-hub-dashboard";

/**
 * Alias migration for the legacy dashboard leaf (ADR-0031 §"Dashboard view-type
 * alias migration"): the old `e2e-test-hub-dashboard` view type stays REGISTERED
 * (so a persisted layout referencing it never orphans on a dead leaf), but is
 * aliased to the hub. A restored dashboard leaf mounts this thin redirect, which
 * opens the single hub leaf and detaches itself — so the user lands on the hub
 * (on the overview section) rather than a stale standalone dashboard.
 *
 * A redirect (rather than registering {@link HubView} under the old type) keeps
 * each view's `getViewType()` matching its registered type, so Obsidian's leaf
 * serialization stays consistent; the redirect just removes the now-superseded
 * legacy leaf.
 */
export class DashboardAliasView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly openHub: () => void | Promise<void>,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DASHBOARD_ALIAS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Hub";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    // Open the hub first, THEN detach this legacy leaf, so the workspace is never
    // momentarily empty (the hub is revealed before the alias leaf disappears).
    await this.openHub();
    this.leaf.detach();
  }
}

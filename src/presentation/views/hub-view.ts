import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { EventBus } from "../../shared/event-bus/event-bus";
import {
  DEFAULT_HUB_SECTION,
  readPersistedActiveSection,
  resolveActiveSection,
  type HubSectionId,
} from "../navigation/hub-sections";
import type { EvidenceExplorerBodyDeps } from "./evidence-explorer-body";
import type { OnboardingRailBodyDeps } from "./onboarding-rail-body";
import type { OverviewHeroBodyDeps } from "./overview-hero-body";
import type { RecentRunsBodyDeps } from "./recent-runs-body";
import type { StoryMapExplorerBodyDeps } from "./story-map-explorer-body";
import type { UseCaseDashboardBodyDeps } from "./use-case-dashboard-body";
import type { PrdBodyDeps } from "../vue/prds/prd-body-deps";
import type { SuiteBodyDeps } from "../vue/suites/suite-body-deps";
import { OBSIDIAN_APP } from "../vue/obsidian-app";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import { PersistedLeafState } from "../vue/persisted-leaf-state";
import { HUB_DEPS } from "../vue/hub/hub-deps";
import HubShell from "../vue/hub/HubShell.vue";
import HubSection from "../vue/hub/HubSection.vue";

export const HUB_VIEW_TYPE = "e2e-test-hub-hub";

/**
 * The Overview hero body's deps MINUS the `navigate`/`refresh` the hub OWNS: a KPI
 * funnel tile switches the rail section (to Build), so the hub supplies `navigate`;
 * `refresh` is the hub's active-section repaint. The rest come from the root.
 */
type HubHeroDeps = Omit<OverviewHeroBodyDeps, "navigate" | "refresh">;

/**
 * The Overview recent-runs body's deps MINUS the section-navigation
 * `openEvidenceExplorer` the hub OWNS (it switches to the Review section) and the
 * hub-owned `refresh`.
 */
type HubRecentRunsDeps = Omit<RecentRunsBodyDeps, "openEvidenceExplorer" | "refresh">;

/**
 * The Use Cases body's deps MINUS the `filter`/`clearFilter` the hub OWNS (E1
 * PR3): the funnel filter is hub-held ephemeral state (now the Pinia hub store),
 * supplied at render time, not threaded from the composition root.
 */
type HubUseCasesDeps = Omit<UseCaseDashboardBodyDeps, "filter" | "clearFilter">;

/**
 * The docked onboarding rail's deps MINUS the `collapsed`/`onToggleCollapsed`/`refresh`
 * the hub OWNS (B2 PR3): the rail's collapse is hub-held ephemeral chrome (the Pinia
 * hub store), and the `refresh` is the hub's repaint.
 */
type HubOnboardingDeps = Omit<
  OnboardingRailBodyDeps,
  "collapsed" | "onToggleCollapsed" | "refresh"
>;

/**
 * Everything the hub leaf renders: the union of the hosted bodies' deps (each
 * minus the section drilldowns / ephemeral state the hub owns), the workspace port
 * a `leaf` content ref opens through, and the `app` a body needs. The composition
 * root wires this in `register-views.ts` exactly once.
 */
export interface HubViewDeps {
  app: App;
  /** The bus the hub's `useEventBus` composables subscribe to. */
  eventBus: EventBus;
  /** Opens a `leaf` content ref (the Test Console) at its declared location. */
  workspace: WorkspacePort;
  /** The Overview hero body deps (health hero + primary actions + KPI funnel). */
  hero: HubHeroDeps;
  /** The Overview recent-runs body deps. */
  recentRuns: HubRecentRunsDeps;
  /** The plan section's PRD roadmap body deps (the hub supplies `eventBus`). */
  prds: Omit<PrdBodyDeps, "eventBus">;
  /** The plan section's Story Maps list body deps. */
  storyMaps: StoryMapExplorerBodyDeps;
  /** The build section's Use Cases list body deps. */
  useCases: HubUseCasesDeps;
  /** The run section's Test Suites body deps (the hub supplies `eventBus`). */
  suites: Omit<SuiteBodyDeps, "eventBus">;
  /** The review section's Evidence list body deps. */
  evidence: EvidenceExplorerBodyDeps;
  /** The docked onboarding rail's deps (the hub owns collapse + refresh). */
  onboarding: HubOnboardingDeps;
}

/**
 * The Test Hub home shell (WS-B1, ADR-0031): a SINGLE leaf with a persistent
 * left-rail section switcher. Vue-migrated (ADR-0033 Phase 2): the view mounts a
 * per-leaf Vue app ({@link HubShell}) with a **vue-router** (memory history)
 * driving the five sections — the pure `hub-sections.ts` model becomes the route
 * table. The active section is persisted through the layout-save path via
 * {@link PersistedLeafState}: `getState()` returns the section, a rail click pushes
 * a route, and the router's `afterEach` records it with `requestSaveLayout()`; on
 * restore `setState()` pre-sets the field and drives the router once the app is up.
 * The hub's ephemeral view-state (Evidence/Use Cases filters, onboarding collapse)
 * lives in a per-app Pinia store; the hosted section bodies are the existing DOM
 * writers, reused via the `Imperative` wrapper (their Vue-native rewrite is later).
 */
export class HubView extends ItemView {
  // Persisted active section — the requestSaveLayout path (ADR-0033), since the
  // section changes from WITHIN the leaf (a rail click), which a plain setState()
  // write would not persist.
  private readonly section = new PersistedLeafState<HubSectionId>(
    DEFAULT_HUB_SECTION,
    () => void this.app.workspace.requestSaveLayout(),
  );
  private mounted: MountedVueView | null = null;
  private router: Router | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: HubViewDeps,
  ) {
    super(leaf);
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
    return { activeSection: this.section.get() };
  }

  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const next = resolveActiveSection(readPersistedActiveSection(state));
    // restore() updates the persisted field WITHOUT re-saving; when the app is
    // already mounted (a leaf reuse), also drive the router to the restored
    // section. Before onOpen (a workspace restore), the router doesn't exist yet —
    // onOpen reads section.get() and initializes the router to it.
    if (this.section.restore(next) && this.router !== null) void this.router.push(`/${next}`);
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    const initial = this.section.get();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/:section", component: HubSection },
        { path: "/:pathMatch(.*)*", redirect: `/${initial}` },
      ],
    });
    // The single persistence point: any navigation (rail click, KPI-tile jump)
    // records the section via the getState-field + requestSaveLayout path. A
    // restore pre-set the field, so the initial navigation's afterEach is a no-op
    // set (same value) rather than a redundant layout save.
    router.afterEach((to) =>
      this.section.set(
        resolveActiveSection(typeof to.params.section === "string" ? to.params.section : undefined),
      ),
    );
    this.router = router;
    this.mounted = mountVueView(this.contentEl, HubShell, (app) => {
      app.provide(HUB_DEPS, this.deps);
      app.provide(OBSIDIAN_APP, this.app);
      app.use(router);
    });
    await router.isReady();
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
    this.router = null;
  }
}

/** The legacy dashboard view type the hub supersedes (ADR-0031 alias migration). */
const DASHBOARD_ALIAS_VIEW_TYPE = "e2e-test-hub-dashboard";

/**
 * Alias migration for the legacy dashboard leaf (ADR-0031): the old
 * `e2e-test-hub-dashboard` view type stays REGISTERED (so a persisted layout never
 * orphans on a dead leaf), but a restored dashboard leaf mounts this thin redirect,
 * which opens the single hub leaf and detaches itself — so the user lands on the
 * hub rather than a stale standalone dashboard.
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

import type { App } from "obsidian";
import { projectPrdRoadmap } from "./dashboard-prd-projection";
import {
  ONBOARDING_STEPS,
  projectDashboard,
  projectEnvironmentBadge,
  QUICK_ACTION_GROUPS,
  QUICK_ACTIONS,
  shouldShowOnboarding,
  type OnboardingActionId,
  type QuickActionId,
} from "./dashboard-rows";
import { renderRecentRuns } from "./dashboard-recent-runs";
import { EnvironmentPickerModal } from "./environment-picker-modal";
import { renderLoadError } from "./modal-helpers";
import type { DashboardDocumentType, DashboardViewDeps } from "./dashboard-view-deps";

/**
 * Renders the overview/dashboard body into `el` (host-agnostic, ADR-0031): the
 * `<h2>`, the Initialize CTA or the snapshot-driven environment badge, quick
 * actions, onboarding, documentation, KPI tiles, PRD roadmap, and recent runs —
 * or the load-error state. The view's thin `render()` passes its own `contentEl`
 * + `app` + a `refresh` it wires to `this.live.schedule` (the load-error/retry
 * path the same way the later Test Hub will), so the standalone leaf and the
 * hub render it identically. Loads its own data so the hub calls it the same way.
 */
export const renderDashboardBody = async (
  el: HTMLElement,
  app: App,
  deps: DashboardViewDeps,
  refresh: () => void,
): Promise<void> => {
  el.empty();
  el.createEl("h2", { text: "Test Hub dashboard" });

  // Wave C §1: gate on a REAL initialization signal (the vault structure
  // exists). A fresh vault returns ok([]) from the snapshot — the missing Use
  // Cases folder lists empty — so snapshot success can't distinguish
  // "not set up yet" from "set up but empty". Show the prominent Initialize
  // CTA for the former.
  if (!(await deps.isInitialized())) {
    renderInitializeCta(el, deps);
    return;
  }

  // Read the NON-emitting snapshot (P2-6): the tiles/rows are projected from
  // it without re-publishing dashboard.* events, so a render driven by a
  // dashboard.refreshed/kpi.updated event can't re-trigger a refresh (no loop).
  // The one-time emitting push happens in onOpen and from the coordinator.
  const result = await deps.traceabilityService.snapshot();
  if (!result.ok) {
    // Initialized but the snapshot failed (a real I/O error, not a fresh
    // vault) — surface it rather than masquerading as "not initialized",
    // and offer a retry instead of a bare terminal message.
    renderLoadError(
      el,
      `Could not load dashboard: ${result.error.message}`,
      "Retry loading the dashboard",
      () => refresh(),
    );
    return;
  }

  // Top bar: active-environment badge (Wave C §2).
  renderEnvironmentBadge(el, app, deps);

  // Quick actions (Wave C §1): the common entry points as real buttons.
  renderQuickActions(el, deps);
  renderTourCta(el, deps);

  // Onboarding (Wave G §2): when the hub is initialized but holds no Use
  // Cases yet (a first-time user right after the wizard), guide the
  // create-UC → demo-run → docs path. We only reach this branch when
  // isInitialized() returned true above. Disappears once a Use Case exists.
  if (shouldShowOnboarding(result.value.totalUseCases)) {
    renderOnboarding(el, deps);
  }

  // Documentation access (AC-016): open the Getting Started guide / User
  // Manual without leaving the dashboard.
  renderDocumentationActions(el, deps);

  const view = projectDashboard(result.value);

  // KPI tiles (US-037). The grid gets its own h3 so the heading hierarchy
  // under the h2 root is h3 peers ("Coverage" / "Recent Runs") for screen
  // readers and the outline view.
  el.createEl("h3", { text: "Coverage" });
  const tiles = el.createDiv({ cls: "e2e-test-hub-kpi-tiles" });
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
      void deps.navigate(kpi.navigateTo);
    });
  }

  // PRD & roadmap (Task 15): the product-vision card + sub-PRD list.
  await renderPrdSection(el, deps);

  // Recent runs (US-038): the actionable run table, extracted to keep the
  // table-building DOM out of this render() orchestration.
  renderRecentRuns(el, view.recentRuns, {
    openEvidence: deps.openEvidence,
    openEvidenceExplorer: deps.openEvidenceExplorer,
  });
};

/**
 * Task 15: the "PRD & roadmap" section — the root product-vision card with its
 * sub-PRD count + total Use Cases, the ordered sub-PRD list, and entry points
 * to create a PRD or open the PRD Explorer. When no PRDs exist yet, shows a
 * single call-to-action to create the root. Skipped silently on a load error.
 */
const renderPrdSection = async (container: HTMLElement, deps: DashboardViewDeps): Promise<void> => {
  const [prds, counts] = await Promise.all([
    deps.prdService.findAll(),
    deps.useCaseService.countUseCasesByPrd(),
  ]);
  if (!prds.ok) return;

  container.createEl("h3", { text: "PRDs & roadmap" });
  const roadmap = projectPrdRoadmap(
    prds.value,
    counts.ok ? counts.value : new Map<string, number>(),
  );
  const section = container.createDiv({ cls: "spec-panel e2e-test-hub-prd-roadmap" });

  if (!roadmap.root) {
    section.createEl("p", { text: "No PRDs yet. Start with the product vision." });
    section
      .createEl("button", { text: "Create PRD-000 (product vision)", cls: "mod-cta" })
      .addEventListener("click", () => deps.openPrdBuilder());
    return;
  }

  section.createEl("h4", { text: `${roadmap.root.id}: ${roadmap.root.title}` });
  if (roadmap.root.vision) {
    section.createEl("p", { text: roadmap.root.vision, cls: "e2e-test-hub-prd-vision" });
  }
  const uc = roadmap.root.totalUseCases;
  section.createEl("p", {
    text: `${roadmap.root.subPrdCount} sub-PRDs · ${uc} use case${uc === 1 ? "" : "s"}`,
  });

  const actions = section.createDiv({ cls: "e2e-test-hub-prd-roadmap-actions" });
  actions
    .createEl("button", { text: "New PRD", cls: "mod-cta" })
    .addEventListener("click", () => deps.openPrdBuilder());
  actions
    .createEl("button", { text: "View PRD tree", cls: "e2e-test-hub-doc-button" })
    .addEventListener("click", () => void deps.navigateToPrds());

  if (roadmap.children.length > 0) {
    const list = section.createEl("ul", { cls: "e2e-test-hub-prd-roadmap-list" });
    for (const child of roadmap.children) {
      const ucs = child.ucCount === 1 ? "1 UC" : `${child.ucCount} UCs`;
      list.createEl("li", {
        text: `${child.id}: ${child.title} (${ucs}) — ${child.status}`,
      });
    }
  }
};

/**
 * Wave C §1: the prominent "Initialize Test Hub" call-to-action shown when the
 * hub is not set up yet, with a one-line explanation. Opens the wizard.
 */
const renderInitializeCta = (container: HTMLElement, deps: DashboardViewDeps): void => {
  const panel = container.createDiv({ cls: "spec-panel e2e-test-hub-init-cta" });
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
    .addEventListener("click", () => deps.openWizard());
};

/**
 * Wave C §2: "Environment: <active>" badge in the top bar. With 2+
 * environments it is a button that opens a fuzzy picker to switch the active
 * environment; with one it renders non-interactive. Persisting + the success
 * Notice are owned by main.ts (the view never writes settings).
 */
const renderEnvironmentBadge = (
  container: HTMLElement,
  app: App,
  deps: DashboardViewDeps,
): void => {
  const { active, names } = deps.getEnvironments();
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
    new EnvironmentPickerModal(app, badge.options, badge.active, (name) => {
      if (name !== badge.active) void deps.switchEnvironment(name);
    }).open();
  });
};

/**
 * Wave C §1: the quick-action bar. A single primary "New Use Case" CTA plus a
 * compact grouped row (Create / Run / Open) so it stays scannable. The view is
 * thin — labels, grouping, and the primary flag come from {@link QUICK_ACTIONS}
 * and each id dispatches to a deps callback.
 */
const renderQuickActions = (container: HTMLElement, deps: DashboardViewDeps): void => {
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
      button.addEventListener("click", () => dispatchQuickAction(action.id, deps));
    }
  }
};

/** "Continue the guided tour" banner, hidden once completed or dismissed. */
const renderTourCta = (container: HTMLElement, deps: DashboardViewDeps): void => {
  if (!deps.tourVisible()) return;
  const banner = container.createDiv({ cls: "e2e-test-hub-tour-cta" });
  const button = banner.createEl("button", {
    text: "Continue the guided tour",
    cls: "mod-cta",
    attr: { "aria-label": "Continue the guided tour" },
  });
  button.addEventListener("click", () => deps.openGuidedTour());
};

/**
 * Wave G §2: the "Get started" panel for a first-time user — three numbered
 * steps as real buttons (create a Use Case, run the shipped demo, open the
 * Getting Started guide), each with a one-line explanation. The step model is
 * the pure {@link ONBOARDING_STEPS}; the view only renders and dispatches.
 */
const renderOnboarding = (container: HTMLElement, deps: DashboardViewDeps): void => {
  const panel = container.createDiv({ cls: "spec-panel e2e-test-hub-onboarding" });
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
      .addEventListener("click", () => dispatchOnboarding(step.action, deps));
    item.createDiv({ cls: "e2e-test-hub-onboarding-desc", text: step.description });
  }
};

/** Maps an {@link OnboardingActionId} to the EXISTING deps callback for it. */
const dispatchOnboarding = (id: OnboardingActionId, deps: DashboardViewDeps): void => {
  switch (id) {
    case "create-use-case":
      deps.openCreateUseCase();
      return;
    case "run-demo":
      void deps.runDemo();
      return;
    case "open-getting-started":
      void deps.openDocumentation("getting-started");
      return;
  }
};

/** Maps a {@link QuickActionId} to the deps callback that performs it. */
const dispatchQuickAction = (id: QuickActionId, deps: DashboardViewDeps): void => {
  switch (id) {
    case "new-use-case":
      deps.openCreateUseCase();
      return;
    case "new-suite":
      deps.openCreateSuite();
      return;
    case "run-all":
      void deps.runAll();
      return;
    case "run-demo":
      void deps.runDemo();
      return;
    case "generate-docs":
      void deps.generateDocumentation();
      return;
    case "open-use-cases":
      void deps.navigate("use-cases");
      return;
    case "open-suites":
      void deps.openSuites();
      return;
    case "open-console":
      void deps.openConsole();
      return;
  }
};

/** AC-016 documentation buttons (US-046: Getting Started / Manual / Troubleshooting). */
const renderDocumentationActions = (container: HTMLElement, deps: DashboardViewDeps): void => {
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
      void deps.openDocumentation(documentType);
    });
  }
};

import type { App } from "obsidian";
import type { ExecutionLogService } from "../../application/services/execution-log-service";
import type { TraceabilityService } from "../../application/services/traceability-service";
import { projectDashboard, type DashboardNavTarget, type KpiTile } from "./dashboard-rows";
import {
  formatLastRunAge,
  projectHealthHero,
  projectLastRun,
  type HealthHero,
  type HealthLastRun,
} from "./health-hero-rows";
import { renderLoadError } from "./modal-helpers";

/**
 * The deps the Overview hero body needs, independent of the leaf (E1 PR2 body
 * split). It owns the health hero (the pass-rate ring + verdict + the durable
 * execution log's last-run line), the two primary actions, and the KPI funnel.
 * NO environment label (the roll-up is env-agnostic), NO onboarding/tour/docs
 * (those belong to B2's onboarding rail). Loads its own data so the hub calls it
 * the same way as every other in-hub body (ADR-0031).
 */
export interface OverviewHeroBodyDeps {
  traceabilityService: Pick<TraceabilityService, "snapshot">;
  /** The durable execution log read path (E1): the honest last-run verdict. */
  executionLogService: Pick<ExecutionLogService, "latest">;
  /**
   * Wave C §1: a REAL initialization signal — does the Test Hub vault structure
   * exist? A fresh vault's missing Use Cases folder lists as `ok([])`, so the
   * snapshot can't tell "not set up" from "set up but empty".
   */
  isInitialized: () => Promise<boolean>;
  /** Opens the setup wizard from the Initialize CTA. */
  openWizard: () => void;
  /** Primary action: create a Use Case. */
  openCreateUseCase: () => void;
  /** Primary action: run all tests. */
  runAll: () => void | Promise<void>;
  /** Wave C §4 / PR3: a KPI funnel tile drills into the Use Cases explorer. */
  navigate: (target: DashboardNavTarget) => void | Promise<void>;
  /** Re-renders the body (load-error retry). */
  refresh: () => void;
}

/**
 * Renders the Overview hero body into `el` (host-agnostic, ADR-0031) in INTENT
 * ORDER (the redesign): the health hero (pass-rate ring + verdict + last-run
 * line) → the primary actions (Run / New Use Case) → the KPI funnel bars. Keeps
 * the Initialize CTA gate and the retryable snapshot load-error lifted from the
 * legacy combined body. Built entirely with `createEl`/`createDiv`/`setText`
 * (never innerHTML); the ring is hidden on the no-rate empty state. Status colour
 * is `--spec-status-*`, the brand `--spec-accent` stays on chrome.
 */
export const renderOverviewHeroBody = async (
  el: HTMLElement,
  _app: App,
  deps: OverviewHeroBodyDeps,
): Promise<void> => {
  el.empty();

  // Initialize gate: a fresh, un-scaffolded vault gets the prominent CTA, not a
  // hero over zeroed counts.
  if (!(await deps.isInitialized())) {
    renderInitializeCta(el, deps);
    return;
  }

  // The non-emitting snapshot (P2-6): projecting it must not re-publish
  // dashboard.* events, so an event-driven re-render can't loop.
  const result = await deps.traceabilityService.snapshot();
  if (!result.ok) {
    renderLoadError(
      el,
      `Could not load the health summary: ${result.error.message}`,
      "Retry loading the health summary",
      () => deps.refresh(),
    );
    return;
  }

  const hero = projectHealthHero(result.value);
  const lastRun = projectLastRun(await deps.executionLogService.latest());
  const view = projectDashboard(result.value);

  renderHero(el, hero, lastRun);
  renderPrimaryActions(el, deps);
  renderFunnel(el, view.kpis, deps);
};

/** The prominent "Initialize Test Hub" CTA shown before the vault is scaffolded. */
const renderInitializeCta = (container: HTMLElement, deps: OverviewHeroBodyDeps): void => {
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
 * The health hero: the pass-rate ring + percentage, the verdict line, and the
 * last-run line. On the `no-rate` empty state the ring is HIDDEN and an explicit
 * empty-state message shows instead (never a divide-by-zero).
 */
const renderHero = (
  container: HTMLElement,
  hero: HealthHero,
  lastRun: HealthLastRun | null,
): void => {
  const heroEl = container.createDiv({
    cls: "spec-hub-hero",
    attr: { role: "group", "aria-label": hero.ariaLabel },
  });

  switch (hero.kind) {
    case "no-rate":
      heroEl.createDiv({ cls: "spec-hub-hero-empty", text: hero.message });
      break;
    case "rate": {
      const ring = heroEl.createDiv({ cls: "spec-hub-hero-ring", attr: { "aria-hidden": "true" } });
      // The ring draws its sweep from the rate via a CSS custom property; the
      // percentage text inside it carries the same number for non-sighted users
      // (the group's aria-label spells out the full verdict).
      ring.style.setProperty("--spec-hero-rate", String(hero.ratePercent));
      ring.createDiv({ cls: "spec-hub-hero-percent", text: `${String(hero.ratePercent)}%` });
      heroEl.createDiv({ cls: "spec-hub-hero-verdict", text: hero.verdict });
      break;
    }
  }

  renderLastRun(heroEl, lastRun);
};

/** The last-run line — log-driven (independent of the rate); skipped when absent. */
const renderLastRun = (heroEl: HTMLElement, lastRun: HealthLastRun | null): void => {
  if (lastRun === null) return;
  const line = heroEl.createDiv({ cls: "spec-hub-hero-last-run" });
  line.dataset.tone = lastRun.tone;
  const when = formatLastRunAge(lastRun.finishedAt, Date.now());
  line.setText(`Last run: ${lastRun.statusLabel}${when === null ? "" : ` · ${when}`}`);
};

/** The two primary actions: Run (all) and New Use Case (the single primary CTA). */
const renderPrimaryActions = (container: HTMLElement, deps: OverviewHeroBodyDeps): void => {
  const actions = container.createDiv({ cls: "spec-hub-hero-actions" });
  actions
    .createEl("button", {
      text: "New Use Case",
      cls: "spec-hub-hero-action mod-cta",
      attr: { "aria-label": "Create a new Use Case" },
    })
    .addEventListener("click", () => deps.openCreateUseCase());
  actions
    .createEl("button", {
      text: "Run all tests",
      cls: "spec-hub-hero-action",
      attr: { "aria-label": "Run all tests" },
    })
    .addEventListener("click", () => void deps.runAll());
};

/**
 * The KPI funnel: one bar per tile, each a focusable `<button>` that drills into
 * the Use Cases explorer carrying its funnel filter. The bar fill draws the
 * of-Total percent via a CSS custom property; a non-zero Failing tile draws the
 * alert tone. The value+label text always remains, so a tile is never read by
 * colour or width alone (colour-blind / high-contrast safe).
 */
const renderFunnel = (
  container: HTMLElement,
  kpis: readonly KpiTile[],
  deps: OverviewHeroBodyDeps,
): void => {
  const funnel = container.createDiv({
    cls: "spec-hub-funnel",
    attr: { role: "list", "aria-label": "Use Case funnel" },
  });
  for (const tile of kpis) renderFunnelTile(funnel, tile, deps);
};

/** One funnel bar: value, label, optional of-Total percent, and the drill-down. */
const renderFunnelTile = (funnel: HTMLElement, tile: KpiTile, deps: OverviewHeroBodyDeps): void => {
  const bar = funnel.createEl("button", {
    cls: "spec-hub-funnel-tile",
    attr: { role: "listitem", "aria-label": tile.ariaLabel },
  });
  bar.dataset.tone = tile.tone;
  // The fill width is the of-Total percent; the head tile (no percent) fills
  // fully so it reads as the baseline.
  bar.style.setProperty("--spec-funnel-fill", String(tile.percent ?? 100));
  bar.createDiv({ cls: "spec-hub-funnel-value", text: String(tile.value) });
  bar.createDiv({ cls: "spec-hub-funnel-label", text: tile.label });
  if (tile.percent !== null) {
    bar.createDiv({ cls: "spec-hub-funnel-percent", text: `${String(tile.percent)}%` });
  }
  bar.addEventListener("click", () => void deps.navigate(tile.navigateTo));
};

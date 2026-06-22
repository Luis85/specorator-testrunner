import type { GuidedTourService } from "../../application/services/guided-tour-service";
import type { TourActionId } from "../../domain/onboarding/tour-steps";
import { renderLoadError } from "./modal-helpers";
import {
  projectOnboarding,
  type OnboardingRail,
  type OnboardingInit,
} from "./onboarding-rail-rows";
import { renderTourStep } from "./tour-step-body";

/**
 * The docked onboarding rail's renderer (WS-B2 PR3): the thin DOM writer that
 * fills the hub's reserved bottom slot over the pure {@link projectOnboarding}
 * orchestrator. It resolves the three live inputs — whether the vault is
 * initialized, the Use Case count, and the Guided Tour state — projects the
 * single next action, and renders it (the Initialize CTA, the first-Use-Case
 * CTA, the tour checklist via the shared {@link renderTourStep}, or the
 * dismissible done line). Coverage-exempt via the `*-body.ts` glob, the same as
 * every other hub body: the decisions live in the covered projection, this is
 * DOM-building only (`createEl`/`createDiv`/`setText`, never innerHTML).
 */
export interface OnboardingRailBodyDeps {
  /** Real init signal — does the Test Hub vault structure exist (mirrors the hero)? */
  isInitialized: () => Promise<boolean>;
  /** The snapshot's totalUseCases; the impl Result-handles a failed snapshot load. */
  ucCount: () => Promise<number>;
  /** The tour service the rail READS + dismiss/restart/markDone/skip CALLS through. */
  tour: Pick<GuidedTourService, "getState" | "dismiss" | "restart" | "markDone" | "skip">;
  /** Routes a tour step's action button (the shared {@link dispatchTourAction}). */
  dispatchTourAction: (id: TourActionId) => void;
  /** Opens the setup wizard from the Initialize CTA. */
  openWizard: () => void;
  /** Primary first-Use-Case CTA: create a Use Case. */
  openCreateUseCase: () => void;
  /** Secondary first-Use-Case aside: start (restart) the guided tour. */
  startTour: () => void | Promise<void>;
  /** Hub-owned ephemeral collapse (chrome) — distinct from Dismiss (persisted). */
  collapsed: boolean;
  /** Toggles {@link collapsed} and re-renders. */
  onToggleCollapsed: () => void;
  /** Re-renders the rail (load-error retry / event refresh). */
  refresh: () => void;
}

/**
 * Renders the onboarding rail into `el`. Loads the live inputs (the snapshot only
 * on an initialized vault, to avoid a needless load on a fresh one), projects the
 * single next action, then dispatches it exhaustively. Never throws into the
 * hub's `render()` — a failed snapshot load degrades to a retryable
 * {@link renderLoadError}, the hero's pattern.
 */
// The load-failed / hidden / collapsed guard returns read as branching, but each
// is a single early return; CRAP-inflated only because this body is
// coverage-exempt (its decisions live in the covered projectOnboarding).
// fallow-ignore-next-line complexity
export const renderOnboardingRailBody = async (
  el: HTMLElement,
  deps: OnboardingRailBodyDeps,
): Promise<void> => {
  el.empty();

  const rail = await resolveRail(deps);
  if (rail === "load-failed") {
    renderLoadError(
      el,
      "Could not load the onboarding rail.",
      "Retry loading the onboarding rail",
      () => deps.refresh(),
    );
    return;
  }
  if (rail.kind === "hidden") return;

  const railEl = el.createDiv({
    cls: deps.collapsed ? "spec-hub-onboarding is-collapsed" : "spec-hub-onboarding",
    attr: { role: "group", "aria-label": rail.ariaLabel },
  });
  renderToggle(railEl, deps, headerText(rail));
  if (deps.collapsed) return;

  renderBody(railEl, rail, deps);
};

/**
 * Resolves the three live inputs into the projected rail, or `"load-failed"` when
 * the Use Case snapshot read failed (so the caller renders the retryable load
 * error rather than throwing). The snapshot is loaded ONLY on an initialized
 * vault — a fresh vault's "initialize" branch needs no count, so the needless
 * load (and its failure path) is avoided entirely.
 */
const resolveRail = async (
  deps: OnboardingRailBodyDeps,
): Promise<OnboardingRail | "load-failed"> => {
  const init: OnboardingInit = (await deps.isInitialized()) ? "initialized" : "not-initialized";
  if (init === "not-initialized") {
    return projectOnboarding(init, 0, deps.tour.getState());
  }
  const ucCount = await loadUcCount(deps);
  if (ucCount === null) return "load-failed";
  return projectOnboarding(init, ucCount, deps.tour.getState());
};

/**
 * Loads the Use Case count, returning `null` when the underlying snapshot read
 * failed so the caller renders the retryable load error rather than throwing. The
 * Result handling lives in the wiring's `ucCount` impl; a thrown rejection here
 * (a defensive guard) maps to the same `null` failure path.
 */
const loadUcCount = async (deps: OnboardingRailBodyDeps): Promise<number | null> => {
  try {
    return await deps.ucCount();
  } catch {
    return null;
  }
};

// An exhaustive switch over the rail union — its CC is the arm count, the same
// shape as HubView.renderBody. The only "complexity" is the CRAP inflation from
// this `*-body.ts` being coverage-exempt (DOM-building, asserted through the
// covered projectOnboarding); the decision logic carries no real branching.
/** The compact header line shown collapsed (and above the body expanded). */
// fallow-ignore-next-line complexity
const headerText = (rail: Exclude<OnboardingRail, { kind: "hidden" }>): string => {
  switch (rail.kind) {
    case "initialize":
    case "first-use-case":
      return rail.title;
    case "tour":
      return `Next: ${rail.nextAction}`;
    case "done":
      return rail.message;
  }
};

/** The collapse/expand chevron + the compact header text it toggles around. */
const renderToggle = (railEl: HTMLElement, deps: OnboardingRailBodyDeps, header: string): void => {
  const bar = railEl.createDiv({ cls: "spec-hub-onboarding-header" });
  const toggle = bar.createEl("button", {
    cls: "spec-hub-onboarding-toggle",
    text: deps.collapsed ? "▸" : "▾",
    attr: {
      "aria-expanded": deps.collapsed ? "false" : "true",
      "aria-label": deps.collapsed ? "Expand the onboarding rail" : "Collapse the onboarding rail",
    },
  });
  toggle.addEventListener("click", () => deps.onToggleCollapsed());
  bar.createDiv({ cls: "spec-hub-onboarding-title", text: header });
};

// Exhaustive arm dispatch (no default) — CC is the arm count, CRAP-inflated only
// because this body file is coverage-exempt; mirrors HubView.renderBody.
/** Dispatches the expanded body for each rail arm (exhaustive — no default). */
// fallow-ignore-next-line complexity
const renderBody = (
  railEl: HTMLElement,
  rail: Exclude<OnboardingRail, { kind: "hidden" }>,
  deps: OnboardingRailBodyDeps,
): void => {
  const body = railEl.createDiv({ cls: "spec-hub-onboarding-body" });
  switch (rail.kind) {
    case "initialize":
      renderInitialize(body, rail, deps);
      return;
    case "first-use-case":
      renderFirstUseCase(body, rail, deps);
      return;
    case "tour":
      renderTour(body, rail, deps);
      return;
    case "done":
      renderDone(body, rail, deps);
      return;
  }
};

/** The pre-scaffold branch: the teach line + the Initialize CTA. */
const renderInitialize = (
  body: HTMLElement,
  rail: Extract<OnboardingRail, { kind: "initialize" }>,
  deps: OnboardingRailBodyDeps,
): void => {
  body.createDiv({ cls: "spec-hub-onboarding-teach", text: rail.teach });
  body
    .createEl("button", {
      text: rail.cta.label,
      cls: "spec-hub-onboarding-cta mod-cta",
      attr: { "aria-label": rail.cta.ariaLabel },
    })
    .addEventListener("click", () => deps.openWizard());
};

/** The empty-but-initialized branch: the first Use Case CTA + the tour aside. */
const renderFirstUseCase = (
  body: HTMLElement,
  rail: Extract<OnboardingRail, { kind: "first-use-case" }>,
  deps: OnboardingRailBodyDeps,
): void => {
  body.createDiv({ cls: "spec-hub-onboarding-teach", text: rail.teach });
  const actions = body.createDiv({ cls: "spec-hub-onboarding-actions" });
  actions
    .createEl("button", {
      text: rail.primary.label,
      cls: "spec-hub-onboarding-cta mod-cta",
      attr: { "aria-label": rail.primary.ariaLabel },
    })
    .addEventListener("click", () => deps.openCreateUseCase());
  actions
    .createEl("button", {
      text: rail.secondary.label,
      cls: "spec-hub-onboarding-cta",
      attr: { "aria-label": rail.secondary.ariaLabel },
    })
    .addEventListener("click", () => void deps.startTour());
};

/** The active tour: the checklist via the shared renderer, progress, and Dismiss. */
const renderTour = (
  body: HTMLElement,
  rail: Extract<OnboardingRail, { kind: "tour" }>,
  deps: OnboardingRailBodyDeps,
): void => {
  const steps = body.createDiv({ cls: "spec-hub-onboarding-steps" });
  for (const row of rail.tour.rows) {
    renderTourStep(steps, row, {
      dispatch: deps.dispatchTourAction,
      markDone: (id) => void deps.tour.markDone(id),
      skip: (id) => void deps.tour.skip(id),
    });
  }
  body.createDiv({ cls: "spec-hub-onboarding-progress", text: rail.tour.progressLabel });
  const actions = body.createDiv({ cls: "spec-hub-onboarding-actions" });
  actions
    .createEl("button", {
      text: "Dismiss",
      cls: "spec-hub-onboarding-cta",
      attr: { "aria-label": "Hide the onboarding rail" },
    })
    .addEventListener("click", () => void deps.tour.dismiss());
};

/** The completed branch: the closure line + Dismiss and Restart affordances. */
const renderDone = (
  body: HTMLElement,
  rail: Extract<OnboardingRail, { kind: "done" }>,
  deps: OnboardingRailBodyDeps,
): void => {
  body.createDiv({ cls: "spec-hub-onboarding-teach", text: rail.message });
  const actions = body.createDiv({ cls: "spec-hub-onboarding-actions" });
  actions
    .createEl("button", {
      text: "Dismiss",
      cls: "spec-hub-onboarding-cta mod-cta",
      attr: { "aria-label": "Hide the onboarding rail" },
    })
    .addEventListener("click", () => void deps.tour.dismiss());
  actions
    .createEl("button", {
      text: "Restart tour",
      cls: "spec-hub-onboarding-cta",
      attr: { "aria-label": "Restart the guided tour from the beginning" },
    })
    .addEventListener("click", () => void deps.tour.restart());
};

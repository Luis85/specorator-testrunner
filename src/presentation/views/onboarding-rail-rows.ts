import type { TourState } from "../../application/services/guided-tour-service";
import { projectTour, TOUR_DONE_MESSAGE, type TourViewModel } from "./guided-tour-rows";

/**
 * The docked onboarding rail (WS-B2): a "single next action" orchestrator that
 * UNIFIES the three onboarding inputs — whether the vault is initialized, how
 * many Use Cases exist, and the Guided Tour's state — into ONE rail model. It
 * exists because the tour service alone cannot produce the pre-initialization
 * step (the vault is not yet scaffolded, so there is no tour to render); this
 * projection layers that branch in front of the tour and composes
 * {@link projectTour} for the tour itself. Pure — no I/O, no Obsidian imports —
 * so the (DOM-only) docked renderer (PR3) stays a thin render over a fully
 * unit-tested logic core, the direct analogue of `dashboard-rows.ts` /
 * `health-hero-rows.ts` (ADR-0029). The standalone `GuidedTourView` and this
 * docked rail COEXIST, both rendering the tour from this one projection.
 */

/** Whether the vault has been scaffolded into a Test Hub yet. */
export type OnboardingInit = "not-initialized" | "initialized";

/**
 * The single next onboarding action, a discriminated union:
 * - `initialize` — the vault is not yet a Test Hub; the rail teaches the setup
 *   and offers the Initialize CTA (the branch the tour service can't produce).
 * - `first-use-case` — an empty (but initialized) hub with a not-yet-started
 *   tour: the rail offers the first Use Case, with the guided tour as an aside.
 * - `tour` — the Guided Tour is underway; the rail renders the composed
 *   {@link TourViewModel} plus the active step's title as the next action.
 * - `done` — onboarding completed: a DISMISSIBLE closure line (product
 *   decision: the rail shows a "done" state, it does NOT auto-hide).
 * - `hidden` — the rail renders nothing (the tour was dismissed).
 */
export type OnboardingRail =
  | {
      kind: "initialize";
      title: string;
      teach: string;
      cta: { label: string; ariaLabel: string };
      ariaLabel: string;
    }
  | {
      kind: "first-use-case";
      title: string;
      teach: string;
      /** The primary CTA: create the first Use Case. */
      primary: { label: string; ariaLabel: string };
      /** The secondary aside: start the guided tour instead. */
      secondary: { label: string; ariaLabel: string };
      ariaLabel: string;
    }
  | { kind: "tour"; tour: TourViewModel; nextAction: string; ariaLabel: string }
  | { kind: "done"; message: string; ariaLabel: string }
  | { kind: "hidden" };

/** Copy for the pre-initialization step (the vault is not yet a Test Hub). */
const INITIALIZE_TITLE = "Set up your Test Hub";
const INITIALIZE_TEACH =
  "Scaffold this vault to create Use Cases, write specifications, and run tests.";
const INITIALIZE_CTA_LABEL = "Initialize Test Hub";
const INITIALIZE_CTA_ARIA = "Initialize the Test Hub";

/** Copy for the empty-but-initialized hub (first Use Case, tour as an aside). */
const FIRST_UC_TITLE = "Create your first Use Case";
const FIRST_UC_TEACH =
  "Start from a business-facing capability, then generate a feature and run it.";
const FIRST_UC_PRIMARY_LABEL = "New Use Case";
const FIRST_UC_PRIMARY_ARIA = "Create a new Use Case";
const FIRST_UC_SECONDARY_LABEL = "Start guided tour";
const FIRST_UC_SECONDARY_ARIA = "Start the guided tour";

/**
 * Projects the three onboarding inputs into the single next action. The phase
 * order is FIRST MATCH WINS and deliberate:
 * 1. `not-initialized` → `initialize` — the pre-scaffold branch the tour can't
 *    produce, so it sits ahead of everything.
 * 2. initialized + no Use Cases + a not-yet-started tour → `first-use-case`.
 *    Placed ABOVE `dismissed` so a fresh/empty vault still gets a CTA even if a
 *    stale `dismissed` flag lingers.
 * 3. tour dismissed → `hidden` — below the two CTA branches, above tour/done.
 * 4. tour completed → `done` — the dismissible closure line.
 * 5. otherwise → `tour` — the composed {@link projectTour} view model, with the
 *    active step's title as the next action.
 * Pure: no I/O, the tour rows are COMPOSED (never re-derived) from
 * {@link projectTour}.
 */
export const projectOnboarding = (
  init: OnboardingInit,
  ucCount: number,
  tourState: TourState,
): OnboardingRail => {
  if (init === "not-initialized") {
    return {
      kind: "initialize",
      title: INITIALIZE_TITLE,
      teach: INITIALIZE_TEACH,
      cta: { label: INITIALIZE_CTA_LABEL, ariaLabel: INITIALIZE_CTA_ARIA },
      ariaLabel: INITIALIZE_CTA_ARIA,
    };
  }

  if (ucCount === 0 && tourNotStarted(tourState)) {
    return {
      kind: "first-use-case",
      title: FIRST_UC_TITLE,
      teach: FIRST_UC_TEACH,
      primary: { label: FIRST_UC_PRIMARY_LABEL, ariaLabel: FIRST_UC_PRIMARY_ARIA },
      secondary: { label: FIRST_UC_SECONDARY_LABEL, ariaLabel: FIRST_UC_SECONDARY_ARIA },
      ariaLabel: FIRST_UC_TITLE,
    };
  }

  if (tourState.dismissed) {
    return { kind: "hidden" };
  }

  if (tourState.completed) {
    return { kind: "done", message: TOUR_DONE_MESSAGE, ariaLabel: TOUR_DONE_MESSAGE };
  }

  const tour = projectTour(tourState);
  const nextAction = nextActionFor(tour);
  return { kind: "tour", tour, nextAction, ariaLabel: `Next: ${nextAction}` };
};

/**
 * Whether the tour has NOT been started — read off the authoritative
 * {@link TourState.started} (a `tourId` has been minted), NOT the step statuses:
 * a brand-new tour already marks its first step `active` (the cursor), so an
 * all-step check would never match a real fresh tour and would drop the
 * empty-hub `first-use-case` CTA (codex P2). Reading `started` ALSO lets the
 * secondary "Start guided tour" CTA work: `restart()` mints a `tourId`, so the
 * next projection flips out of `first-use-case` into the `tour` branch (codex
 * P2). Completed/dismissed are handled by their own branches.
 */
const tourNotStarted = (state: TourState): boolean =>
  !state.started && !state.completed && !state.dismissed;

/**
 * The title of the active step, the body prefixes with "Next: ". `completed` is
 * handled before this is called, so there is normally an active row; the
 * progress label is a defensive fallback (never throw) should none be active.
 */
const nextActionFor = (tour: TourViewModel): string => {
  const active = tour.rows.find((row) => row.status === "active");
  return active?.title ?? tour.progressLabel;
};

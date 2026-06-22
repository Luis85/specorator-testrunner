import { describe, expect, it } from "vitest";
import type {
  TourState,
  TourStepState,
  TourStepStatus,
} from "../src/application/services/guided-tour-service";
import { projectTour, TOUR_DONE_MESSAGE } from "../src/presentation/views/guided-tour-rows";
import { projectOnboarding } from "../src/presentation/views/onboarding-rail-rows";
import { TOUR_STEPS } from "../src/domain/onboarding/tour-steps";

/**
 * A minimal TourState fixture: every step `pending` by default (a fresh tour),
 * with overrides for the first few step statuses so a test can mark one
 * done/active. The projection only reads `status`, `completed`, `dismissed`, and
 * (via projectTour) each step's `definition`, so the real step table is reused.
 */
const tourState = (over: {
  statuses?: TourStepStatus[];
  completed?: boolean;
  dismissed?: boolean;
}): TourState => {
  const steps: TourStepState[] = TOUR_STEPS.map((definition, i) => ({
    definition,
    status: over.statuses?.[i] ?? "pending",
    armed: false,
  }));
  return {
    steps,
    completed: over.completed ?? false,
    dismissed: over.dismissed ?? false,
  };
};

/** The default fresh tour: all steps pending, not completed, not dismissed. */
const freshTour = (): TourState => tourState({});

/** A started tour: first step done, second active. */
const startedTour = (): TourState => tourState({ statuses: ["done", "active"] });

describe("projectOnboarding", () => {
  describe("initialize phase (not-initialized wins over everything)", () => {
    it("returns initialize regardless of ucCount and tour state", () => {
      const rail = projectOnboarding("not-initialized", 0, freshTour());
      expect(rail).toEqual({
        kind: "initialize",
        title: "Set up your Test Hub",
        teach: "Scaffold this vault to create Use Cases, write specifications, and run tests.",
        cta: { label: "Initialize Test Hub", ariaLabel: "Initialize the Test Hub" },
        ariaLabel: "Initialize the Test Hub",
      });
    });

    it("still returns initialize even when Use Cases exist and the tour is dismissed/completed", () => {
      const rail = projectOnboarding(
        "not-initialized",
        5,
        tourState({ completed: true, dismissed: true }),
      );
      expect(rail.kind).toBe("initialize");
    });
  });

  describe("first-use-case phase (initialized, empty, fresh tour)", () => {
    it("returns first-use-case for an empty hub with a not-yet-started tour", () => {
      const rail = projectOnboarding("initialized", 0, freshTour());
      expect(rail).toEqual({
        kind: "first-use-case",
        title: "Create your first Use Case",
        teach: "Start from a business-facing capability, then generate a feature and run it.",
        primary: { label: "New Use Case", ariaLabel: "Create a new Use Case" },
        secondary: { label: "Start guided tour", ariaLabel: "Start the guided tour" },
        ariaLabel: "Create your first Use Case",
      });
    });

    it("does NOT regress a STARTED tour back to first-use-case when ucCount is 0", () => {
      const rail = projectOnboarding("initialized", 0, startedTour());
      expect(rail.kind).toBe("tour");
    });
  });

  describe("tour phase", () => {
    it("returns tour with the active step's title as nextAction, composing projectTour", () => {
      const state = startedTour();
      const rail = projectOnboarding("initialized", 3, state);
      if (rail.kind !== "tour") throw new Error(`expected tour, got ${rail.kind}`);
      // Proves COMPOSITION, not re-derivation.
      expect(rail.tour).toEqual(projectTour(state));
      const active = rail.tour.rows.find((row) => row.status === "active");
      expect(rail.nextAction).toBe(active?.title);
      expect(rail.ariaLabel).toBe(`Next: ${rail.nextAction}`);
    });

    it("falls back to the progress label (never throws) when no row is active", () => {
      // All steps skipped but NOT completed/dismissed: no active row, a defensive
      // shape projectOnboarding handles without throwing.
      const skipped: TourStepStatus[] = TOUR_STEPS.map(() => "skipped");
      const state = tourState({ statuses: skipped });
      const rail = projectOnboarding("initialized", 1, state);
      if (rail.kind !== "tour") throw new Error(`expected tour, got ${rail.kind}`);
      expect(rail.nextAction).toBe(rail.tour.progressLabel);
    });
  });

  describe("dismissed phase", () => {
    it("returns hidden when the tour is dismissed", () => {
      const rail = projectOnboarding("initialized", 2, tourState({ dismissed: true }));
      expect(rail).toEqual({ kind: "hidden" });
    });

    it("beats tour and done, but NOT initialize", () => {
      // Dismissed + underway → hidden (beats tour).
      expect(
        projectOnboarding("initialized", 2, tourState({ statuses: ["active"], dismissed: true }))
          .kind,
      ).toBe("hidden");
      // Dismissed + completed → hidden (beats done).
      expect(
        projectOnboarding("initialized", 2, tourState({ completed: true, dismissed: true })).kind,
      ).toBe("hidden");
      // Not-initialized + dismissed → initialize (initialize still wins).
      expect(projectOnboarding("not-initialized", 2, tourState({ dismissed: true })).kind).toBe(
        "initialize",
      );
    });
  });

  describe("done phase", () => {
    it("returns done with the canonical completion message", () => {
      const rail = projectOnboarding("initialized", 4, tourState({ completed: true }));
      expect(rail).toEqual({
        kind: "done",
        message: TOUR_DONE_MESSAGE,
        ariaLabel: TOUR_DONE_MESSAGE,
      });
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  computeAutomationStatus,
  type ScenarioLatestStatus,
  type ScenarioStatusLookup,
} from "../src/domain/policies/use-case-automation-policy";
import type { FeatureSpecification } from "../src/domain/entities/specification";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const feature = (over: Partial<FeatureSpecification> = {}): FeatureSpecification => ({
  path: vp("Specifications/features/UC-001.feature"),
  useCaseId: "UC-001",
  featureName: "Demo",
  tags: [],
  scenarios: [{ name: "S1", tags: [], steps: [{ keyword: "Given", text: "x" }] }],
  ...over,
});

/** Scenario Reference of a plain scenario in a feature (`<path>::<name>`). */
const refOf = (feat: FeatureSpecification, scenarioName: string): string =>
  `${String(feat.path)}::${scenarioName}`;

/** A history lookup backed by an explicit ref→status map; unknown refs = unrun. */
const history =
  (entries: Record<string, ScenarioLatestStatus>): ScenarioStatusLookup =>
  (ref) =>
    entries[ref];

/** No scenario has ever run. */
const noHistory: ScenarioStatusLookup = () => undefined;

describe("computeAutomationStatus (ADR-0017 roll-up, history-derived — US-057)", () => {
  it("not-planned when no Features exist", () => {
    expect(computeAutomationStatus([], noHistory)).toBe("not-planned");
  });

  it("planned when Features exist but no scenario has run", () => {
    expect(computeAutomationStatus([feature()], noHistory)).toBe("planned");
  });

  it("missing-steps when a Feature has a scenario with no steps", () => {
    const incomplete = feature({ scenarios: [{ name: "S1", tags: [], steps: [] }] });
    // Outranks any run history.
    expect(
      computeAutomationStatus([incomplete], history({ [refOf(incomplete, "S1")]: "passed" })),
    ).toBe("missing-steps");
  });

  it("missing-steps when a Feature declares no scenarios", () => {
    expect(computeAutomationStatus([feature({ scenarios: [] })], noHistory)).toBe("missing-steps");
  });

  it("passing when the Feature's only scenario's latest result passed", () => {
    const f = feature();
    expect(computeAutomationStatus([f], history({ [refOf(f, "S1")]: "passed" }))).toBe("passing");
  });

  it("failing when a scenario's latest result failed", () => {
    const f = feature();
    expect(computeAutomationStatus([f], history({ [refOf(f, "S1")]: "failed" }))).toBe("failing");
  });

  it("implemented when a scenario ran but only skipped (exercised, not passing)", () => {
    const f = feature();
    expect(computeAutomationStatus([f], history({ [refOf(f, "S1")]: "skipped" }))).toBe(
      "implemented",
    );
  });

  describe("multi-Feature roll-up (per-scenario, no floor)", () => {
    const f1 = feature({ path: vp("Specifications/features/UC-001-a.feature") });
    const f2 = feature({ path: vp("Specifications/features/UC-001-b.feature") });

    it("passing only when every Feature's scenarios all passed", () => {
      expect(
        computeAutomationStatus(
          [f1, f2],
          history({ [refOf(f1, "S1")]: "passed", [refOf(f2, "S1")]: "passed" }),
        ),
      ).toBe("passing");
    });

    it("implemented when one Feature passed and the other never ran", () => {
      expect(computeAutomationStatus([f1, f2], history({ [refOf(f1, "S1")]: "passed" }))).toBe(
        "implemented",
      );
    });

    it("failing when any Feature has a failed scenario", () => {
      expect(
        computeAutomationStatus(
          [f1, f2],
          history({ [refOf(f1, "S1")]: "passed", [refOf(f2, "S1")]: "failed" }),
        ),
      ).toBe("failing");
    });

    it("a targeted pass of one Feature does not by itself make the whole UC passing", () => {
      // The replacement for the old "floor": no persisted status is consulted —
      // f2 simply has no history, so the UC is still only partially exercised.
      expect(computeAutomationStatus([f1, f2], history({ [refOf(f1, "S1")]: "passed" }))).toBe(
        "implemented",
      );
    });

    it("siblings keep their last-known status across a targeted rerun (no regression)", () => {
      // Both passed earlier; a later rerun touches only f1 (still passing). f2's
      // recorded pass remains, so the UC stays passing — no floor needed.
      expect(
        computeAutomationStatus(
          [f1, f2],
          history({ [refOf(f1, "S1")]: "passed", [refOf(f2, "S1")]: "passed" }),
        ),
      ).toBe("passing");
    });
  });

  describe("per-scenario granularity within one Feature", () => {
    const f = feature({
      scenarios: [
        { name: "A", tags: [], steps: [{ keyword: "Given", text: "x" }] },
        { name: "B", tags: [], steps: [{ keyword: "Given", text: "x" }] },
      ],
    });

    it("passing only when all scenarios passed", () => {
      expect(
        computeAutomationStatus(
          [f],
          history({ [refOf(f, "A")]: "passed", [refOf(f, "B")]: "passed" }),
        ),
      ).toBe("passing");
    });

    it("implemented when some scenarios passed and others never ran", () => {
      expect(computeAutomationStatus([f], history({ [refOf(f, "A")]: "passed" }))).toBe(
        "implemented",
      );
    });

    it("failing when any scenario failed even if others passed", () => {
      expect(
        computeAutomationStatus(
          [f],
          history({ [refOf(f, "A")]: "passed", [refOf(f, "B")]: "failed" }),
        ),
      ).toBe("failing");
    });
  });

  describe("@wip exclusion (Feature granularity)", () => {
    it("excludes a @wip Feature so a lone @wip Feature counts as no Features", () => {
      const wip = feature({ tags: ["@wip"] });
      expect(computeAutomationStatus([wip], history({ [refOf(wip, "S1")]: "passed" }))).toBe(
        "not-planned",
      );
    });

    it("ignores undefined steps inside a @wip Feature", () => {
      const wipIncomplete = feature({ tags: ["@wip"], scenarios: [] });
      const good = feature({ path: vp("Specifications/features/UC-001b.feature") });
      // Only the non-@wip Feature counts; it is complete but never run.
      expect(computeAutomationStatus([wipIncomplete, good], noHistory)).toBe("planned");
    });

    it("matches @wip case-insensitively", () => {
      const wip = feature({ tags: ["@WIP"] });
      expect(computeAutomationStatus([wip], history({ [refOf(wip, "S1")]: "passed" }))).toBe(
        "not-planned",
      );
    });
  });

  describe("all-unresolved-Feature edge (ADR-0022)", () => {
    it("treats a Feature whose scenarios have no history as not-run", () => {
      // Every ref unresolved → not-run → with a sibling that passed, implemented.
      const f1 = feature({ path: vp("Specifications/features/UC-001-a.feature") });
      const f2 = feature({ path: vp("Specifications/features/UC-001-b.feature") });
      expect(computeAutomationStatus([f1, f2], history({ [refOf(f1, "S1")]: "passed" }))).toBe(
        "implemented",
      );
    });
  });
});

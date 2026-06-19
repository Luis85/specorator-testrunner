import { describe, expect, it } from "vitest";
import {
  computeAutomationStatus,
  type ScenarioLatestStatus,
  type ScenarioStatusLookup,
} from "../src/domain/policies/use-case-automation-policy";
import type { FeatureSpecification } from "../src/domain/entities/specification";
import { parseFeature } from "../src/application/content/gherkin";
import { featureScenarioRefs } from "../src/domain/value-objects/scenario-reference";
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

  describe("@quarantine exclusion (scenario granularity, US-058)", () => {
    const step = { keyword: "Given" as const, text: "x" };
    const quarantined = (name: string) => ({ name, tags: ["@quarantine"], steps: [step] });
    const active = (name: string) => ({ name, tags: [] as string[], steps: [step] });

    it("a quarantined failing scenario does not fail its Use Case", () => {
      const f = feature({ scenarios: [quarantined("Flaky"), active("Solid")] });
      expect(
        computeAutomationStatus(
          [f],
          history({ [refOf(f, "Flaky")]: "failed", [refOf(f, "Solid")]: "passed" }),
        ),
      ).toBe("passing");
    });

    it("a quarantined scenario is dropped from the all-passed check", () => {
      // Flaky has no history; without quarantine this Feature would read partial
      // (implemented). Excluding Flaky leaves only the passing Solid → passing.
      const f = feature({ scenarios: [quarantined("Flaky"), active("Solid")] });
      expect(computeAutomationStatus([f], history({ [refOf(f, "Solid")]: "passed" }))).toBe(
        "passing",
      );
    });

    it("a Feature whose every scenario is quarantined contributes no run signal", () => {
      // Excluded → with Features present but none contributing, the UC reads planned.
      const f = feature({ scenarios: [quarantined("Flaky")] });
      expect(computeAutomationStatus([f], history({ [refOf(f, "Flaky")]: "failed" }))).toBe(
        "planned",
      );
    });

    it("an all-quarantined Feature stays neutral beside a passing sibling", () => {
      // Regression: an excluded Feature must NOT drag a passing UC to implemented.
      const allQuarantined = feature({
        path: vp("Specifications/features/UC-001-a.feature"),
        scenarios: [quarantined("Flaky")],
      });
      const solid = feature({
        path: vp("Specifications/features/UC-001-b.feature"),
        scenarios: [active("Solid")],
      });
      expect(
        computeAutomationStatus(
          [allQuarantined, solid],
          history({ [refOf(solid, "Solid")]: "passed" }),
        ),
      ).toBe("passing");
    });

    it("a feature-level @quarantine excludes the whole Feature from the roll-up", () => {
      // The whole Feature is parked: even a failing scenario must not fail the UC,
      // and a passing sibling carries it to passing.
      const parked = feature({
        path: vp("Specifications/features/UC-001-a.feature"),
        tags: ["@quarantine"],
        scenarios: [active("Flaky")],
      });
      const solid = feature({
        path: vp("Specifications/features/UC-001-b.feature"),
        scenarios: [active("Solid")],
      });
      expect(
        computeAutomationStatus(
          [parked, solid],
          history({ [refOf(parked, "Flaky")]: "failed", [refOf(solid, "Solid")]: "passed" }),
        ),
      ).toBe("passing");
    });

    it("a lone feature-level @quarantine Feature reads planned (no KPI signal)", () => {
      const parked = feature({ tags: ["@quarantine"], scenarios: [active("Flaky")] });
      expect(
        computeAutomationStatus([parked], history({ [refOf(parked, "Flaky")]: "failed" })),
      ).toBe("planned");
    });

    it("feature-level @quarantine does not neutralize a rowless Outline (stays not-run)", () => {
      // Consistency with a scenario-level tag on the same rowless Outline: there
      // is nothing runnable to park, so it keeps a not-run signal and a passing
      // sibling can only reach implemented, never passing.
      const parked = feature({
        path: vp("Specifications/features/UC-001-a.feature"),
        tags: ["@quarantine"],
        scenarios: [{ name: "O", tags: [], keyword: "Scenario Outline", steps: [step] }],
      });
      const solid = feature({
        path: vp("Specifications/features/UC-001-b.feature"),
        scenarios: [active("Solid")],
      });
      expect(
        computeAutomationStatus([parked, solid], history({ [refOf(solid, "Solid")]: "passed" })),
      ).toBe("implemented");
    });

    it("a non-quarantined rowless Outline keeps the Feature in the roll-up", () => {
      // A @quarantine scenario removes all refs, but a sibling rowless Outline is
      // still an active (never-run) scenario, so the Feature is not-run — not
      // excluded — and a passing sibling can only carry the UC to implemented.
      const mixed = feature({
        path: vp("Specifications/features/UC-001-a.feature"),
        scenarios: [
          { name: "O", tags: [], keyword: "Scenario Outline", steps: [step] }, // rowless, active
          quarantined("Q"),
        ],
      });
      const solid = feature({
        path: vp("Specifications/features/UC-001-b.feature"),
        scenarios: [active("Solid")],
      });
      expect(
        computeAutomationStatus([mixed, solid], history({ [refOf(solid, "Solid")]: "passed" })),
      ).toBe("implemented");
    });

    it("a rowless Outline is not-run, not excluded (it never executed)", () => {
      // Zero refs from NO Examples rows (not from @quarantine) must stay not-run,
      // so it does not let a passing sibling carry the UC to passing.
      const rowless = feature({
        path: vp("Specifications/features/UC-001-a.feature"),
        scenarios: [{ name: "O", tags: [], keyword: "Scenario Outline", steps: [step] }],
      });
      const solid = feature({
        path: vp("Specifications/features/UC-001-b.feature"),
        scenarios: [active("Solid")],
      });
      expect(
        computeAutomationStatus([rowless, solid], history({ [refOf(solid, "Solid")]: "passed" })),
      ).toBe("implemented");
    });

    it("matches @quarantine case-insensitively", () => {
      const f = feature({
        scenarios: [{ name: "Flaky", tags: ["@QUARANTINE"], steps: [step] }, active("Solid")],
      });
      expect(
        computeAutomationStatus(
          [f],
          history({ [refOf(f, "Flaky")]: "failed", [refOf(f, "Solid")]: "passed" }),
        ),
      ).toBe("passing");
    });

    it("does not hide undefined steps: missing-steps still outranks quarantine", () => {
      const f = feature({ scenarios: [{ name: "Flaky", tags: ["@quarantine"], steps: [] }] });
      expect(computeAutomationStatus([f], history({ [refOf(f, "Flaky")]: "passed" }))).toBe(
        "missing-steps",
      );
    });

    it("excludes only the rows of an Examples block tagged @quarantine", () => {
      // A block-scoped @quarantine quarantines just that block's rows: the admin
      // row may fail without failing the UC, while the active user row decides it.
      const f = parseFeature(
        [
          "Feature: F",
          "  Scenario Outline: Search as <role>",
          "    Given I am <role>",
          "    @quarantine",
          "    Examples:",
          "      | role  |",
          "      | admin |",
          "    Examples:",
          "      | role |",
          "      | user |",
          "",
        ].join("\n"),
        vp("Specifications/features/UC-001-o.feature"),
      );
      if (!f) throw new Error("parse failed");
      const refs = featureScenarioRefs(f);
      const refFor = (matchName: string): string => {
        const entry = refs.find((r) => r.matchName === matchName);
        if (!entry) throw new Error(`no ref for ${matchName}`);
        return entry.ref;
      };
      expect(
        computeAutomationStatus(
          [f],
          history({ [refFor("Search as admin")]: "failed", [refFor("Search as user")]: "passed" }),
        ),
      ).toBe("passing");
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

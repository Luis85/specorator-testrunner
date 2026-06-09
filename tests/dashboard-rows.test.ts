import { describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "../src/application/services/traceability-service";
import {
  isHubInitialized,
  NO_EVIDENCE_TOOLTIP,
  projectDashboard,
  projectEnvironmentBadge,
  QUICK_ACTIONS,
  QUICK_ACTION_GROUPS,
} from "../src/presentation/views/dashboard-rows";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const snapshot = (over: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  totalUseCases: 5,
  specifiedUseCases: 4,
  automatedUseCases: 3,
  passingUseCases: 2,
  failingUseCases: 1,
  recentRuns: [],
  ...over,
});

describe("projectDashboard", () => {
  it("projects the KPI tiles in US-037 order, each navigating to the Use Cases explorer", () => {
    const view = projectDashboard(snapshot());
    expect(view.kpis).toEqual([
      {
        label: "Total Use Cases",
        value: 5,
        navigateTo: "use-cases",
        ariaLabel: "Total Use Cases: 5. Open Use Cases.",
      },
      {
        label: "Specified",
        value: 4,
        navigateTo: "use-cases",
        ariaLabel: "Specified: 4. Open Use Cases.",
      },
      {
        label: "Automated",
        value: 3,
        navigateTo: "use-cases",
        ariaLabel: "Automated: 3. Open Use Cases.",
      },
      {
        label: "Passing",
        value: 2,
        navigateTo: "use-cases",
        ariaLabel: "Passing: 2. Open Use Cases.",
      },
      {
        label: "Failing",
        value: 1,
        navigateTo: "use-cases",
        ariaLabel: "Failing: 1. Open Use Cases.",
      },
    ]);
  });

  it("marks a recent-run row navigable when it carries an evidence path (US-038, Wave C §3)", () => {
    const view = projectDashboard(
      snapshot({
        recentRuns: [
          {
            runId: "RUN-B",
            status: "passed",
            date: "2026-06-02T00:00:00Z",
            evidencePath: vp("ev/B.md"),
          },
          { runId: "RUN-A", status: "failed", date: "2026-06-01T00:00:00Z" },
        ],
      }),
    );
    expect(view.recentRuns).toEqual([
      {
        runId: "RUN-B",
        status: "passed",
        date: "2026-06-02T00:00:00Z",
        evidencePath: vp("ev/B.md"),
        navigable: true,
        ariaLabel: "Open evidence for run RUN-B (passed)",
      },
      {
        runId: "RUN-A",
        status: "failed",
        date: "2026-06-01T00:00:00Z",
        evidencePath: undefined,
        navigable: false,
        ariaLabel: `Run RUN-A (failed) — ${NO_EVIDENCE_TOOLTIP}`,
      },
    ]);
  });

  it("yields an empty recent-runs list when there are no runs", () => {
    expect(projectDashboard(snapshot()).recentRuns).toEqual([]);
  });
});

describe("isHubInitialized", () => {
  it("treats a successful snapshot as initialized", () => {
    expect(isHubInitialized(true)).toBe(true);
  });

  it("treats a failed snapshot as not initialized (show the Initialize CTA)", () => {
    expect(isHubInitialized(false)).toBe(false);
  });
});

describe("QUICK_ACTIONS", () => {
  it("exposes exactly one primary CTA, the New Use Case action", () => {
    const primary = QUICK_ACTIONS.filter((a) => a.primary);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.id).toBe("new-use-case");
  });

  it("groups every action under a declared group (Create / Run / Open)", () => {
    const groups = new Set(QUICK_ACTION_GROUPS.map((g) => g.group));
    for (const action of QUICK_ACTIONS) {
      expect(groups.has(action.group)).toBe(true);
    }
    // Every declared group has at least one action so no empty heading renders.
    for (const { group } of QUICK_ACTION_GROUPS) {
      expect(QUICK_ACTIONS.some((a) => a.group === group)).toBe(true);
    }
  });

  it("gives every action a non-empty aria-label", () => {
    for (const action of QUICK_ACTIONS) {
      expect(action.ariaLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("projectEnvironmentBadge", () => {
  it("is switchable with 2+ environments and lists every option", () => {
    const badge = projectEnvironmentBadge("staging", ["staging", "production"]);
    expect(badge).toEqual({
      active: "staging",
      switchable: true,
      options: ["staging", "production"],
      ariaLabel: "Active environment: staging. Activate to switch environment.",
    });
  });

  it("is non-interactive with a single environment", () => {
    const badge = projectEnvironmentBadge("demo", ["demo"]);
    expect(badge.switchable).toBe(false);
    expect(badge.ariaLabel).toBe("Active environment: demo.");
  });
});

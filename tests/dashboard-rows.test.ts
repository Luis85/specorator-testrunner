import { describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "../src/application/services/traceability-service";
import {
  NO_EVIDENCE_TOOLTIP,
  projectDashboard,
  projectEnvironmentBadge,
  QUICK_ACTIONS,
  QUICK_ACTION_GROUPS,
  useCaseFilterLabel,
  type KpiTile,
} from "../src/presentation/views/dashboard-rows";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const snapshot = (over: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  totalUseCases: 8,
  specifiedUseCases: 4,
  automatedUseCases: 2,
  passingUseCases: 1,
  failingUseCases: 1,
  recentRuns: [],
  ...over,
});

describe("projectDashboard (KPI funnel)", () => {
  it("frames Total as the funnel head — no denominator, no percent, neutral tone", () => {
    const [total] = projectDashboard(snapshot()).kpis;
    expect(total).toEqual({
      label: "Total Use Cases",
      value: 8,
      denominator: null,
      percent: null,
      tone: "neutral",
      navigateTo: { kind: "use-cases", filter: "all" },
      ariaLabel: "Total Use Cases: 8. Open Use Cases.",
    });
  });

  it("measures every funnel stage OF TOTAL with its drill-down filter", () => {
    const kpis = projectDashboard(snapshot()).kpis;
    expect(kpis.map((k) => [k.label, k.value, k.denominator, k.percent])).toEqual([
      ["Total Use Cases", 8, null, null],
      ["Specified", 4, 8, 50],
      ["Automated", 2, 8, 25],
      ["Passing", 1, 8, 13],
      ["Failing", 1, 8, 13],
    ]);
    expect(kpis.map((k) => k.navigateTo.filter)).toEqual([
      "all",
      "specified",
      "automated",
      "passing",
      "failing",
    ]);
  });

  it("rounds the of-Total percent (1 of 8 → 13)", () => {
    const passing = projectDashboard(snapshot()).kpis.find((k) => k.label === "Passing");
    expect(passing?.percent).toBe(13);
  });

  it("yields a null percent (never NaN) when Total is zero", () => {
    const kpis = projectDashboard(
      snapshot({
        totalUseCases: 0,
        specifiedUseCases: 0,
        automatedUseCases: 0,
        passingUseCases: 0,
        failingUseCases: 0,
      }),
    ).kpis;
    for (const tile of kpis) {
      expect(tile.percent).toBeNull();
      expect(Number.isNaN(tile.percent)).toBe(false);
    }
  });

  it("marks the Failing tile alert only when failures exist, neutral at zero", () => {
    const failingOf = (over: Partial<DashboardSnapshot>): KpiTile | undefined =>
      projectDashboard(snapshot(over)).kpis.find((k) => k.label === "Failing");
    expect(failingOf({ failingUseCases: 1 })?.tone).toBe("alert");
    expect(failingOf({ failingUseCases: 0 })?.tone).toBe("neutral");
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

  it("files Generate documentation under Create — it produces artifacts, it doesn't run tests", () => {
    expect(QUICK_ACTIONS.find((a) => a.id === "generate-docs")?.group).toBe("create");
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

describe("useCaseFilterLabel (E1 PR3 filter chip)", () => {
  it("labels each non-'all' funnel stage", () => {
    expect(useCaseFilterLabel("specified")).toBe("Specified");
    expect(useCaseFilterLabel("automated")).toBe("Automated");
    expect(useCaseFilterLabel("passing")).toBe("Passing");
    expect(useCaseFilterLabel("failing")).toBe("Failing");
  });
});

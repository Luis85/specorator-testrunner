import { describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "../src/application/services/traceability-service";
import type { ExecutionLogEntry } from "../src/domain/entities/execution-log";
import type { TestRunStatus } from "../src/domain/entities/test-run";
import {
  formatLastRunAge,
  projectHealthHero,
  projectLastRun,
} from "../src/presentation/views/health-hero-rows";

const snapshot = (over: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  totalUseCases: 16,
  specifiedUseCases: 16,
  automatedUseCases: 16,
  passingUseCases: 12,
  failingUseCases: 2,
  recentRuns: [],
  ...over,
});

const entry = (over: Partial<ExecutionLogEntry> = {}): ExecutionLogEntry => ({
  runId: "RUN-001",
  scope: "use-case",
  target: "UC-001",
  status: "passed",
  startedAt: "2026-06-01T10:00:00.000Z",
  finishedAt: "2026-06-01T10:01:00.000Z",
  ...over,
});

describe("projectHealthHero", () => {
  it("returns no-rate with an explicit empty-state when nothing is automated", () => {
    const hero = projectHealthHero(snapshot({ automatedUseCases: 0 }));
    expect(hero.kind).toBe("no-rate");
    if (hero.kind === "no-rate") {
      expect(hero.message).toBe(
        "No automated Use Cases yet — author a Use Case to start tracking health.",
      );
      expect(hero.ariaLabel).toBe(hero.message);
    }
  });

  it("reports 100 percent when every automated Use Case passes", () => {
    const hero = projectHealthHero(
      snapshot({ automatedUseCases: 4, passingUseCases: 4, failingUseCases: 0 }),
    );
    expect(hero.kind).toBe("rate");
    if (hero.kind === "rate") {
      expect(hero.ratePercent).toBe(100);
      expect(hero.inProgress).toBe(0);
      expect(hero.verdict).toBe("4 of 4 automated Use Cases passing");
    }
  });

  it("computes the rate over ALL automated Use Cases, exact percent + breakdown + inProgress", () => {
    const hero = projectHealthHero(
      snapshot({ automatedUseCases: 16, passingUseCases: 12, failingUseCases: 2 }),
    );
    expect(hero.kind).toBe("rate");
    if (hero.kind === "rate") {
      expect(hero.ratePercent).toBe(75);
      expect(hero.inProgress).toBe(2);
      expect(hero.passing).toBe(12);
      expect(hero.failing).toBe(2);
      expect(hero.automated).toBe(16);
      expect(hero.verdict).toBe("12 of 16 automated Use Cases passing · 2 failing · 2 in progress");
    }
  });

  it("rounds the percent (1 of 3 → 33)", () => {
    const hero = projectHealthHero(
      snapshot({ automatedUseCases: 3, passingUseCases: 1, failingUseCases: 0 }),
    );
    if (hero.kind === "rate") expect(hero.ratePercent).toBe(33);
  });

  it("pluralizes the noun and drops zero clauses (singular)", () => {
    const hero = projectHealthHero(
      snapshot({ automatedUseCases: 1, passingUseCases: 1, failingUseCases: 0 }),
    );
    if (hero.kind === "rate") expect(hero.verdict).toBe("1 of 1 automated Use Case passing");
  });

  it("includes the failing clause but drops in-progress when zero", () => {
    const hero = projectHealthHero(
      snapshot({ automatedUseCases: 2, passingUseCases: 1, failingUseCases: 1 }),
    );
    if (hero.kind === "rate") {
      expect(hero.verdict).toBe("1 of 2 automated Use Cases passing · 1 failing");
      expect(hero.inProgress).toBe(0);
    }
  });
});

describe("projectLastRun", () => {
  it("returns null when there is no recorded run", () => {
    expect(projectLastRun(null)).toBeNull();
  });

  it("carries the raw ISO finishedAt through for the body to format", () => {
    const run = projectLastRun(entry({ finishedAt: "2026-06-02T08:30:00.000Z" }));
    expect(run?.finishedAt).toBe("2026-06-02T08:30:00.000Z");
  });

  it("maps every terminal status to a label and a --spec-status-* tone", () => {
    const cases: { status: TestRunStatus; statusLabel: string; tone: string }[] = [
      { status: "passed", statusLabel: "Passed", tone: "pass" },
      { status: "failed", statusLabel: "Failed", tone: "fail" },
      { status: "errored", statusLabel: "Errored", tone: "fail" },
      { status: "cancelled", statusLabel: "Cancelled", tone: "warn" },
      { status: "queued", statusLabel: "Queued", tone: "idle" },
      { status: "running", statusLabel: "Running", tone: "idle" },
    ];
    for (const { status, statusLabel, tone } of cases) {
      const run = projectLastRun(entry({ status }));
      expect(run).toEqual({ status, statusLabel, tone, finishedAt: entry().finishedAt });
    }
  });
});

describe("formatLastRunAge", () => {
  const now = Date.parse("2026-06-22T12:00:00.000Z");
  const ago = (ms: number): string => new Date(now - ms).toISOString();

  it("returns null for an unparseable timestamp", () => {
    expect(formatLastRunAge("not a date", now)).toBeNull();
  });

  it("buckets sub-minute (and future) ages as just now", () => {
    expect(formatLastRunAge(ago(30_000), now)).toBe("just now");
    // A clock-skewed future timestamp clamps to zero rather than going negative.
    expect(formatLastRunAge(new Date(now + 60_000).toISOString(), now)).toBe("just now");
  });

  it("buckets minutes, hours, and days", () => {
    expect(formatLastRunAge(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(formatLastRunAge(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(formatLastRunAge(ago(2 * 86_400_000), now)).toBe("2 d ago");
  });
});

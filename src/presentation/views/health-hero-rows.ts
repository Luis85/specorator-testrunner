import type { DashboardSnapshot } from "../../application/services/traceability-service";
import type { ExecutionLogEntry } from "../../domain/entities/execution-log";
import type { TestRunStatus } from "../../domain/entities/test-run";

/**
 * The Overview health hero (E1 PR2, redesign): a single honest pass-rate gauge
 * with a one-line verdict, plus the durable execution log's last-run line. Pure
 * projections — no I/O, no Obsidian imports — so the (DOM-only) hero body stays
 * a thin render over a unit-tested logic core, the direct analogue of
 * `loop-rail-rows.ts` / `dashboard-rows.ts` (ADR-0029).
 *
 * Token discipline (01-§3.6): the ring/percentage are STATUS, so the body draws
 * them with `--spec-status-*`; the brand `--spec-accent` stays on chrome only.
 */

/**
 * The hero's pass-rate model, a discriminated union:
 * - `no-rate` — there are no automated Use Cases yet, so dividing would be a
 *   divide-by-zero. The ring is hidden and an explicit empty-state line shows.
 * - `rate` — a real pass-rate over the automated Use Cases, with the verdict
 *   line and the breakdown the ring renders.
 *
 * Pass-rate denominator is {@link DashboardSnapshot.automatedUseCases} (every
 * automated Use Case), NOT `passing / (passing + failing)` — an in-progress
 * (implemented-but-unrun) automated Use Case is honestly "not passing yet", so
 * it must drag the rate down rather than be excluded from it (product decision).
 */
export type HealthHero =
  | { kind: "no-rate"; message: string; ariaLabel: string }
  | {
      kind: "rate";
      /** Passing ÷ automated, as a whole percent (0–100). */
      ratePercent: number;
      passing: number;
      failing: number;
      /** Automated but not yet passing or failing (implemented-but-unrun). */
      inProgress: number;
      automated: number;
      /** The one-line breakdown sentence, with correct singular/plural. */
      verdict: string;
      ariaLabel: string;
    };

/** The empty-state line when no Use Case is automated yet (never a divide-by-zero). */
const NO_RATE_MESSAGE = "No automated Use Cases yet — author a Use Case to start tracking health.";

/**
 * Projects the dashboard snapshot into the {@link HealthHero}. When nothing is
 * automated the rate is undefined, so this returns `no-rate` (the ring hides);
 * otherwise it computes `passing ÷ automated` rounded to a whole percent and the
 * pluralized verdict. `inProgress` is the automated Use Cases that are neither
 * passing nor failing (implemented-but-unrun): `automated − passing − failing`,
 * the AUTOMATED_STATUSES decomposition the snapshot guarantees. Pure.
 */
export const projectHealthHero = (snapshot: DashboardSnapshot): HealthHero => {
  const automated = snapshot.automatedUseCases;
  if (automated === 0) {
    return { kind: "no-rate", message: NO_RATE_MESSAGE, ariaLabel: NO_RATE_MESSAGE };
  }
  const passing = snapshot.passingUseCases;
  const failing = snapshot.failingUseCases;
  const inProgress = automated - passing - failing;
  const ratePercent = Math.round((passing / automated) * 100);
  const verdict = buildVerdict(passing, failing, inProgress, automated);
  return {
    kind: "rate",
    ratePercent,
    passing,
    failing,
    inProgress,
    automated,
    verdict,
    ariaLabel: `Health: ${String(ratePercent)} percent passing. ${verdict}`,
  };
};

/**
 * The verdict sentence, e.g.
 * `"12 of 16 automated Use Cases passing · 2 failing · 2 in progress"`, with the
 * Use Case noun pluralized off the denominator and the trailing clauses dropped
 * when their count is zero (never "0 failing"). Pure.
 */
const buildVerdict = (
  passing: number,
  failing: number,
  inProgress: number,
  automated: number,
): string => {
  const noun = automated === 1 ? "automated Use Case" : "automated Use Cases";
  const clauses = [`${String(passing)} of ${String(automated)} ${noun} passing`];
  if (failing > 0) clauses.push(`${String(failing)} failing`);
  if (inProgress > 0) clauses.push(`${String(inProgress)} in progress`);
  return clauses.join(" · ");
};

/**
 * The status tone a last-run verdict draws, mapped onto the `--spec-status-*`
 * token family (01-§3.6): `pass` (green), `fail` (red), `warn` (amber), `idle`
 * (muted). Status, never chrome.
 */
export type HealthLastRunTone = "pass" | "fail" | "warn" | "idle";

/**
 * The last-run line model (E1 PR2): a display projection of the durable
 * execution log's newest entry. SEPARATE from {@link HealthHero} because the
 * last-run line is log-driven (it surfaces an `errored`/`cancelled` run the
 * snapshot's evidence-derived rate never sees), not snapshot-driven.
 */
export interface HealthLastRun {
  status: TestRunStatus;
  /** The human label for the run's terminal status (e.g. "Passed"). */
  statusLabel: string;
  /** The status tone the line draws (`--spec-status-*`). */
  tone: HealthLastRunTone;
  /** The raw ISO finish timestamp; the body formats it relative. */
  finishedAt: string;
}

/**
 * Projects the newest {@link ExecutionLogEntry} into the {@link HealthLastRun}
 * line, or `null` when there is no recorded run (a fresh hub). The status →
 * label + tone mapping is an EXHAUSTIVE switch over {@link TestRunStatus}, so a
 * new run state is a compile error here rather than a silently-mistinted line.
 * Pure.
 */
export const projectLastRun = (entry: ExecutionLogEntry | null): HealthLastRun | null => {
  if (entry === null) return null;
  const { statusLabel, tone } = describeStatus(entry.status);
  return { status: entry.status, statusLabel, tone, finishedAt: entry.finishedAt };
};

/** The label + status tone for a terminal run status (exhaustive over the union). */
const describeStatus = (
  status: TestRunStatus,
): { statusLabel: string; tone: HealthLastRunTone } => {
  switch (status) {
    case "passed":
      return { statusLabel: "Passed", tone: "pass" };
    case "failed":
      return { statusLabel: "Failed", tone: "fail" };
    case "errored":
      return { statusLabel: "Errored", tone: "fail" };
    case "cancelled":
      return { statusLabel: "Cancelled", tone: "warn" };
    case "queued":
      return { statusLabel: "Queued", tone: "idle" };
    case "running":
      return { statusLabel: "Running", tone: "idle" };
  }
};

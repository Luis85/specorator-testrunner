import { parseFeature } from "../content/gherkin";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { ScenarioHistoryService } from "./scenario-history-service";
import type { UseCaseService } from "./use-case-service";
import {
  computeAutomationStatus,
  type ScenarioStatusLookup,
} from "../../domain/policies/use-case-automation-policy";
import type { FeatureSpecification } from "../../domain/entities/specification";
import type { UseCase } from "../../domain/entities/use-case";
import type { TestRunSummary } from "../../domain/entities/test-run";
import type { RunId, SuiteId, UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/** Aggregated KPI counts + recent runs for the dashboard (TIS §8.14). */
export interface DashboardSnapshot {
  totalUseCases: number;
  specifiedUseCases: number;
  automatedUseCases: number;
  passingUseCases: number;
  failingUseCases: number;
  recentRuns: TestRunSummary[];
}

/** Per-Use-Case traceability links surfaced when opening a UC (TIS §8.14). */
export interface TraceabilityRecord {
  useCaseId: UseCaseId;
  featurePath?: VaultPath;
  suites: SuiteId[];
  runs: RunId[];
  /**
   * Evidence note PATHS the UC frontmatter tracks (V1 records evidence as
   * vault-relative note paths, not a separate EV-id registry), e.g.
   * `Test Evidence/2026/06/.../summary.md`.
   */
  evidence: VaultPath[];
}

/**
 * TraceabilityService (TIS §8.14, UC-018). Aggregates the Use Case index into a
 * {@link DashboardSnapshot} for the KPI dashboard and resolves a UC's
 * traceability links.
 *
 * V1 scope (AD-10 deferral): the suite-membership index methods
 * (`refreshMembership` / `scenarioCountFor` / `suitesFor`) are intentionally
 * NOT implemented here. The dashboard does not need an incremental scenario→
 * suite index — KPI counts and `linksFor` are derived from each UC's persisted
 * frontmatter (`automationStatus`, `suites`, `evidence`, `lastTestRun`), which
 * already roll up per ADR-0017. The FeatureFileWatcher (TIS §9.7.1) that would
 * feed `refreshMembership` is likewise deferred. When a scenario-level index is
 * needed (e.g. SuiteExplorerView scenario counts), it can be added without
 * changing this interface.
 */
export interface TraceabilityService {
  /**
   * Aggregates the Use Case index into a {@link DashboardSnapshot} AND publishes
   * `dashboard.refreshed` + `dashboard.kpi.updated` (UC-018). Use this to PUSH a
   * refresh from orchestration (the PostRunCoordinator after a run, P2-6).
   *
   * It emits, so a view MUST NOT call it in response to `dashboard.*` — that
   * would loop. Views read {@link snapshot} (non-emitting) for their renders.
   */
  refreshDashboard(): Promise<Result<DashboardSnapshot>>;
  /**
   * Computes the same {@link DashboardSnapshot} WITHOUT publishing any events.
   * The dashboard views project their tiles/rows from this when re-rendering in
   * response to events (including the pushed `dashboard.refreshed`/`kpi.updated`),
   * so a render never re-triggers a refresh (no loop, P2-6).
   */
  snapshot(): Promise<Result<DashboardSnapshot>>;
  linksFor(useCaseId: UseCaseId): Promise<Result<TraceabilityRecord>>;
}

/** UC business states that count as "specified" (ADR-0017 KPI definitions). */
const SPECIFIED_STATUSES = new Set(["specified", "ready-for-automation", "automated", "verified"]);

/** Automation states that count as "automated" (ADR-0017 KPI definitions). */
const AUTOMATED_STATUSES = new Set(["implemented", "passing", "failing"]);

/**
 * Builds a {@link DashboardSnapshot} from the Use Case index. Pure projection,
 * exported so the KPI counting + recent-run ordering is unit-testable without
 * the service shell.
 *
 * Deprecated UCs are excluded from every count (ADR-0017); recent runs are the
 * UCs' `lastTestRun` summaries, newest first.
 */
export const projectDashboardSnapshot = (useCases: UseCase[]): DashboardSnapshot => {
  const active = useCases.filter((useCase) => useCase.status !== "deprecated");

  // A broad run (all/suite/demo) writes the SAME lastTestRun.runId onto every
  // resolved UC, but with PER-UC status, so the run appears once per UC. Collapse
  // duplicates by runId, keeping the WORST status — otherwise a failed broad run
  // would show as passed on the recent-run row when a passing UC sorts first.
  const SEVERITY: Record<string, number> = {
    failed: 4,
    errored: 3,
    cancelled: 2,
    skipped: 1,
    passed: 0,
  };
  const severity = (status: string): number => SEVERITY[status] ?? 0;
  const byRunId = new Map<string, TestRunSummary>();
  for (const run of active
    .map((useCase) => useCase.lastTestRun)
    .filter((run): run is TestRunSummary => run !== undefined)) {
    const existing = byRunId.get(run.runId);
    if (!existing || severity(run.status) > severity(existing.status)) {
      byRunId.set(run.runId, run);
    }
  }
  // Newest first; ISO-8601 dates sort lexicographically.
  const recentRuns = [...byRunId.values()].sort((a, b) => b.date.localeCompare(a.date));

  return {
    totalUseCases: active.length,
    specifiedUseCases: active.filter((uc) => SPECIFIED_STATUSES.has(uc.status)).length,
    automatedUseCases: active.filter((uc) => AUTOMATED_STATUSES.has(uc.automationStatus)).length,
    passingUseCases: active.filter((uc) => uc.automationStatus === "passing").length,
    failingUseCases: active.filter((uc) => uc.automationStatus === "failing").length,
    recentRuns,
  };
};

export class DefaultTraceabilityService implements TraceabilityService {
  constructor(
    private readonly useCaseService: UseCaseService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly scenarioHistory: ScenarioHistoryService,
  ) {}

  /**
   * Derives a UC's effective automation status via UseCaseAutomationPolicy
   * (ADR-0017, history-derived per ADR-0022/US-057) from its parsed Features and
   * the per-scenario history, rather than trusting a possibly-stale persisted
   * `automationStatus`. Best-effort: unreadable or unparseable feature files are
   * skipped. The `latestStatusFor` lookup is resolved once per snapshot and
   * threaded in so each UC shares the same history read.
   */
  private async withDerivedStatus(
    useCase: UseCase,
    latestStatusFor: ScenarioStatusLookup,
    historyIsEmpty: boolean,
  ): Promise<UseCase> {
    // Migration grace (US-057): immediately after an upgrade no per-scenario
    // history has been recorded yet, so a UC that RAN before the upgrade has a
    // persisted `lastTestRun`/`automationStatus` but nothing for the policy to
    // derive from (old Evidence notes aren't keyed by Scenario Reference, so
    // they can't be backfilled). Deriving would drop every such UC to `planned`.
    // While the history index is EMPTY, trust the persisted status instead.
    //
    // The grace is vault-wide and transitional: the moment ANY run records
    // history we derive for every UC. That deliberately collapses three cases
    // that are otherwise indistinguishable from a single UC's perspective — a
    // renamed scenario, a renamed/moved feature file (history orphaned under the
    // old ref/path), and a simply-not-yet-rerun UC — so all read from history
    // (→ never-run) rather than keeping a stale status keyed by refs/paths that
    // no longer match (codex P2: a per-path guard can't tell a true migration
    // from a feature-file rename). Re-running the UC refreshes it.
    if (historyIsEmpty && useCase.lastTestRun !== undefined) return useCase;

    const features: FeatureSpecification[] = [];
    for (const path of useCase.featureFiles) {
      const read = await this.fs.readFile(path);
      if (!read.ok) continue;
      const feature = parseFeature(read.value, path);
      if (feature) features.push(feature);
    }
    return { ...useCase, automationStatus: computeAutomationStatus(features, latestStatusFor) };
  }

  /**
   * Aggregates the Use Case index into KPI counts + recent runs (UC-018 steps
   * 2–3) WITHOUT publishing — used by the views to project their tiles/rows when
   * re-rendering in response to events (P2-6: a render must not re-emit, or a
   * view reacting to `dashboard.*` would loop).
   */
  async snapshot(): Promise<Result<DashboardSnapshot>> {
    const all = await this.useCaseService.findAll();
    if (!all.ok) return err(all.error);

    // Resolve the per-scenario history once for the whole snapshot so every UC's
    // roll-up reads the same projection (ADR-0022/US-057). A history fault
    // degrades to "no history" — UCs read as planned rather than erroring.
    const statuses = await this.scenarioHistory.latestStatuses();
    const latestStatusFor: ScenarioStatusLookup = statuses.ok
      ? (ref) => statuses.value.get(ref)
      : () => undefined;
    // The migration grace applies only while NO per-scenario history exists yet —
    // a fresh upgrade, or a transient history-read fault (treated as empty so a
    // blip preserves persisted KPIs rather than flapping them to planned). Once
    // any run records history we derive for every UC (US-057). See
    // withDerivedStatus.
    const historyIsEmpty = !statuses.ok || statuses.value.size === 0;

    // Derive each UC's automation status from its Features + scenario history via
    // the policy (ADR-0017) so KPI counts reflect reality, not a stale
    // frontmatter value.
    const derived: UseCase[] = [];
    for (const useCase of all.value) {
      derived.push(await this.withDerivedStatus(useCase, latestStatusFor, historyIsEmpty));
    }

    return ok(projectDashboardSnapshot(derived));
  }

  /**
   * Aggregates the Use Case index, then emits `dashboard.refreshed`
   * (signal-only) followed by `dashboard.kpi.updated` (the counts) per the
   * UC-018 ordering. PUSHED from orchestration (the PostRunCoordinator after a
   * run, P2-6), and from a dashboard view's initial open.
   */
  async refreshDashboard(): Promise<Result<DashboardSnapshot>> {
    const result = await this.snapshot();
    if (!result.ok) return result;
    const snapshot = result.value;

    // Distinct suites across all active UCs — `dashboard.refreshed` is a signal
    // whose counts subscribers re-query; an approximate suite count is enough.
    const all = await this.useCaseService.findAll();
    const suiteCount = all.ok
      ? new Set(all.value.filter((uc) => uc.status !== "deprecated").flatMap((uc) => uc.suites))
          .size
      : 0;

    await this.eventBus.publish(
      createEvent("dashboard.refreshed", {
        useCaseCount: snapshot.totalUseCases,
        suiteCount,
        latestRunId: snapshot.recentRuns[0]?.runId,
      }),
    );
    await this.eventBus.publish(
      createEvent("dashboard.kpi.updated", {
        totalUseCases: snapshot.totalUseCases,
        specifiedUseCases: snapshot.specifiedUseCases,
        automatedUseCases: snapshot.automatedUseCases,
        passingUseCases: snapshot.passingUseCases,
        failingUseCases: snapshot.failingUseCases,
      }),
    );
    this.logger.info("Dashboard refreshed", {
      totalUseCases: snapshot.totalUseCases,
      passingUseCases: snapshot.passingUseCases,
      failingUseCases: snapshot.failingUseCases,
    });
    return ok(snapshot);
  }

  /**
   * Resolves a UC's traceability links from its persisted frontmatter (feature
   * file, suites, runs, evidence). Returns VALIDATION_FAILED when the UC id is
   * unknown.
   */
  async linksFor(useCaseId: UseCaseId): Promise<Result<TraceabilityRecord>> {
    const found = await this.useCaseService.findById(useCaseId);
    if (!found.ok) return err(found.error);
    if (found.value === null) {
      return err(appError("VALIDATION_FAILED", `Unknown Use Case: ${useCaseId}`));
    }

    const useCase = found.value;
    // Runs are the UC's recorded last run (V1 keeps a single roll-up summary
    // per UC, TIS §10.1); evidence ids are derived from the linked evidence
    // note paths the UC frontmatter tracks.
    return ok({
      useCaseId: useCase.id,
      featurePath: useCase.featureFiles[0],
      suites: useCase.suites,
      runs: useCase.lastTestRun ? [useCase.lastTestRun.runId] : [],
      evidence: useCase.evidence,
    });
  }
}

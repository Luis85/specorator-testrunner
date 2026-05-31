import { parseFeature } from "../content/gherkin";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { UseCaseService } from "./use-case-service";
import { computeAutomationStatus } from "../../domain/policies/use-case-automation-policy";
import type { FeatureSpecification } from "../../domain/entities/specification";
import type { UseCase } from "../../domain/entities/use-case";
import type { TestRunSummary } from "../../domain/entities/test-run";
import type {
  EvidenceId,
  RunId,
  SuiteId,
  UseCaseId,
  VaultPath,
} from "../../domain/value-objects/identifiers";
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
  evidence: EvidenceId[];
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
  refreshDashboard(): Promise<Result<DashboardSnapshot>>;
  linksFor(useCaseId: UseCaseId): Promise<Result<TraceabilityRecord>>;
}

/** UC business states that count as "specified" (ADR-0017 KPI definitions). */
const SPECIFIED_STATUSES = new Set([
  "specified",
  "ready-for-automation",
  "automated",
  "verified",
]);

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
  // resolved UC, so the same run would otherwise appear once per UC and crowd
  // out older runs. De-dupe by runId, keeping the newest occurrence.
  const seenRunIds = new Set<string>();
  const recentRuns = active
    .map((useCase) => useCase.lastTestRun)
    .filter((run): run is TestRunSummary => run !== undefined)
    // Newest first; ISO-8601 dates sort lexicographically.
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((run) => {
      if (seenRunIds.has(run.runId)) return false;
      seenRunIds.add(run.runId);
      return true;
    });

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
  ) {}

  /**
   * Derives a UC's effective automation status via UseCaseAutomationPolicy
   * (ADR-0017) from its parsed Features + last run, rather than trusting a
   * possibly-stale persisted `automationStatus`. Best-effort: unreadable or
   * unparseable feature files are skipped.
   */
  private async withDerivedStatus(useCase: UseCase): Promise<UseCase> {
    const features: FeatureSpecification[] = [];
    for (const path of useCase.featureFiles) {
      const read = await this.fs.readFile(path);
      if (!read.ok) continue;
      const feature = parseFeature(read.value, path);
      if (feature) features.push(feature);
    }
    return { ...useCase, automationStatus: computeAutomationStatus(useCase, features) };
  }

  /**
   * Aggregates the Use Case index into KPI counts + recent runs (UC-018 steps
   * 2–3), then emits `dashboard.refreshed` (signal-only) followed by
   * `dashboard.kpi.updated` (the counts) per the UC-018 ordering.
   */
  async refreshDashboard(): Promise<Result<DashboardSnapshot>> {
    const all = await this.useCaseService.findAll();
    if (!all.ok) return err(all.error);

    // Derive each UC's automation status from its Features + last run via the
    // policy (ADR-0017) so KPI counts reflect reality, not a stale frontmatter
    // value.
    const derived: UseCase[] = [];
    for (const useCase of all.value) derived.push(await this.withDerivedStatus(useCase));

    const snapshot = projectDashboardSnapshot(derived);

    // Distinct suites across all UCs — `dashboard.refreshed` is a signal whose
    // counts subscribers re-query; an approximate suite count is sufficient.
    const suiteCount = new Set(derived.flatMap((uc) => uc.suites)).size;

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

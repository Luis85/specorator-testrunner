import type { EvidenceGenerationService } from "./evidence-generation-service";
import type { ReportImportService } from "./report-import-service";
import type { TraceabilityService } from "./traceability-service";
import type { TestRun, TestRunStatus } from "../../domain/entities/test-run";
import type { DomainEvent, DomainEventType } from "../../domain/events/domain-event";
import { appError } from "../../shared/errors/errors";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/** Terminal run events that drive the post-run import→evidence flow (EN-2). */
const TERMINAL_EVENTS: DomainEventType[] = [
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
];

/** Run statuses that can have produced a report worth importing. */
const IMPORTABLE_STATUSES = new Set<TestRunStatus>(["passed", "failed", "cancelled"]);

/** Outcome of {@link PostRunCoordinator.importLastRun}, turned into a Notice by the UI. */
export type ImportLastRunOutcome =
  | { kind: "imported"; evidencePath?: string }
  | { kind: "recorded" } // imported, but evidence Markdown is disabled
  | { kind: "no-run" } // no run has finished this session
  | { kind: "run-in-progress"; activeRunId: string }
  | { kind: "ineligible"; status: TestRunStatus }; // errored/queued/running — no report

export interface PostRunCoordinatorDeps {
  reportImportService: ReportImportService;
  evidenceGenerationService: EvidenceGenerationService;
  traceabilityService: TraceabilityService;
  eventBus: EventBus;
  logger: Logger;
  /** The just-finished run (DefaultTestExecutionService.lastRun); see ADR-0018. */
  lastRun: () => TestRun | null;
  /** Id of the single active run, or null when idle (ADR-0018). */
  activeRunId: () => string | null;
  /** Whether evidence Markdown notes are written (settings.automation flag). */
  isEvidenceMarkdownEnabled: () => boolean;
}

/**
 * In-process post-run coordinator (P2-1/P2-6/P2-7, replacing the never-built
 * `ReportFileWatcher`/`report.detected` choreography). Subscribes to the EN-2
 * terminal run events on the {@link EventBus} and, on a terminal event, runs the
 * import→evidence→dashboard-refresh flow for the just-finished run.
 *
 * Application-layer only: it orchestrates injected services/ports and has no
 * Obsidian or infrastructure imports. The run-status eligibility rule and the
 * `lastRun`/`evidenceChain` state that used to live in `main.ts` move here.
 *
 * Serialization: post-run import then writes Use Case frontmatter, and the
 * active-run slot is already free by the time a handler runs, so back-to-back
 * runs could interleave and clobber each other's evidence/last_run fields. Every
 * task is queued through a single {@link evidenceChain} promise so they run one
 * at a time; {@link whenSettled} lets the caller await the tail on unload.
 */
export class PostRunCoordinator {
  private subscriptions: Unsubscribe[] = [];
  // Post-run import+evidence reads then writes Use Case frontmatter. The active
  // run slot is already free by the time this runs, so back-to-back runs could
  // interleave and clobber each other's evidence/last_run fields — serialize
  // them through a single chain.
  private evidenceChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PostRunCoordinatorDeps) {}

  /**
   * Subscribes to the terminal run events. Returns/stores Unsubscribe handles so
   * {@link stop} can detach them. Idempotent: calling start() twice does not
   * double-subscribe.
   */
  start(): void {
    if (this.subscriptions.length > 0) return;
    for (const type of TERMINAL_EVENTS) {
      this.subscriptions.push(
        this.deps.eventBus.subscribe(type, (event) => this.onTerminal(event)),
      );
    }
  }

  /** Detaches the bus subscriptions. Safe to call when not started. */
  stop(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
  }

  /** Alias for {@link stop} (lifecycle-symmetry with the views' dispose()). */
  dispose(): void {
    this.stop();
  }

  /**
   * Resolves when the in-flight import/evidence chain has settled (replaces the
   * `evidenceChain` await `main.ts` did on unload). Never rejects.
   */
  whenSettled(): Promise<void> {
    return this.evidenceChain.catch(() => undefined);
  }

  /**
   * Re-runs report import + evidence generation for the last finished run on
   * demand (UC-016, US-032). Encapsulates the run-status eligibility rule
   * (eligible when status ∈ {passed, failed, cancelled}) and returns a typed
   * Result the UI turns into a Notice. Never rejects.
   */
  async importLastRun(): Promise<Result<ImportLastRunOutcome>> {
    // A run in progress has already deleted and is reusing the fixed reports
    // path, so re-importing now would attach the active run's missing/partial
    // report to the PREVIOUS run id. Block until it settles.
    const active = this.deps.activeRunId();
    if (active !== null) {
      return ok({ kind: "run-in-progress", activeRunId: active });
    }
    const run = this.deps.lastRun();
    if (!run) return ok({ kind: "no-run" });
    // Import for runs that can produce a report: passed/failed, and cancelled
    // (which may have flushed a valid partial report — the pre-run cleanup means
    // any report on disk is this run's). An errored spawn fault never produced
    // one, so it is ineligible.
    if (!IMPORTABLE_STATUSES.has(run.status)) {
      return ok({ kind: "ineligible", status: run.status });
    }
    return this.enqueue(() => this.runImportAndGenerate(run));
  }

  /**
   * Terminal-event handler. Obtains the just-finished run from the execution
   * service (not the event payload) and runs import→evidence for it, serialized
   * through the evidence chain. Best-effort: never throws into the bus (EN-1).
   */
  private async onTerminal(event: DomainEvent): Promise<void> {
    const run = this.deps.lastRun();
    if (!run) {
      // The terminal event arrived but no finished run is recorded — nothing to
      // import (defensive; ADR-0018 makes lastRun() the just-finished run here).
      this.logger.warn("Terminal run event with no recorded run", { type: event.type });
      return;
    }
    // A spawn-error `errored` run produced no report; the import would only log a
    // safe miss, so skip it. passed/failed/cancelled may all have a report.
    if (!IMPORTABLE_STATUSES.has(run.status)) return;
    await this.enqueue(() => this.runImportAndGenerate(run));
  }

  /**
   * Queues a task behind any in-flight evidence task so two runs' Use Case
   * frontmatter updates can't interleave (read-modify-write race). Callers await
   * the chained task, so ordering and completion are preserved.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.evidenceChain.catch(() => undefined).then(task);
    // Track only completion (not the value) in the chain awaited on unload.
    this.evidenceChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Imports a finished run's Cucumber report, generates linked evidence, then
   * PUSHES a dashboard refresh so the KPI events fire from the run flow even when
   * no dashboard view is open (P2-6). Never rejects — every fault is logged and
   * returned as a typed outcome.
   */
  private async runImportAndGenerate(run: TestRun): Promise<Result<ImportLastRunOutcome>> {
    try {
      const imported = await this.deps.reportImportService.import(run);
      if (!imported.ok) {
        this.logger.warn("Report import failed", {
          runId: run.id,
          reason: imported.error.message,
        });
        return err(imported.error);
      }
      // Always call generate(): it honors BOTH opt-outs internally — skipping the
      // Markdown note when generateEvidenceMarkdown is off, but still writing the
      // Use Case lastTestRun (Recent Runs) when updateUseCaseFrontmatterAfterRun
      // is on. Gating the whole call on the note opt-out dropped runs from the
      // dashboard (US-038).
      const evidence = await this.deps.evidenceGenerationService.generate({
        run,
        report: imported.value,
      });
      if (!evidence.ok) {
        this.logger.warn("Evidence generation failed", {
          runId: run.id,
          reason: evidence.error.message,
        });
        return err(evidence.error);
      }
      // PUSH the dashboard KPI events from the run flow (P2-6). Best-effort: a
      // refresh fault must not fail the import/evidence outcome the user sees.
      const refreshed = await this.deps.traceabilityService.refreshDashboard();
      if (!refreshed.ok) {
        this.logger.warn("Dashboard refresh after run failed", {
          runId: run.id,
          reason: refreshed.error.message,
        });
      }
      // generate() may return ok without writing a note (Markdown disabled) —
      // tell the UI which so it doesn't point the user at a missing file.
      if (this.deps.isEvidenceMarkdownEnabled()) {
        return ok({ kind: "imported", evidencePath: evidence.value.path });
      }
      return ok({ kind: "recorded" });
    } catch (error) {
      // The subscriber must not throw into the bus (EN-1).
      this.logger.error("Report import / evidence generation threw", error as Error);
      return err(
        appError("INIT_FAILED", "Report import / evidence generation failed unexpectedly.", {
          cause: error,
        }),
      );
    }
  }

  private get logger(): Logger {
    return this.deps.logger;
  }
}

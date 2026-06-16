import type { EvidenceGenerationService } from "./evidence-generation-service";
import type { ReportImportService } from "./report-import-service";
import type { ScenarioHistoryService } from "./scenario-history-service";
import type { ScenarioIdentityResolver } from "./scenario-identity-resolver";
import type { TraceabilityService } from "./traceability-service";
import type { TestRun, TestRunStatus } from "../../domain/entities/test-run";
import type { DomainEvent, DomainEventType } from "../../domain/events/domain-event";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { SerialQueue } from "../../shared/async/serial-queue";

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
  | { kind: "no-report" } // run finished but wrote no run-specific report (e.g. cancelled in setup)
  | { kind: "run-in-progress"; activeRunId: string }
  | { kind: "ineligible"; status: TestRunStatus }; // errored/queued/running — no report

/** The evidence note generated for a run, exposed via {@link PostRunCoordinator.lastEvidence}. */
export interface LastEvidence {
  runId: RunId;
  evidencePath: VaultPath;
}

export interface PostRunCoordinatorDeps {
  reportImportService: ReportImportService;
  evidenceGenerationService: EvidenceGenerationService;
  scenarioIdentityResolver: ScenarioIdentityResolver;
  scenarioHistoryService: ScenarioHistoryService;
  traceabilityService: TraceabilityService;
  eventBus: EventBus;
  logger: Logger;
  /** The just-finished run (DefaultTestExecutionService.lastRun); see ADR-0018. */
  lastRun: () => TestRun | null;
  /** Id of the single active run, or null when idle (ADR-0018). */
  activeRunId: () => string | null;
  /**
   * Resolves when the active run's process has closed AND its report snapshot is
   * recorded. A cancelled run publishes `testrun.cancelled` BEFORE `execute()`
   * writes `reports/<runId>.json`, so the import must wait on this first to avoid
   * reading a missing/partial report (review P1).
   */
  whenActiveSettles: () => Promise<void>;
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
 * `lastRun`/`postRunQueue` state that used to live in `main.ts` move here.
 *
 * Non-blocking: the terminal-event handler ENQUEUES the import work and returns
 * immediately rather than awaiting it. `execute()` awaits the terminal publish
 * before its `finally` frees the single-run slot, so awaiting the import chain
 * inside the handler would keep `activeRunId()` non-null through evidence
 * generation and wrongly reject the next run as `RUN_IN_PROGRESS` (review P2).
 *
 * Serialization: post-run import then writes Use Case frontmatter, so back-to-
 * back runs could interleave and clobber each other's evidence/last_run fields.
 * Every task is queued through a single {@link postRunQueue} so they
 * run one at a time; {@link whenSettled} lets the caller await the tail on
 * unload. Each task first waits for its run to settle (snapshot recorded).
 */
export class PostRunCoordinator {
  private subscriptions: Unsubscribe[] = [];
  // Post-run import+evidence reads then writes Use Case frontmatter, so back-to-
  // back runs could interleave and clobber each other's evidence/last_run fields
  // — serialize them through a single queue (shared SerialQueue, review §4).
  private readonly postRunQueue = new SerialQueue();
  // Wave G §1: the most recently generated evidence note (run id + path). The
  // bus does not replay, so a Test Console opened AFTER `evidence.generated`
  // fired needs a synchronous probe to know the last run's evidence already
  // exists. Trivial recorded state: set only when the note was actually
  // written (the "imported" outcome), never for the note-disabled "recorded"
  // outcome — the probe must not point the UI at a non-existent file.
  private lastGenerated: LastEvidence | null = null;

  constructor(private readonly deps: PostRunCoordinatorDeps) {}

  /**
   * The evidence note generated for the most recent imported run, or null when
   * none has been generated this session (Wave G §1). Consumers match
   * `runId` against the execution service's `lastRun()` so stale evidence from
   * a PREVIOUS run is never attributed to the latest one.
   */
  lastEvidence(): LastEvidence | null {
    return this.lastGenerated;
  }

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
   * hand-rolled chain `main.ts` awaited on unload). Never rejects.
   */
  whenSettled(): Promise<void> {
    return this.postRunQueue.whenSettled();
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
    return this.postRunQueue.run(() => this.runImportAndGenerate(run));
  }

  /**
   * Terminal-event handler. Obtains the just-finished run from the execution
   * service (not the event payload) and ENQUEUES import→evidence for it WITHOUT
   * awaiting — `execute()` frees the run slot only after this publish returns, so
   * blocking here would hold the slot through evidence generation (review P2).
   * The queued task itself waits for the run to settle. Never throws (EN-1).
   */
  private onTerminal(event: DomainEvent): void {
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
    // Fire-and-forget: the queue tracks completion (whenSettled) and the task is
    // fault-isolated (runImportAndGenerate never rejects today). The catch is a
    // backstop so a future edit that lets a rejection slip through becomes a
    // logged error instead of an unhandled promise rejection.
    this.postRunQueue
      .run(() => this.runImportAndGenerate(run))
      .catch((error: unknown) =>
        this.logger.error("Post-run task rejected unexpectedly", error as Error),
      );
  }

  /**
   * Imports a finished run's Cucumber report, generates linked evidence, then
   * PUSHES a dashboard refresh so the KPI events fire from the run flow even when
   * no dashboard view is open (P2-6). Never rejects — every fault is logged and
   * returned as a typed outcome.
   */
  private async runImportAndGenerate(run: TestRun): Promise<Result<ImportLastRunOutcome>> {
    try {
      // If this run is STILL the active one, its finalization may not be done —
      // notably a cancelled run writes its reports/<runId>.json snapshot AFTER
      // publishing `testrun.cancelled` (review P1). Wait for it to settle before
      // importing so we never read a missing/partial report. Identity-checked so
      // we never block on an unrelated later run (and so the manual
      // importLastRun path, which only runs when idle, doesn't wait).
      if (this.deps.activeRunId() === run.id) {
        await this.deps.whenActiveSettles();
      }
      // Only import when a RUN-SPECIFIC snapshot (reports/<runId>.json) exists.
      // Without it, ReportImportService falls back to the FIXED
      // reports/cucumber-report.json — which, for a run cancelled during setup
      // (before the pre-run cleanup) or one that never produced a report, can be
      // a PREVIOUS run's report and would be mis-attributed here (review). The
      // executor sets reportPaths.json only after snapshotting this run's report,
      // so its presence is the "report ownership established" signal.
      if (!run.reportPaths.json) {
        this.logger.info("No run-specific report snapshot; skipping import", {
          runId: run.id,
          status: run.status,
        });
        return ok({ kind: "no-report" });
      }
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
      // Attach Scenario References before evidence so downstream per-scenario
      // records key on a stable identity (US-056). Never throws; on any fault
      // the refs are simply absent and evidence still generates.
      const enriched = await this.deps.scenarioIdentityResolver.enrich(
        imported.value,
        run.workingDirectory,
        imported.value.featureSnapshot,
      );
      // Record per-scenario history FIRST — best-effort, always-on, and
      // independent of evidence-note generation. It keys on `enriched` (not the
      // note), so a Markdown note create/write failure must not drop the run from
      // the roll-up history (codex P2). Recorded before the refresh so the roll-up
      // reads fresh data (US-057); a history fault must not fail the user-visible
      // import/evidence outcome.
      const recorded = await this.deps.scenarioHistoryService.record(run, enriched);
      if (!recorded.ok) {
        this.logger.warn("Scenario history recording failed", {
          runId: run.id,
          reason: recorded.error.message,
        });
      }
      const evidence = await this.deps.evidenceGenerationService.generate({
        run,
        report: enriched,
      });
      if (!evidence.ok) {
        this.logger.warn("Evidence generation failed", {
          runId: run.id,
          reason: evidence.error.message,
        });
      }
      // PUSH the dashboard KPI events from the run flow (P2-6) regardless of the
      // evidence-note outcome, so the just-recorded history surfaces even when the
      // note write failed. Best-effort: a refresh fault must not fail the
      // import/evidence outcome the user sees.
      const refreshed = await this.deps.traceabilityService.refreshDashboard();
      if (!refreshed.ok) {
        this.logger.warn("Dashboard refresh after run failed", {
          runId: run.id,
          reason: refreshed.error.message,
        });
      }
      // Surface the evidence-note failure now that history is recorded and the
      // dashboard has been refreshed.
      if (!evidence.ok) return err(evidence.error);
      // generate() may return ok without writing a note (Markdown disabled) —
      // tell the UI which so it doesn't point the user at a missing file.
      if (this.deps.isEvidenceMarkdownEnabled()) {
        // Record the note for the synchronous lastEvidence() probe (Wave G §1).
        this.lastGenerated = { runId: run.id, evidencePath: evidence.value.path };
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

import type { ExecutionLogService } from "./execution-log-service";
import { TerminalRunSubscription } from "./terminal-run-subscription";
import type { TestRun } from "../../domain/entities/test-run";
import type { DomainEvent } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";

export interface ExecutionLogRecorderDeps {
  eventBus: EventBus;
  executionLogService: ExecutionLogService;
  /** The just-finished run (DefaultTestExecutionService.lastRun); see ADR-0018. */
  lastRun: () => TestRun | null;
  logger: Logger;
}

/**
 * Subscribes to the terminal run events and records EVERY one into the durable
 * {@link ExecutionLogService} (E1, ADR-0032). A dedicated recorder rather than
 * folding into DefaultPostRunCoordinator: the coordinator gates on importable
 * statuses (it skips `errored`/`cancelled`-without-report runs), but this log
 * must record them all to serve an honest "last run" — so the concerns stay
 * separate. No importable-status gate here: that gate is the evidence path's.
 */
export class ExecutionLogRecorder {
  private readonly subscription: TerminalRunSubscription;

  constructor(private readonly deps: ExecutionLogRecorderDeps) {
    this.subscription = new TerminalRunSubscription(deps.eventBus, (event) =>
      this.onTerminal(event),
    );
  }

  /**
   * Subscribes to the terminal run events. Idempotent: calling start() twice
   * does not double-subscribe (mirrors DefaultPostRunCoordinator).
   */
  start(): void {
    this.subscription.start();
  }

  /** Detaches the bus subscriptions. Safe to call when not started. */
  stop(): void {
    this.subscription.stop();
  }

  /**
   * Terminal-event handler. Records the just-finished run FIRE-AND-FORGET — like
   * DefaultPostRunCoordinator, the handler must not await, since `execute()`
   * frees the single-run slot only after the terminal publish returns; awaiting
   * the write here would hold the slot through the log I/O. `record` never
   * rejects, so the `.catch` is a backstop for a future edit that lets one slip.
   * Never throws into the bus (EN-1).
   */
  private onTerminal(event: DomainEvent): void {
    const run = this.deps.lastRun();
    if (!run) {
      // The terminal event arrived but no finished run is recorded — nothing to
      // log (defensive; ADR-0018 makes lastRun() the just-finished run here).
      this.deps.logger.warn("Terminal run event with no recorded run", { type: event.type });
      return;
    }
    void this.deps.executionLogService
      .record(run)
      .catch((error: unknown) =>
        this.deps.logger.error("Execution log record rejected unexpectedly", error as Error),
      );
  }
}

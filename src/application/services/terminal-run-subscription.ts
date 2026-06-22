import type { DomainEvent, DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";

/**
 * The terminal run events (EN-2). A run reaching any terminal state publishes
 * exactly one of these: a normal finish is `testrun.completed`, an `errored`
 * spawn fault is `testrun.failed` (with `run.status === "errored"`), and a
 * `cancelled` run is `testrun.cancelled`. Subscribing to all three covers every
 * terminal outcome.
 */
const TERMINAL_EVENTS: DomainEventType[] = [
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
];

/**
 * Manages a set of {@link EventBus} subscriptions to the {@link TERMINAL_EVENTS},
 * with the idempotent start / detach-on-stop lifecycle shared by the post-run
 * coordinator and the execution-log recorder. Both react to the SAME three
 * terminal events; keeping the subscribe/unsubscribe bookkeeping here lets each
 * consumer hold just its own handler.
 */
export class TerminalRunSubscription {
  private subscriptions: Unsubscribe[] = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly handler: (event: DomainEvent) => void,
  ) {}

  /** Subscribes to the terminal events. Idempotent: a second call is a no-op. */
  start(): void {
    if (this.subscriptions.length > 0) return;
    for (const type of TERMINAL_EVENTS) {
      this.subscriptions.push(this.eventBus.subscribe(type, (event) => this.handler(event)));
    }
  }

  /** Detaches the subscriptions. Safe to call when not started. */
  stop(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
  }
}

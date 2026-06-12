import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { RenderScheduler } from "./render-scheduler";

/**
 * The shared live-view lifecycle every event-driven view repeats: subscribe
 * the view's render to a set of event types through a RenderScheduler
 * (coalesced renders, PRES-M2) and tear down in the safe order — unsubscribe
 * BEFORE disposing the scheduler so a handler firing mid-teardown can't
 * schedule() on a disposed scheduler (PRES-M1). Extracted from the six V1
 * views (review §4) so V2's new views (triage, readiness, step library)
 * start from one implementation.
 */
export class LiveRefresh {
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly scheduler: RenderScheduler;

  constructor(
    private readonly eventBus: EventBus,
    render: () => void | Promise<void>,
  ) {
    this.scheduler = new RenderScheduler(async () => {
      await render();
    });
  }

  /** Subscribes to `types` and schedules the initial render. */
  open(types: readonly DomainEventType[]): Promise<void> {
    for (const type of types) {
      this.subscriptions.push(this.eventBus.subscribe(type, () => this.scheduler.schedule()));
    }
    return this.scheduler.schedule();
  }

  /** Coalesced manual refresh — the same path the event subscriptions use. */
  schedule(): Promise<void> {
    return this.scheduler.schedule();
  }

  /** Terminal: the scheduler stays disposed — create a new instance to re-open. */
  close(): void {
    // Unsubscribe BEFORE disposing the scheduler so a handler firing
    // mid-teardown can't schedule() on a disposed scheduler (PRES-M1).
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.scheduler.dispose();
  }
}

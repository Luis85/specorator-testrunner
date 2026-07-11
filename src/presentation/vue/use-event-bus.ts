import { onMounted, onUnmounted } from "vue";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { RenderScheduler } from "../views/render-scheduler";

/** What {@link useEventBus} hands back so a component can refresh on demand. */
export interface EventBusBinding {
  /** Coalesced manual refresh — the same serialized path the subscriptions use. */
  refresh(): Promise<void>;
}

/**
 * The Vue replacement for `LiveRefresh` (ADR-0033): for the lifetime of the
 * calling component, subscribe `load` to a set of domain event types and run an
 * initial load on mount, tearing the subscriptions down on unmount.
 *
 * Crucially it carries the `RenderScheduler` semantics forward, NOT just Vue's
 * batched DOM flush. Vue coalesces DOM updates but does not order or cancel
 * overlapping async reads, so a naive "reload on every event" would let a slower
 * `load()` holding stale data resolve last and clobber fresher state. The
 * scheduler SERIALIZES the async loads and collapses a burst into one trailing
 * load that already sees the latest state — the exact stale-write guard the
 * hand-rolled views relied on.
 *
 * Teardown order mirrors `LiveRefresh.close()`: unsubscribe BEFORE disposing the
 * scheduler so a handler firing mid-teardown can't schedule on a disposed one.
 */
export function useEventBus(
  eventBus: EventBus,
  types: readonly DomainEventType[],
  load: () => void | Promise<void>,
): EventBusBinding {
  const scheduler = new RenderScheduler(async () => {
    await load();
  });
  const subscriptions: Unsubscribe[] = [];

  onMounted(() => {
    for (const type of types) {
      subscriptions.push(eventBus.subscribe(type, () => scheduler.schedule()));
    }
    void scheduler.schedule();
  });

  onUnmounted(() => {
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions.length = 0;
    scheduler.dispose();
  });

  return { refresh: () => scheduler.schedule() };
}

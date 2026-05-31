import type { DomainEvent, DomainEventType } from "../../domain/events/domain-event";

/**
 * Single in-process bus shared by domain + UI events (TIS §4.4, EN-1).
 */
export interface EventBus {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  subscribe<TPayload>(eventType: DomainEventType, handler: EventHandler<TPayload>): Unsubscribe;
}

export type EventHandler<TPayload> = (event: DomainEvent<TPayload>) => Promise<void> | void;

export type Unsubscribe = () => void;

/**
 * Synchronous in-process implementation. Handlers are awaited in registration
 * order; a throwing handler is isolated so one bad subscriber cannot break
 * publication for the others.
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<DomainEventType, Set<EventHandler<unknown>>>();

  constructor(private readonly onHandlerError?: (error: unknown) => void) {}

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    const subscribers = this.handlers.get(event.type);
    if (!subscribers) return;
    for (const handler of [...subscribers]) {
      try {
        await handler(event);
      } catch (error) {
        this.onHandlerError?.(error);
      }
    }
  }

  subscribe<TPayload>(eventType: DomainEventType, handler: EventHandler<TPayload>): Unsubscribe {
    const set = this.handlers.get(eventType) ?? new Set<EventHandler<unknown>>();
    set.add(handler as EventHandler<unknown>);
    this.handlers.set(eventType, set);
    return () => {
      set.delete(handler as EventHandler<unknown>);
    };
  }
}

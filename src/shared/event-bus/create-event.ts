import type {
  DomainEvent,
  DomainEventType,
  EventSource,
} from "../../domain/events/domain-event";

const newId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for environments without the Web Crypto API.
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/** Stamps a {@link DomainEvent} envelope with an id and `occurredAt`. */
export const createEvent = <TPayload>(
  type: DomainEventType,
  payload: TPayload,
  options: {
    source?: EventSource;
    correlationId?: string;
    causationId?: string;
  } = {},
): DomainEvent<TPayload> => ({
  id: newId(),
  type,
  occurredAt: new Date().toISOString(),
  source: options.source ?? "plugin",
  correlationId: options.correlationId,
  causationId: options.causationId,
  payload,
});

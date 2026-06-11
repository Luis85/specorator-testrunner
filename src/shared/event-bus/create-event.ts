import type {
  DomainEvent,
  DomainEventType,
  EventPayloads,
  EventSource,
} from "../../domain/events/domain-event";

/** Generates a unique id for an event envelope or a flow correlation id. */
export const newId = (): string => {
  // `globalThis` is deliberate: src/shared is environment-agnostic (no
  // Obsidian/window dependency, runs under vitest's Node environment), and
  // Web Crypto is not tied to any popout window's lifetime.
  // eslint-disable-next-line obsidianmd/no-global-this
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for environments without the Web Crypto API.
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * Stamps a {@link DomainEvent} envelope with an id and `occurredAt`.
 *
 * Generic over the {@link DomainEventType} so the `payload` is checked against
 * the catalog shape in {@link EventPayloads} at compile time — a wrong payload
 * is a type error, not runtime drift.
 */
export const createEvent = <T extends DomainEventType>(
  type: T,
  payload: EventPayloads[T],
  options: {
    source?: EventSource;
    correlationId?: string;
    causationId?: string;
  } = {},
): DomainEvent<EventPayloads[T]> => ({
  id: newId(),
  type,
  occurredAt: new Date().toISOString(),
  source: options.source ?? "plugin",
  correlationId: options.correlationId,
  causationId: options.causationId,
  payload,
});

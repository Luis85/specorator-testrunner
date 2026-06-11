import {
  isTourStepId,
  TOUR_STEPS,
  tourObservedEventTypes,
  type TourEventContext,
  type TourEventRule,
  type TourStepDefinition,
  type TourStepId,
} from "../../domain/onboarding/tour-steps";
import type { DomainEvent } from "../../domain/events/domain-event";
import type { TestHubSettings } from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import { createEvent, newId } from "../../shared/event-bus/create-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

export type TourStepStatus = "pending" | "active" | "done" | "skipped";

export interface TourStepState {
  definition: TourStepDefinition;
  status: TourStepStatus;
  /** Manual steps: whether the armedBy event was observed this session. */
  armed: boolean;
}

export interface TourState {
  steps: TourStepState[];
  /** True when every step is done or skipped. */
  completed: boolean;
  dismissed: boolean;
}

/**
 * Settings access wired in main.ts to the SettingsHost, so tour persistence
 * goes through the same optimistic in-memory swap + save path as every other
 * settings write (a direct SettingsService.save would leave the plugin's
 * in-memory copy stale).
 */
export interface TourSettingsAccess {
  getSettings(): TestHubSettings;
  updateSettings(next: TestHubSettings): Promise<Result<void>>;
}

/** Guided Tour contract (spec 2026-06-11). */
export interface GuidedTourService {
  getState(): TourState;
  /** Completes a `manual` step (e.g. review-evidence). */
  markDone(stepId: TourStepId): Promise<Result<void>>;
  /** Skips a skippable step. */
  skip(stepId: TourStepId): Promise<Result<void>>;
  /** Clears all progress and mints a new tourId. */
  restart(): Promise<Result<void>>;
  /** Hides the dashboard CTA; the command still reopens the view. */
  dismiss(): Promise<Result<void>>;
  /** Subscribes to the bus. Call once from the composition root. */
  start(): void;
  /** Unsubscribes (onunload). */
  stop(): void;
}

export class DefaultGuidedTourService implements GuidedTourService {
  private readonly subscriptions: Unsubscribe[] = [];
  // Authoritative in-memory state, seeded from the persisted settings at
  // construction. Persistence is best-effort: a failed save degrades to
  // session-only progress (spec: error handling) and the next successful save
  // re-persists the full state.
  private readonly completed = new Set<TourStepId>();
  private readonly skipped = new Set<TourStepId>();
  private tourId: string | null = null;
  private dismissed = false;
  // Transient (per-session) sequence/arming state. Losing it on reload only
  // means re-triggering the cheap observable action (e.g. re-run detection).
  private readonly sequenceIndex = new Map<TourStepId, number>();
  private readonly capturedValue = new Map<TourStepId, string | undefined>();
  private readonly armed = new Set<TourStepId>();
  private tourCompletedPublished = false;
  // Serializes event handling + persistence (same pattern as
  // DefaultSettingsService.serialize) so two near-simultaneous completions
  // can't interleave their read-modify-write of the settings object.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: TourSettingsAccess,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly ctx: TourEventContext,
  ) {
    this.seedFromSettings();
  }

  start(): void {
    if (this.subscriptions.length > 0) return; // idempotent
    for (const type of tourObservedEventTypes()) {
      this.subscriptions.push(
        this.eventBus.subscribe(type, (event) => this.enqueue(() => this.handleEvent(event))),
      );
    }
    // A UC-024 reset restores default settings underneath us — resync so the
    // tour visibly starts over (its persisted progress was just cleared).
    this.subscriptions.push(
      this.eventBus.subscribe("settings.reset", () =>
        this.enqueue(async () => this.resetInMemory()),
      ),
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  getState(): TourState {
    // "active" is the first non-settled, non-skippable step. Skippable steps
    // are presented as "pending" until the user explicitly skips or completes
    // them — they are opt-in side-quests that should never block the main flow
    // from appearing as actionable.
    let activeAssigned = false;
    const steps = TOUR_STEPS.map((definition) => {
      let status: TourStepStatus;
      if (this.completed.has(definition.id)) status = "done";
      else if (this.skipped.has(definition.id)) status = "skipped";
      else if (!activeAssigned && !definition.skippable) {
        status = "active";
        activeAssigned = true;
      } else status = "pending";
      return { definition, status, armed: this.armed.has(definition.id) };
    });
    return { steps, completed: this.allSettled(), dismissed: this.dismissed };
  }

  markDone(stepId: TourStepId): Promise<Result<void>> {
    return this.enqueue(async () => {
      const definition = TOUR_STEPS.find((step) => step.id === stepId);
      if (!definition || definition.completion.kind !== "manual") {
        return err(
          appError("VALIDATION_FAILED", `Step "${stepId}" cannot be marked done manually.`),
        );
      }
      if (this.isSettled(stepId)) return ok(undefined);
      await this.completeStep(definition, "manual");
      return ok(undefined);
    });
  }

  skip(stepId: TourStepId): Promise<Result<void>> {
    return this.enqueue(async () => {
      const definition = TOUR_STEPS.find((step) => step.id === stepId);
      if (!definition || !definition.skippable) {
        return err(appError("VALIDATION_FAILED", `Step "${stepId}" cannot be skipped.`));
      }
      if (this.isSettled(stepId)) return ok(undefined);
      this.skipped.add(stepId);
      const tourId = await this.ensureTourStarted();
      await this.persist();
      await this.eventBus.publish(
        createEvent("tour.step.skipped", { tourId, stepId }, { correlationId: tourId }),
      );
      await this.publishCompletedIfSettled();
      return ok(undefined);
    });
  }

  restart(): Promise<Result<void>> {
    return this.enqueue(async () => {
      this.resetInMemory();
      this.tourId = newId();
      await this.persist();
      await this.eventBus.publish(
        createEvent("tour.started", { tourId: this.tourId }, { correlationId: this.tourId }),
      );
      return ok(undefined);
    });
  }

  dismiss(): Promise<Result<void>> {
    return this.enqueue(async () => {
      this.dismissed = true;
      await this.persist();
      return ok(undefined);
    });
  }

  // --- internals -----------------------------------------------------------

  private seedFromSettings(): void {
    const { onboarding } = this.settings.getSettings();
    this.tourId = onboarding.tourId;
    this.dismissed = onboarding.dismissed;
    // Unknown ids (stale data.json from a newer/older plugin) are dropped here;
    // the settings service already guaranteed these are string arrays.
    for (const id of onboarding.completedSteps) if (isTourStepId(id)) this.completed.add(id);
    for (const id of onboarding.skippedSteps) if (isTourStepId(id)) this.skipped.add(id);
    this.tourCompletedPublished = this.allSettled();
  }

  private resetInMemory(): void {
    this.completed.clear();
    this.skipped.clear();
    this.sequenceIndex.clear();
    this.capturedValue.clear();
    this.armed.clear();
    this.tourId = null;
    this.dismissed = false;
    this.tourCompletedPublished = false;
  }

  private isSettled(stepId: TourStepId): boolean {
    return this.completed.has(stepId) || this.skipped.has(stepId);
  }

  private allSettled(): boolean {
    return TOUR_STEPS.every((step) => this.isSettled(step.id));
  }

  private requirementsMet(definition: TourStepDefinition): boolean {
    return (definition.requiresCompleted ?? []).every((id) => this.completed.has(id));
  }

  private async handleEvent(event: DomainEvent): Promise<void> {
    for (const definition of TOUR_STEPS) {
      if (definition.armedBy?.type === event.type && !this.isSettled(definition.id)) {
        if (definition.armedBy.matches(event.payload, this.ctx)) this.armed.add(definition.id);
      }
      if (this.isSettled(definition.id)) continue;
      if (!this.requirementsMet(definition)) continue;

      const { completion } = definition;
      if (completion.kind === "event" && completion.rule.type === event.type) {
        if (completion.rule.matches(event.payload, this.ctx)) {
          await this.completeStep(definition, "event", event);
        }
      } else if (completion.kind === "event-sequence") {
        const index = this.sequenceIndex.get(definition.id) ?? 0;
        const rule: TourEventRule | undefined = completion.rules[index];
        if (rule?.type !== event.type) continue;
        if (!rule.matches(event.payload, this.ctx, this.capturedValue.get(definition.id))) continue;
        if (rule.capture) this.capturedValue.set(definition.id, rule.capture(event.payload));
        if (index + 1 >= completion.rules.length) {
          await this.completeStep(definition, "event", event);
        } else {
          this.sequenceIndex.set(definition.id, index + 1);
        }
      }
    }
  }

  private async completeStep(
    definition: TourStepDefinition,
    via: "event" | "manual",
    cause?: DomainEvent,
  ): Promise<void> {
    this.completed.add(definition.id);
    this.sequenceIndex.delete(definition.id);
    const tourId = await this.ensureTourStarted(cause);
    await this.persist();
    await this.eventBus.publish(
      createEvent(
        "tour.step.completed",
        { tourId, stepId: definition.id, via },
        { correlationId: tourId, causationId: cause?.id },
      ),
    );
    await this.publishCompletedIfSettled();
  }

  /** Mints + announces the tourId on first activity (spec: lazy tour.started). */
  private async ensureTourStarted(cause?: DomainEvent): Promise<string> {
    if (this.tourId !== null) return this.tourId;
    this.tourId = newId();
    await this.eventBus.publish(
      createEvent(
        "tour.started",
        { tourId: this.tourId },
        { correlationId: this.tourId, causationId: cause?.id },
      ),
    );
    return this.tourId;
  }

  private async publishCompletedIfSettled(): Promise<void> {
    if (!this.allSettled() || this.tourCompletedPublished || this.tourId === null) return;
    this.tourCompletedPublished = true;
    await this.eventBus.publish(
      createEvent("tour.completed", { tourId: this.tourId }, { correlationId: this.tourId }),
    );
  }

  /**
   * Best-effort persistence through the SettingsHost. A failed save keeps the
   * in-memory progress for this session (a Notice-level concern for the next
   * save, not a tour blocker) — logged, never thrown.
   */
  private async persist(): Promise<void> {
    const current = this.settings.getSettings();
    const next: TestHubSettings = {
      ...current,
      onboarding: {
        tourId: this.tourId,
        completedSteps: [...this.completed],
        skippedSteps: [...this.skipped],
        dismissed: this.dismissed,
      },
    };
    const saved = await this.settings.updateSettings(next);
    if (!saved.ok) {
      this.logger.warn("Could not persist Guided Tour progress; keeping it in memory.", {
        reason: saved.error.message,
      });
    }
  }

  /** Queues `task` behind every previously queued one (handlers + commands). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.catch((error: unknown) =>
      this.logger.error("Guided Tour task failed", error instanceof Error ? error : undefined),
    );
    return run;
  }
}

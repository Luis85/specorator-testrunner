import type { InjectionKey } from "vue";
import type { DomainEventType } from "../../../domain/events/domain-event";
import type { HubViewDeps } from "../../views/hub-view";

/** The hub leaf's dependency slice (the union of every hosted body's deps). */
export const HUB_DEPS = Symbol("hub-deps") as InjectionKey<HubViewDeps>;

/**
 * The union of refresh events the hosted bodies need (ADR-0031). The hub
 * subscribes to ALL of them; only the ACTIVE section's bodies (and the onboarding
 * rail) repaint on an event, so an event a hidden section cares about repaints
 * nothing until that section is shown — the same contract the hand-rolled HubView
 * had.
 */
export const HUB_REFRESH_ON: DomainEventType[] = [
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
  "scenario.history.recorded",
  "evidence.generated",
  "evidence.linkedToUseCase",
  "specification.created",
  "specification.updated",
  "dashboard.refreshed",
  "dashboard.kpi.updated",
  "settings.updated",
  "tour.started",
  "tour.step.completed",
  "tour.step.skipped",
  "tour.completed",
  "settings.reset",
  "prd.created",
  "prd.deleted",
  "storymap.created",
  "storymap.updated",
  "storymap.deleted",
  "suite.created",
  "suite.updated",
  "suite.deleted",
];

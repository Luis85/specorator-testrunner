/**
 * Domain event envelope and the full V1 event-type set (TIS §4, Event Catalog).
 *
 * The domain layer owns the envelope and the event-type literals; payload
 * shapes are stable per the Event Catalog. The {@link EventBus} contract that
 * transports these lives in the Shared Kernel.
 */
export interface DomainEvent<TPayload = unknown> {
  id: string; // ULID/UUID
  type: DomainEventType;
  occurredAt: string; // ISO-8601
  source: EventSource;
  correlationId?: string; // groups related events
  causationId?: string; // previous event in the chain
  payload: TPayload;
}

export type EventSource =
  | "plugin"
  | "runner" // events translated from runner output
  | "ci"
  | "user"
  | "system";

export type DomainEventType =
  // installation
  | "testhub.initialization.started"
  | "testhub.initialization.completed"
  | "testhub.initialization.failed"
  | "testrunner.installed"
  | "testrunner.validated"
  | "testrunner.repaired"
  // use case
  | "usecase.created"
  | "usecase.updated"
  | "usecase.deleted"
  | "usecase.status.changed"
  // specification
  | "specification.created"
  | "specification.updated"
  | "specification.linkedToUseCase"
  | "specification.validation.completed"
  | "specification.missingSteps.detected"
  | "stepdefinition.generated"
  // suite
  | "suite.created"
  | "suite.updated"
  | "suite.deleted"
  | "suite.executed"
  // test run
  | "testrun.requested"
  | "testrun.started"
  | "testrun.output.received"
  | "testrun.completed"
  | "testrun.failed"
  | "testrun.cancelled"
  // report
  | "report.detected"
  | "report.imported"
  | "report.import.failed"
  // evidence
  | "evidence.generated"
  | "evidence.linkedToUseCase"
  | "evidence.reviewed"
  | "evidence.swept"
  // dashboard
  | "dashboard.opened"
  | "dashboard.refreshed"
  | "dashboard.kpi.updated"
  // ci
  | "ci.pipeline.generated"
  | "ci.readiness.checked"
  | "ci.run.detected"
  // documentation
  | "documentation.generated"
  | "documentation.opened"
  // settings
  | "settings.updated"
  | "settings.validated"
  | "settings.reset";

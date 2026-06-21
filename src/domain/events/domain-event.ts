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
  // prd
  | "prd.created"
  | "prd.deleted"
  // persona
  | "persona.created"
  | "persona.updated"
  | "persona.deleted"
  // story map
  | "storymap.created"
  | "storymap.updated"
  | "storymap.deleted"
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
  | "report.imported"
  | "report.import.failed"
  | "scenario.history.recorded"
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
  | "settings.reset"
  // guided tour
  | "tour.started"
  | "tour.step.completed"
  | "tour.step.skipped"
  | "tour.completed";

/**
 * Compile-time payload contract for every {@link DomainEventType}, sourced
 * verbatim from the Event Catalog (§3–§13). {@link createEvent} is generic over
 * the event type so each publisher's payload is checked against the catalog
 * shape — a wrong payload becomes a compile error rather than runtime drift.
 *
 * Empty `{}` payloads use `Record<string, never>`; free-form fields use precise
 * types rather than `any`.
 */
export interface EventPayloads {
  // installation (§3)
  "testhub.initialization.started": { vaultPath: string };
  "testhub.initialization.completed": { testHubPath: string; runnerPath: string };
  "testhub.initialization.failed": { reason: string; step: string };
  "testrunner.installed": { runnerPath: string; packageManager: "npm" };
  "testrunner.validated": {
    nodeAvailable: boolean;
    packageManagerAvailable: boolean;
    playwrightAvailable: boolean;
    browsersInstalled: boolean;
  };
  "testrunner.repaired": { repairedFiles: string[] };

  // use case (§4)
  "usecase.created": { useCaseId: string; title: string; path: string };
  "usecase.updated": { useCaseId: string; path: string; changedFields: string[] };
  "usecase.deleted": { useCaseId: string; path: string };
  "usecase.status.changed": { useCaseId: string; previousStatus: string; nextStatus: string };

  // prd
  "prd.created": { prdId: string; title: string; path: string; parentPrdId?: string };
  "prd.deleted": { prdId: string; path: string; preservedFiles: number };

  // persona
  "persona.created": { personaId: string; name: string; path: string };
  "persona.updated": { personaId: string; name: string; path: string };
  "persona.deleted": { personaId: string; path: string };

  // story map
  "storymap.created": { storyMapId: string; title: string; path: string; product: string };
  "storymap.updated": { storyMapId: string; path: string; origin?: string };
  "storymap.deleted": { storyMapId: string; path: string; preservedFiles: number };

  // specification (§5)
  "specification.created": { useCaseId: string; featurePath: string };
  "specification.updated": { featurePath: string; scenarioCount: number; tags: string[] };
  "specification.linkedToUseCase": { useCaseId: string; featurePath: string };
  "specification.validation.completed": {
    featurePath: string;
    valid: boolean;
    errors: string[];
    /** The Feature's tags when parseable (empty otherwise), so observers —
     * e.g. the Guided Tour's authoring step — can react to tagging. */
    tags: string[];
  };
  "specification.missingSteps.detected": { featurePath: string; missingSteps: string[] };
  "stepdefinition.generated": {
    featurePath: string;
    stepFile: string;
    generatedSteps: string[];
  };

  // suite (§6)
  "suite.created": { suiteId: string; name: string; path: string; tagExpression: string };
  "suite.updated": { suiteId: string; tagExpression: string };
  "suite.deleted": { suiteId: string; path: string };
  "suite.executed": { suiteId: string; runId: string };

  // test execution (§7)
  "testrun.requested": {
    /** "demo" identifies the shipped Demo Test launch — a user suite whose id
     * slugifies to "demo" still publishes scope "suite", so the two are
     * distinguishable on the bus (PR #31 Codex review). */
    scope: "use-case" | "feature" | "suite" | "all" | "demo";
    target: string;
  };
  "testrun.started": { runId: string; command: string; workingDirectory: string };
  "testrun.output.received": { runId: string; stream: "stdout" | "stderr"; line: string };
  "testrun.completed": {
    runId: string;
    status: "passed" | "failed";
    durationMs: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  "testrun.failed": { runId: string; reason: string; exitCode?: number };
  "testrun.cancelled": { runId: string };

  // report (§8)
  "report.imported": { runId: string; reportPath: string; scenarioResults: number };
  "report.import.failed": { runId: string; reportPath: string; reason: string };
  /** Per-scenario history recorded for a finished run (US-057); `scenarioCount`
   * is the number of resolved-ref results written to the history projection. */
  "scenario.history.recorded": { runId: string; scenarioCount: number };

  // evidence (§9)
  "evidence.generated": { runId: string; evidencePath: string; linkedUseCases: string[] };
  "evidence.linkedToUseCase": { useCaseId: string; evidencePath: string };
  "evidence.reviewed": { evidencePath: string; reviewedBy?: string };
  "evidence.swept": { deletedPaths: string[]; updatedUseCases: string[] };

  // dashboard (§10)
  "dashboard.opened": { dashboardPath: string };
  "dashboard.refreshed": { useCaseCount: number; suiteCount: number; latestRunId?: string };
  "dashboard.kpi.updated": {
    totalUseCases: number;
    specifiedUseCases: number;
    automatedUseCases: number;
    passingUseCases: number;
    failingUseCases: number;
  };

  // ci (§11)
  "ci.pipeline.generated": { provider: "github-actions"; path: string };
  "ci.readiness.checked": { ready: boolean; missingItems: string[] };
  "ci.run.detected": { provider: string; runId?: string };

  // documentation (§12)
  "documentation.generated": { documents: string[] };
  "documentation.opened": {
    path: string;
    documentType: "getting-started" | "manual" | "troubleshooting" | "index";
  };

  // settings (§13)
  "settings.updated": { changedFields: string[] };
  "settings.reset": { profile: "default" };
  "settings.validated": { valid: boolean; warnings: string[] };

  // guided tour (Event Catalog "Tour Events")
  "tour.started": { tourId: string };
  "tour.step.completed": { tourId: string; stepId: string; via: "event" | "manual" };
  "tour.step.skipped": { tourId: string; stepId: string };
  "tour.completed": { tourId: string };
}

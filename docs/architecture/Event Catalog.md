# Event Catalog — Obsidian E2E Test Hub

> V1 domain event catalog: envelope, payloads, use-case mapping, EventBus contract, correlation rules.

- **Product:** Obsidian E2E Test Hub
- **Version:** 1.0
- **Stage:** MVP / V1
- **Type:** Domain Event Catalog
- **Companion documents:** [[Obsidian E2E Test Hub]], [[Solution Design]], [[Building Block View]], [[Runtime View]], [[Technical Interface Specification]]

This catalog supersedes the compact event list in Solution Design §13.

---

## 1. Event Naming Convention

Events are dot-delimited semantic paths rooted at a context or aggregate.

The general shape is:

```
<aggregate>[.<sub-aggregate-or-attribute>].<event>
```

Examples:

| Event | Reading |
| --- | --- |
| `testhub.initialization.started` | aggregate = `testhub`, sub = `initialization`, event = `started` |
| `testrunner.installed` | aggregate = `testrunner`, event = `installed` |
| `usecase.created` | aggregate = `usecase`, event = `created` |
| `usecase.status.changed` | aggregate = `usecase`, attribute = `status`, event = `changed` |
| `dashboard.kpi.updated` | aggregate = `dashboard`, attribute = `kpi`, event = `updated` |

Events are past-tense verbs (`created`, `updated`, `completed`). Imperative verbs (`requested`) appear only when they describe an *intent* that has been recorded (e.g. a queued run request).

---

## 2. Core Event Envelope

```ts
export interface DomainEvent<TPayload = unknown> {
  id: string;                              // ULID/UUID
  type: string;                            // e.g. "testrun.completed"
  occurredAt: string;                      // ISO-8601
  source: "plugin" | "runner" | "ci" | "user";
  correlationId?: string;                  // groups related events (see §19)
  causationId?: string;                    // the event that caused this one
  payload: TPayload;
}
```

`source = "runner"` denotes events translated from the test runner subprocess by `TestExecutionService`; the runner itself does not publish to the EventBus.

---

## 3. Installation Events

### `testhub.initialization.started`

```ts
{ vaultPath: string; }
```

### `testhub.initialization.completed`

```ts
{
  testHubPath: string;
  runnerPath: string;
}
```

### `testhub.initialization.failed`

```ts
{
  reason: string;
  step: string;
}
```

### `testrunner.installed`

```ts
{
  runnerPath: string;
  packageManager: "npm";                   // V1: fixed per SDD AD-2
}
```

### `testrunner.validated`

```ts
{
  nodeAvailable: boolean;
  packageManagerAvailable: boolean;
  playwrightAvailable: boolean;
  browsersInstalled: boolean;              // Chromium per SDD AD-5
}
```

### `testrunner.repaired`

```ts
{ repairedFiles: string[]; }
```

---

## 4. Use Case Events

### `usecase.created`

```ts
{
  useCaseId: string;
  title: string;
  path: string;
}
```

### `usecase.updated`

```ts
{
  useCaseId: string;
  path: string;
  changedFields: string[];
}
```

### `usecase.deleted`

```ts
{
  useCaseId: string;
  path: string;
}
```

### `usecase.status.changed`

```ts
{
  useCaseId: string;
  previousStatus: string;
  nextStatus: string;
}
```

`*Status` values follow `UseCaseStatus` in SDD §6.

---

## 5. Specification Events

### `specification.created`

```ts
{
  useCaseId: string;
  featurePath: string;
}
```

### `specification.updated`

```ts
{
  featurePath: string;
  scenarioCount: number;
  tags: string[];
}
```

### `specification.linkedToUseCase`

```ts
{
  useCaseId: string;
  featurePath: string;
}
```

### `specification.validation.completed`

```ts
{
  featurePath: string;
  valid: boolean;
  errors: string[];
}
```

### `specification.missingSteps.detected`

```ts
{
  featurePath: string;
  missingSteps: string[];
}
```

Trigger for UC-010 (StepDefinitionService).

### `stepdefinition.generated`

```ts
{
  featurePath: string;
  stepFile: string;                        // .testrunner/src/steps/*.ts
  generatedSteps: string[];
}
```

Result event for UC-010. `causationId` references the originating `specification.missingSteps.detected`.

---

## 6. Suite Events

### `suite.created`

```ts
{
  suiteId: string;
  name: string;
  path: string;
  tagExpression: string;                   // SDD AD-4
}
```

### `suite.updated`

```ts
{
  suiteId: string;
  tagExpression: string;
}
```

### `suite.deleted`

```ts
{
  suiteId: string;
  path: string;
}
```

### `suite.executed`

```ts
{
  suiteId: string;
  runId: string;
}
```

Emitted only at the end of a `Run Suite` (UC-013) flow, after the runner exits. **Not** emitted on suite-membership index updates — those are silent and surface only via the debounced `dashboard.refreshed` signal (per SDD AD-10).

---

## 7. Test Execution Events

### `testrun.requested`

```ts
{
  scope: "use-case" | "feature" | "suite" | "all";
  target: string;                          // id or path of the scoped entity
}
```

### `testrun.started`

```ts
{
  runId: string;
  command: string;
  workingDirectory: string;                // .testrunner
}
```

### `testrun.output.received`

```ts
{
  runId: string;
  stream: "stdout" | "stderr";
  line: string;
}
```

High-frequency event. Subscribers (the live monitor) should debounce or batch.

### `testrun.completed`

```ts
{
  runId: string;
  status: "passed" | "failed";             // normal completion only
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
}
```

`failed` = the run finished with at least one scenario failing an assertion.

### `testrun.failed`

```ts
{
  runId: string;
  reason: string;
  exitCode?: number;
}
```

Reserved for **errored** runs — the runner never reached a clean completion (crash, install fault, missing dependency). The payload has no result counts because none were produced.

### `testrun.cancelled`

```ts
{ runId: string; }
```

### Terminal-event invariant

Every test run emits **exactly one** terminal event, chosen by the way the run ended:

| Outcome | Terminal event |
| --- | --- |
| Run completed normally (passed or failed scenarios) | `testrun.completed` |
| Run errored (never produced results) | `testrun.failed` |
| Run cancelled by the user | `testrun.cancelled` |

Subscribers waiting on terminal state should listen to all three event types.

---

## 8. Report Events

### `report.detected`

Emitted by the plugin's file watcher (`source = "plugin"`) when a Playwright/Cucumber report file appears under `.testrunner/reports`. The runner does not publish to the EventBus — it writes files; the plugin observes them.

```ts
{
  runId: string;
  reportPath: string;
  format: "json" | "html";                 // markdown evidence is emitted as evidence.generated, not here
}
```

### `report.imported`

```ts
{
  runId: string;
  reportPath: string;
  scenarioResults: number;
}
```

### `report.import.failed`

```ts
{
  runId: string;
  reportPath: string;
  reason: string;
}
```

---

## 9. Evidence Events

### `evidence.generated`

```ts
{
  runId: string;
  evidencePath: string;
  linkedUseCases: string[];
}
```

### `evidence.linkedToUseCase`

```ts
{
  useCaseId: string;
  evidencePath: string;
}
```

### `evidence.reviewed`

```ts
{
  evidencePath: string;
  reviewedBy?: string;                     // optional frontmatter-driven annotation
}
```

`reviewedBy` is optional and originates from a manual `reviewedBy:` annotation in the evidence note's frontmatter — the plugin has no user identity of its own.

### `evidence.swept`

```ts
{
  deletedPaths: string[];                  // evidence folders removed by the sweeper
  updatedUseCases: string[];               // UC ids whose evidence[] was pruned
}
```

Emitted by `MaintenanceService.sweepEvidence()` (per SDD AD-11) only when the sweeper actually deleted something. Fires after the related `usecase.updated` events, so a single sweep produces a fan-out of `usecase.updated` followed by one `evidence.swept`. CI never triggers the sweeper.

---

## 10. Dashboard Events

### `dashboard.opened`

```ts
{ dashboardPath: string; }
```

### `dashboard.refreshed`

```ts
{
  useCaseCount: number;
  suiteCount: number;
  latestRunId?: string;
}
```

Signal-only — emitted after the suite-membership index incrementally updates (per SDD AD-10) or after a `testrun.completed`/`evidence.generated` chain settles. Debounced to 250 ms to coalesce bursts of vault file events. Subscribers (`TestHubView`, `SuiteExplorerView`, `UseCaseExplorerView`) re-query `TraceabilityService` for current counts instead of treating the payload as state.

### `dashboard.kpi.updated`

```ts
{
  totalUseCases: number;
  specifiedUseCases: number;
  automatedUseCases: number;
  passingUseCases: number;
  failingUseCases: number;
}
```

Counts are derived by `TraceabilityService` via `UseCaseAutomationPolicy` (ADR-0017). Deprecated UCs are excluded from every count. `@wip`-tagged Features are excluded from each UC's roll-up so half-built work does not move the dashboard.

Dashboard events are UI-integration events rather than business domain events. Per the EN-1 resolution they share the single domain `EventBus` in V1 (see §20). A separate `ui.*` channel will only be introduced if and when an external consumer (MCP, CLI) starts subscribing.

---

## 11. CI Events

### `ci.pipeline.generated`

```ts
{
  provider: "github-actions";              // V1: only GitHub Actions per SDD §17
  path: string;                            // repo root, e.g. .github/workflows/e2e.yml
}
```

The `provider` field is intentionally a union with a single member to keep V2 (`"azure-devops"`) forward-compatible without a schema change.

### `ci.readiness.checked`

```ts
{
  ready: boolean;
  missingItems: string[];
}
```

### `ci.run.detected`

```ts
{
  provider: string;
  runId?: string;
}
```

Reserved for V2 — V1 does not poll CI providers.

---

## 12. Documentation Events

### `documentation.generated`

```ts
{ documents: string[]; }
```

### `documentation.opened`

```ts
{
  path: string;
  // `index` is the navigational hub the generic "Open Documentation" command
  // opens by default (US-046); the three guides map to UC-021/022/023.
  documentType: "getting-started" | "manual" | "troubleshooting" | "index";
}
```

---

## 13. Settings Events

### `settings.updated`

```ts
{ changedFields: string[]; }
```

### `settings.reset`

```ts
{ profile: "default"; }
```

### `settings.validated`

```ts
{
  valid: boolean;
  warnings: string[];
}
```

---

## 14. Event-to-Use-Case Mapping

| Use Case | Events |
| --- | --- |
| UC-001 Initialize Test Hub | `testhub.initialization.started`, `testrunner.installed`, `documentation.generated`, `testhub.initialization.completed` |
| UC-002 Validate Environment | `testrunner.validated` |
| UC-003 Repair Installation | `testrunner.repaired` |
| UC-004 Create Use Case | `usecase.created` |
| UC-005 Edit Use Case | `usecase.updated` |
| UC-006 Generate Feature Specification | `specification.created`, `specification.linkedToUseCase` |
| UC-007 Edit Feature Specification | `specification.updated` |
| UC-008 Create Test Suite | `suite.created` |
| UC-009 Assign Scenario To Suite | `suite.updated` |
| UC-010 Generate Step Definition Stub | `specification.missingSteps.detected`, `stepdefinition.generated` |
| UC-011 Execute Use Case | `testrun.requested`, `testrun.started`, `testrun.completed` |
| UC-012 Execute Feature | `testrun.requested`, `testrun.started`, `testrun.completed` |
| UC-013 Execute Test Suite | `testrun.requested`, `suite.executed`, `testrun.completed` |
| UC-014 Execute Full Regression | `testrun.requested`, `testrun.completed` |
| UC-015 Monitor Test Run | `testrun.output.received` |
| UC-016 Generate Evidence | `report.imported`, `evidence.generated`, `evidence.linkedToUseCase` |
| UC-017 Review Evidence | `evidence.reviewed` |
| UC-018 View Dashboard | `dashboard.opened`, `dashboard.refreshed`, `dashboard.kpi.updated` |
| UC-019 Generate CI Pipeline | `ci.pipeline.generated` |
| UC-020 Validate CI Readiness | `ci.readiness.checked` |
| UC-021 Open User Manual | `documentation.opened` |
| UC-022 Open Getting Started Guide | `documentation.opened` |
| UC-023 Open Troubleshooting Guide | `documentation.opened` |
| UC-024 Reset Test Hub | `settings.reset`, `testhub.initialization.started`, `testhub.initialization.completed` |

---

## 15. MVP Event Priority

### Mandatory V1 Events

| Event | Used by |
| --- | --- |
| `testhub.initialization.started` | UC-001 |
| `testhub.initialization.completed` | UC-001 |
| `testhub.initialization.failed` | UC-001 |
| `testrunner.installed` | UC-001 |
| `testrunner.validated` | UC-002 |
| `usecase.created` | UC-004 |
| `specification.created` | UC-006 |
| `specification.linkedToUseCase` | UC-006 |
| `specification.missingSteps.detected` | UC-010 |
| `stepdefinition.generated` | UC-010 |
| `suite.created` | UC-008 |
| `testrun.requested` | UC-011, UC-013 |
| `testrun.started` | UC-011, UC-013 |
| `testrun.output.received` | UC-015 |
| `testrun.completed` | UC-011, UC-013 |
| `testrun.failed` | UC-011, UC-013 |
| `report.imported` | UC-016 |
| `evidence.generated` | UC-016 |
| `evidence.linkedToUseCase` | UC-016 |
| `dashboard.refreshed` | UC-018 |
| `ci.pipeline.generated` | UC-019 |
| `ci.readiness.checked` | UC-020 |
| `documentation.generated` | UC-001 |
| `documentation.opened` | UC-021, UC-022 |
| `settings.updated` | settings UX |

### Optional V1 Events

| Event | Used by |
| --- | --- |
| `usecase.deleted` | (no UC yet) |
| `usecase.status.changed` | UC-005 supporting |
| `specification.updated` | UC-007 |
| `specification.validation.completed` | UC-007 supporting |
| `suite.updated` | UC-009 |
| `suite.deleted` | (no UC yet) |
| `suite.executed` | UC-013 supporting |
| `testrun.cancelled` | UC-011 supporting |
| `report.detected` | UC-016 supporting |
| `report.import.failed` | UC-016 supporting |
| `evidence.reviewed` | UC-017 |
| `dashboard.opened` | UC-018 supporting |
| `dashboard.kpi.updated` | UC-018 supporting |
| `ci.run.detected` | V2 |
| `settings.reset` | UC-024 |
| `settings.validated` | settings UX |

---

## 16. Event Storage

V1 does **not** persist an event log.

- Runtime: in-process `EventBus` (see §17).
- Persistence: domain state derived from events is written to vault Markdown (evidence notes, frontmatter, dashboard tiles). The Markdown is the durable record.

### Future option (V2+)

```
Test Evidence/events/YYYY-MM-DD.ndjson
```

One NDJSON file per UTC day, append-only. Enables post-hoc analysis without becoming a full event-sourcing system.

---

## 17. EventBus Interface

```ts
export interface EventBus {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  subscribe<TPayload>(
    eventType: string,
    handler: EventHandler<TPayload>,
  ): Unsubscribe;
}

export type EventHandler<TPayload> = (
  event: DomainEvent<TPayload>,
) => Promise<void> | void;

export type Unsubscribe = () => void;
```

Handlers run asynchronously and in registration order. The bus does not retry — failures are logged through the `Logger` (per ADR-0019) and surfaced through Obsidian Notices when they are user-actionable. Background failures (handler exceptions with no user remediation) log at `warn` / `error` and reach the dashboard health tile, not a Notice.

---

## 18. Design Decision

The Event Catalog is used for:

- decoupling plugin services
- updating dashboard state
- creating evidence documents
- triggering report imports
- refreshing indexes
- maintaining traceability

It is **not** an event-sourcing system in V1. Aggregates own state; events communicate change.

---

## 19. Correlation Rules

| Flow | Correlation key | Notes |
| --- | --- | --- |
| Test run | `correlationId = runId` | All `testrun.*`, `report.*`, `evidence.*` events for a single execution share the same `correlationId`. |
| Initialization | `correlationId = initialization invocation id` | All `testhub.initialization.*`, `testrunner.installed`, `documentation.generated` for one wizard run share the id. |
| Use Case creation | `correlationId = useCaseId` | `usecase.created` → `usecase.indexed` chain via `causationId`. |
| Reset | `correlationId = reset invocation id` | `settings.reset` causes the subsequent re-initialization flow. |

`causationId` always points to the previous event in the chain; `correlationId` is constant across a logical flow.

---

## 20. Resolutions

All editorial notes raised in the first draft are now resolved.

| ID | Resolution |
| --- | --- |
| EN-1 | `dashboard.*` events remain on the single domain `EventBus` in V1. A separate `ui.*` channel is deferred until an external consumer subscribes. |
| EN-2 | Exactly one terminal event per test run: `testrun.completed` (passed/failed), `testrun.failed` (errored), or `testrun.cancelled`. `testrun.completed.status` is therefore reduced to `"passed" \| "failed"`; `"errored"` is no longer a `testrun.completed` outcome. |
| EN-3 | `usecase.indexed` removed. `TraceabilityService` indexes synchronously inside the `usecase.created` / `usecase.updated` handlers. |
| EN-4 | `report.generated` renamed to `report.detected`. Source is `"plugin"`; the plugin's file watcher observes runner output rather than receiving an event from the subprocess. |
| EN-5 | No `demo.generated` event in V1. Demo content creation stays under `documentation.generated`. Revisit if a standalone "regenerate demo" flow is added in V2+. |

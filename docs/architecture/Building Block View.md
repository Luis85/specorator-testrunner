# Building Block View — Obsidian E2E Test Hub

> Arc42 building block view. Drills the [Solution Design](./Solution%20Design.md)'s layered architecture into concrete views, services, adapters, and runner modules. Locked architectural decisions (AD-1…AD-8) referenced inline.

- **Version:** 1.0
- **Status:** Draft
- **Architecture Stage:** Solution Design / Arc42 §5 (Building Blocks)
- **Companion documents:** [[Obsidian E2E Test Hub]], [[Solution Design]], [[Runtime View]], [[Technical Interface Specification]], [[Event Catalog]]

---

## 1. Overview

The system consists of three building blocks:

| Block | Role |
| --- | --- |
| **Obsidian Plugin** | User-facing UI, orchestration, scaffolding, reporting. |
| **Vault Artifacts** | Markdown-native source of truth (Use Cases, Specifications, Suites, Evidence, Documentation). |
| **`.testrunner`** | Standalone Playwright + Cucumber-JS test runtime, independently executable in CI (per AG-002, AG-004, AD-3). |

The plugin orchestrates; the vault holds business data; the runner executes. Each can be reasoned about independently.

---

## 2. Level 1 — System building blocks

```
Obsidian E2E Test Hub
├─ Obsidian Plugin
├─ Vault Artifacts
└─ .testrunner
```

### 2.1 Obsidian Plugin

- **Purpose:** User-facing Test Hub inside Obsidian.
- **Responsibilities:** Dashboard, settings, init wizard, Use Case/Specification/Suite management, test execution orchestration, report import, evidence generation, CI pipeline generation.

### 2.2 Vault Artifacts

- **Purpose:** Markdown-native source of truth.
- **Responsibilities:** Store Use Cases, Gherkin Specifications, Test Suites, Evidence, Documentation.

### 2.3 `.testrunner`

- **Purpose:** Standalone test execution runtime.
- **Responsibilities:** Execute Cucumber/Gherkin tests, drive browsers via Playwright (Chromium per AD-5), generate reports, run locally and in CI, remain independent of Obsidian.

---

## 3. Level 2 — Plugin internal structure

```
Obsidian Plugin
├─ Presentation Layer
├─ Application Layer
├─ Domain Layer
├─ Infrastructure Layer
└─ Shared Kernel
```

Dependency direction: outer layers depend on inner layers; the Domain has zero outward dependencies (see §10).

---

## 4. Presentation Layer

Path: `src/presentation/{views,components,commands,settings}`.

Each view subscribes to the `EventBus` for state it cares about and dispatches commands to application services for state changes. Views do not publish domain events directly; services do.

| View | Surface | Purpose | Consumes |
| --- | --- | --- | --- |
| `TestHubView` | Workspace leaf | Main dashboard: KPIs, runner health, recent runs, Use Cases, suites, quick actions. | `dashboard.refreshed`, `dashboard.kpi.updated`, `testrun.completed`, `testrunner.validated` |
| `InitializationWizardView` | Modal | Guided first-run setup; shows progress and failure with retry. | `testhub.initialization.completed`, `testhub.initialization.failed`, `testrunner.installed`, `documentation.generated` |
| `UseCaseExplorerView` | Workspace leaf | Browse, create, run Use Cases; show automation status. | `usecase.created`, `usecase.updated`, `usecase.status.changed`, `evidence.linkedToUseCase` |
| `SpecificationExplorerView` | Workspace leaf | Manage feature files; validate; detect missing steps. | `specification.created`, `specification.updated`, `specification.validation.completed`, `specification.missingSteps.detected` |
| `SuiteExplorerView` | Workspace leaf | List/create/run suites; manage tag expressions. | `suite.created`, `suite.updated`, `suite.executed` |
| `TestRunPanel` | Sidebar leaf | Live execution: streaming output, status, results, evidence link. | `testrun.started`, `testrun.output.received`, `testrun.completed`, `testrun.failed`, `testrun.cancelled` |
| `EvidenceExplorerView` | Workspace leaf | List/open evidence; jump to reports, screenshots, traces. | `evidence.generated`, `evidence.linkedToUseCase`, `report.imported` |
| `DocumentationView` | Workspace leaf | Render generated `Test Hub` notes (Getting Started, User Manual, Troubleshooting). | `documentation.generated`, `documentation.opened` |
| `SettingsTab` | Obsidian Settings | Edit paths, validate, reset. | `settings.updated`, `settings.validated`, `settings.reset` |

---

## 5. Application Layer

Path: `src/application/{services,use-cases,ports}`.

Services orchestrate domain logic. They depend only on the Domain layer and on infrastructure *ports* (interfaces), never on concrete adapters.

### 5.1 `InitializationService`

- **Purpose:** Coordinates first-time setup.
- **Responsibilities:** Create vault folders, delegate documentation/demo/runner generation, trigger dependency install, validate the result.
- **Publishes:** `testhub.initialization.started`, `testhub.initialization.completed`, `testhub.initialization.failed`.
- **Depends on:** `SettingsService`, `DocumentationGenerationService`, `RunnerInstallationService`, `SuiteService` (default suites), `EnvironmentValidationService`.

### 5.2 `SettingsService`

- **Purpose:** Load, persist, validate, expose normalized paths.
- **Publishes:** `settings.updated`, `settings.validated`.

### 5.3 `RunnerInstallationService`

- **Purpose:** Materialise `.testrunner`.
- **Responsibilities:** Write template files (per AD-7: TypeScript + `cucumber.mjs`), run `npm install` (AD-2), install the Chromium browser (AD-5), seed the demo fixture (AD-8).
- **Publishes:** `testrunner.installed`.
- **Depends on:** `RunnerTemplateWriter`, `ProcessAdapter`.

### 5.4 `EnvironmentValidationService`

- **Purpose:** Single validation surface for environment (UC-002), runner, and CI readiness (UC-020).
- **Publishes:** `testrunner.validated`, `ci.readiness.checked`.

### 5.5 `MaintenanceService`

- **Purpose:** Repair (UC-003) and reset (UC-024) the installation, plus sweep stale Evidence per the retention setting (SDD AD-11).
- **Publishes:** `testrunner.repaired`, `settings.reset`, `evidence.swept`.

### 5.6 `DocumentationGenerationService`

- **Purpose:** Generate Getting Started, User Manual, Troubleshooting (per G5: three docs, no Reference).
- **Publishes:** `documentation.generated`.

### 5.7 `UseCaseService`

- **Purpose:** Use Case lifecycle.
- **Responsibilities:** Create document, parse frontmatter, update metadata, link to feature and evidence.
- **Publishes:** `usecase.created`, `usecase.updated`, `usecase.status.changed`.

### 5.8 `SpecificationService`

- **Purpose:** Feature file lifecycle.
- **Publishes:** `specification.created`, `specification.updated`, `specification.linkedToUseCase`, `specification.validation.completed`, `specification.missingSteps.detected`.

### 5.9 `SuiteService`

- **Purpose:** Suite lifecycle, tag-expression resolution (AD-4).
- **Publishes:** `suite.created`, `suite.updated`, `suite.executed`.

### 5.10 `StepDefinitionService`

- **Status:** Implemented (P2-5) — `src/application/services/step-definition-service.ts`.
- **Purpose:** Generate TypeScript step-definition stubs for the undefined Gherkin steps of a Feature (UC-010 / RV-4).
- **Responsibilities:** Re-diff the requested steps against every existing `*.ts` under `.testrunner/src/steps` (so generation is non-destructive — already-defined steps are never re-stubbed), render `Given(...)` stubs via the pure `buildStepDefinitionStubFile` helper in `content/step-definitions.ts`, and write them through the `VaultFileSystem` port into `.testrunner/src/steps/<feature>.steps.ts` (the same path `SpecificationService.detectMissingSteps` reads). Appends to a hand-edited file; never overwrites. Depends only on ports/services.
- **Trigger model:** Explicit user command (not auto-on-edit). The caller runs `SpecificationService.detectMissingSteps` then passes its `missingSteps` + `detectionEventId` here.
- **Publishes:** `stepdefinition.generated`, with `causationId` set to the originating `specification.missingSteps.detected` event id (Event Catalog §5/§19). No event is published when there is nothing to stub.

### 5.11 `TestExecutionService`

- **Purpose:** Orchestrate test execution.
- **Responsibilities:** Resolve scope, build runner command, spawn child process, stream output, detect completion. Serial execution in V1 (AD-6). Exposes `lastRun()` (the just-finished run) so the `PostRunCoordinator` can import it without reconstructing it from an event payload.
- **Publishes:** `testrun.requested`, `testrun.started`, `testrun.output.received`, `testrun.completed`, `testrun.failed`, `testrun.cancelled`. (Per EN-2: exactly one terminal event per run.)
- **Depends on:** `RunnerCommandBuilder`, `ProcessAdapter`. It does **not** import reports itself — the `PostRunCoordinator` reacts to the terminal event.

### 5.11a `PostRunCoordinator`

- **Purpose:** Drive the in-process post-run flow (P2-1/P2-6/P2-7), replacing the never-built `ReportFileWatcher`/`report.detected` choreography.
- **Responsibilities:** Subscribe to the EN-2 terminal run events (`testrun.completed`/`failed`/`cancelled`); on a terminal event, obtain the finished run via `TestExecutionService.lastRun()` and run import → evidence → dashboard refresh, serialized through a single evidence chain so back-to-back runs can't clobber each other's Use Case frontmatter. Encapsulates the run-status eligibility rule (`importLastRun()`, for the manual re-import command) and exposes `whenSettled()` for unload/reset.
- **Publishes:** nothing directly; it drives `ReportImportService`, `EvidenceGenerationService`, and `TraceabilityService.refreshDashboard()`.
- **Depends on:** `ReportImportService`, `EvidenceGenerationService`, `TraceabilityService`, `EventBus`, `Logger`. Application-layer only — no Obsidian/infra imports.

### 5.12 `ReportImportService`

- **Purpose:** Import runner reports.
- **Invoked by:** `PostRunCoordinator` (after a terminal run event) and the manual "Import Report for Last Run" command. The runner writes report files; the plugin reads them after the run ends (no file watcher, no `report.detected`).
- **Publishes:** `report.imported`, `report.import.failed`.
- **Depends on:** `ReportParserAdapter`.

### 5.13 `EvidenceGenerationService`

- **Purpose:** Render audit-ready Markdown evidence; link to Use Case.
- **Publishes:** `evidence.generated`, `evidence.linkedToUseCase`.

### 5.14 `PipelineGenerationService`

- **Purpose:** Generate CI configuration at the repo root `.github/workflows/` (AD-3).
- **Publishes:** `ci.pipeline.generated`.

### 5.15 `TraceabilityService`

- **Purpose:** Maintain Use Case ↔ Feature ↔ Suite ↔ Run ↔ Evidence links (FR-017); owns the suite-membership index (per SDD AD-10); feeds the dashboard.
- **Responsibilities:** Aggregate the Use Case index into a `DashboardSnapshot`. Exposes two reads: `refreshDashboard()` (computes **and publishes** `dashboard.refreshed`/`dashboard.kpi.updated` — used to PUSH from the `PostRunCoordinator` and from a dashboard view's open) and `snapshot()` (the same computation **without** publishing — read by the views when re-rendering, so a view reacting to `dashboard.*` cannot loop, P2-6).
- **Publishes:** `dashboard.refreshed`, `dashboard.kpi.updated` (from `refreshDashboard()` only).

---

## 6. Domain Layer

Path: `src/domain/{entities,value-objects,events,repositories,policies}`.

### 6.1 Entities

`UseCase`, `FeatureSpecification`, `TestSuite`, `TestRun`, `Evidence`, `RunnerInstallation`, `CiPipeline`.

### 6.2 Value Objects

`VaultPath`, `RunnerPath`, `UseCaseId`, `SuiteId`, `FeatureTag`, `TagExpression`, `TestStatus`, `ExecutionScope`.

### 6.3 Domain Events

Defined in the [Event Catalog](./Event%20Catalog.md). The Domain Layer exports the envelope and the event type literals; payload shapes are stable per the catalog.

### 6.4 Domain Policies

| Policy | Purpose |
| --- | --- |
| `UseCaseIdPolicy` | Generate and validate stable `UC-NNN` identifiers. |
| `PathSafetyPolicy` | Reject vault-escaping paths in settings and generated artifacts. |
| `RunnerExecutionPolicy` | Decide what `--tags` expression to pass per execution scope. |
| `EvidenceLinkingPolicy` | Determine which Use Case(s) a run's evidence attaches to. |
| `CiReadinessPolicy` | Encode the rules for `EnvironmentValidationService` CI check. |
| `UseCaseAutomationPolicy` | Derive `UseCase.automationStatus` from Feature states with `@wip` exclusion (per ADR-0017). |

### 6.5 Repositories (ports)

`UseCaseRepository`, `FeatureRepository`, `SuiteRepository`, `TestRunRepository`, `EvidenceRepository` — declared as interfaces in the Domain; implemented in Infrastructure.

---

## 7. Infrastructure Layer

Path: `src/infrastructure/{obsidian,filesystem,runner,reports,templates,ci}`.

| Adapter | Wraps |
| --- | --- |
| `ObsidianVaultAdapter` | Obsidian `Vault` — folders, notes, frontmatter, file IO. |
| `ObsidianWorkspaceAdapter` | Obsidian `Workspace` — open views, leaves, commands, modals. |
| `FileSystemAdapter` | Node `fs/promises` for paths outside the vault index (`.testrunner` internals, `.github/workflows/`). |
| `ProcessAdapter` | Node `child_process.spawn` for `npm install`, browser install, runner execution; supports cancellation. |
| `RunnerTemplateWriter` | Writes the `.testrunner` template: `package.json`, `tsconfig.json`, `playwright.config.ts`, `cucumber.mjs`, demo steps, demo page objects, fixtures (AD-8), `README.md`. |
| `ReportParserAdapter` | Parses Cucumber JSON + Playwright artifacts (reports, screenshots, traces). |
| `CiTemplateWriter` | Writes `.github/workflows/e2e.yml` (AD-3). Azure DevOps template stub deferred to V2. |
| ~~`ReportFileWatcher`~~ | **Not built / removed.** The post-run import is driven in-process by the `PostRunCoordinator` (application layer) from the EN-2 terminal run event, not by a filesystem watcher. See §5.11a and Event Catalog §8. |
| `FeatureFileWatcher` | _(Deferred, per SDD AD-10.)_ Would subscribe to `vault.on('modify' \| 'create' \| 'rename' \| 'delete')` for `*.feature` to feed incremental traceability updates. Not in V1. |

---

## 8. Shared Kernel

Path: `src/shared/{event-bus,logging,result,errors,utils}`.

| Module | Purpose |
| --- | --- |
| `EventBus` | Single in-process bus shared by domain + UI events (per EN-1). |
| `Result<T, E>` | Exception-free flow for application-level operations. |
| `Logger` | Structured diagnostics with credential redaction; writes through `LogSinkPort` adapters to console, Notices, and the vault-resident persistent log per ADR-0019. |
| `Errors` | Tagged error hierarchy for actionable failure modes. |

```ts
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

---

## 9. Level 2 — `.testrunner` internal structure

```
.testrunner
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ playwright.config.ts
├─ cucumber.mjs            (per AD-7: tsx loader)
├─ src/
│  ├─ steps/               (step definitions, generated by StepDefinitionService)
│  ├─ pages/               (page objects)
│  ├─ support/             (Cucumber World, hooks, browser setup)
│  └─ fixtures/            (demo SUT per AD-8)
│     └─ example.html
├─ reports/                (Cucumber JSON, Playwright HTML, screenshots, traces)
└─ README.md
```

CI workflow files live at the **repo root** (`.github/workflows/`), not inside `.testrunner` — per AD-3. The runner is invoked from CI by `cd .testrunner && npm ci && npx cucumber-js`.

### 9.1 Runtime configuration

`package.json`, `tsconfig.json` (strict), `playwright.config.ts`, `cucumber.mjs`. Together make the runner executable locally and in CI with `npm ci && npx cucumber-js`.

### 9.2 Step Definitions (`src/steps`)

TypeScript files mapping Gherkin steps to Playwright actions. Generated by `StepDefinitionService` (UC-010).

### 9.3 Page Objects (`src/pages`)

Encapsulate UI automation logic and locator strategy.

### 9.4 Support Layer (`src/support`)

Cucumber World, hooks (before/after), browser setup, shared utilities.

### 9.5 Fixtures (`src/fixtures`)

Per AD-8: static HTML files served via `file://`. The demo scenario `example.feature` navigates to `file:///{runnerRoot}/src/fixtures/example.html`. No fixture HTTP server; zero internet dependency; deterministic in CI.

### 9.6 Reports (`reports`)

Cucumber JSON, Playwright HTML, screenshots, traces. Read by `ReportImportService` after a run ends (the `PostRunCoordinator` triggers the import from the terminal run event — there is no filesystem watcher).

---

## 10. Module dependency rules

```
Presentation → Application
Application → Domain
Application → Ports
Infrastructure → Ports
Domain → no outer layer
```

**Forbidden:**

- Domain → Obsidian API
- Domain → Node `fs` / `child_process`
- Domain → Playwright
- Application → Obsidian concrete APIs (only via ports)

**Allowed:**

- Application → repository / adapter *interfaces*
- Infrastructure → concrete implementations
- Presentation → application services

Enforced via ESLint `no-restricted-imports` and a layer-import test fixture in CI.

---

## 11. Recommended source structure

```
src/
├─ main.ts
├─ presentation/
│  ├─ views/
│  ├─ components/
│  ├─ commands/
│  └─ settings/
├─ application/
│  ├─ services/
│  ├─ use-cases/
│  └─ ports/
├─ domain/
│  ├─ entities/
│  ├─ value-objects/
│  ├─ events/
│  ├─ repositories/
│  └─ policies/
├─ infrastructure/
│  ├─ obsidian/
│  ├─ filesystem/
│  ├─ runner/
│  ├─ reports/
│  ├─ templates/
│  └─ ci/
└─ shared/
   ├─ event-bus/
   ├─ result/
   ├─ errors/
   └─ logging/
```

`manifest.json`, `styles.css`, `esbuild.config.mjs` and `package.json` live at the repo root (existing layout).

---

## 12. Key interfaces

```ts
// EventBus (full contract in Event Catalog §17)
export interface EventBus {
  publish<T>(event: DomainEvent<T>): Promise<void>;
  subscribe<T>(eventType: string, handler: EventHandler<T>): Unsubscribe;
}

// Runner port
export interface Runner {
  run(command: RunnerCommand): Promise<RunnerResult>;
  cancel(runId: string): Promise<void>;
}

// Repositories (one per aggregate)
export interface UseCaseRepository {
  create(useCase: UseCase): Promise<void>;
  update(useCase: UseCase): Promise<void>;
  findAll(): Promise<UseCase[]>;
  findById(id: UseCaseId): Promise<UseCase | null>;
}

export interface EvidenceRepository {
  create(evidence: Evidence): Promise<void>;
  linkToUseCase(evidenceId: string, useCaseId: UseCaseId): Promise<void>;
}
```

Full type catalog lives next to each aggregate; see also [Solution Design §6](./Solution%20Design.md).

---

## 13. Runtime flow — Initialize Test Hub (UC-001)

```
User clicks "Initialize Test Hub"
   ↓
InitializationWizardView dispatches command
   ↓
InitializationService
   ├─ SettingsService.loadDefaults()
   ├─ ObsidianVaultAdapter.createFolders()
   ├─ DocumentationGenerationService.generate()    → documentation.generated
   ├─ SuiteService.createDefaultSuites()            → suite.created × 2 (Smoke, Regression)
   ├─ RunnerInstallationService.install()           → testrunner.installed
   │     ├─ RunnerTemplateWriter.write()
   │     ├─ ProcessAdapter.spawn(npm install)
   │     └─ ProcessAdapter.spawn(playwright install chromium)
   └─ EnvironmentValidationService.validate()       → testrunner.validated
   ↓
EventBus.publish(testhub.initialization.completed)
   ↓
TestHubView refreshes; user clicks "Run Demo Test" (AD-1)
```

---

## 14. Runtime flow — Execute Test Suite (UC-013)

```
User clicks "Run" on a suite
   ↓
SuiteExplorerView dispatches command
   ↓
TestExecutionService
   ├─ RunnerCommandBuilder.forSuite(tagExpression)   → npx cucumber-js --tags "@smoke"
   ├─ EventBus.publish(testrun.requested)
   ├─ ProcessAdapter.spawn(cmd)                      → testrun.started
   │     └─ each stdout line → testrun.output.received
   └─ on exit (per EN-2 terminal invariant):
       - clean exit → testrun.completed
       - error exit → testrun.failed
       - cancel    → testrun.cancelled
   ↓
PostRunCoordinator (subscribed to the terminal events) reads the finished run
   via TestExecutionService.lastRun(), then runs (serialized):
   ├─ ReportImportService.import(run)            → report.imported
   ├─ EvidenceGenerationService.generate()       → evidence.generated, evidence.linkedToUseCase
   └─ TraceabilityService.refreshDashboard()     → dashboard.refreshed, dashboard.kpi.updated
```

The coordinator obtains the finished `TestRun` from `TestExecutionService.lastRun()` (recorded before the terminal event is published, so the synchronously-awaited handler sees the correct run). An `errored` run produced no report and is skipped. The dashboard refresh is **pushed** here so the KPI events fire even when no view is open (P2-6).

---

## 15. Architectural risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R1 | Node.js not installed on the user's machine. | `EnvironmentValidationService` reports clearly; troubleshooting doc gives install steps. |
| R2 | First-time install is long (~150 MB Chromium download). | Progress UI in `InitializationWizardView`; cancel + retry; partial-state aware. |
| R3 | Platform differences (Windows path separators, shell quoting). | `RunnerCommandBuilder` uses platform-aware spawning; tests cover Windows + macOS + Linux. |
| R4 | Runner drift — user edits `.testrunner` and breaks invariants. | Generated template marker; `MaintenanceService.repair()` re-syncs; readiness check on every run. |
| R5 | Vault path with spaces or non-ASCII breaks the runner. | `PathSafetyPolicy` validates settings; init wizard warns. |
| R6 | Plugin and runner versions drift in long-lived vaults. | Embed plugin version into `.testrunner/package.json`; show diff in dashboard health. |

---

## 16. Architectural decisions

Decisions already locked in the [Solution Design](./Solution%20Design.md#25-architectural-decisions):

| AD | Decision |
| --- | --- |
| AD-1 | Demo test runs on user click, not during init. |
| AD-2 | Package manager fixed to `npm` in V1. |
| AD-3 | CI workflow files at repo root `.github/workflows/`. |
| AD-4 | Suites are tag-driven (`TagExpression`). |
| AD-5 | Chromium-only browser matrix in V1. |
| AD-6 | Serial test execution in V1. |
| AD-7 | TypeScript via `tsx` loader from `cucumber.mjs`. |
| AD-8 | Demo SUT = local static HTML served via `file://`; no fixture HTTP server. |

Future ADRs (Arc42 §9 style, separate notes once we kick off implementation):

- ADR-001 Separate Plugin and Runner (codifies AG-002).
- ADR-002 Store Runner in `.testrunner` (codifies §16 of Solution Design).
- ADR-003 Gherkin as Specification Format.
- ADR-004 Playwright as Browser Automation Engine.
- ADR-005 Markdown Evidence as a first-class artifact.
- ADR-006 Repo-root CI workflows (codifies AD-3).

---

## 17. Definition of Architecture Done

The Building Block View is accepted when:

- System boundaries are clear (§1, §2).
- Plugin modules are defined (§4–§8).
- Runner modules are defined (§9).
- Dependency rules are explicit (§10).
- Key interfaces are identified (§12).
- Runtime flows are documented (§13–§14).
- Source structure is ready for implementation (§11).
- Risks are catalogued with mitigations (§15).
- All locked AD-1…AD-8 are reflected.

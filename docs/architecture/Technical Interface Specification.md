# Technical Interface Specification — Specorator Testrunner

> Concrete TypeScript contracts for V1: shared types, domain entities, repositories, application services, infrastructure ports, frontmatter schemas, runner templates, CI templates, and validation policies. Implementation-ready.

- **Version:** 1.0
- **Status:** Draft
- **Stage:** Solution Design / Implementation Preparation
- **Type:** Technical Contract Document
- **Companion documents:** [[Specorator Testrunner]], [[Solution Design]], [[Building Block View]], [[Runtime View]], [[Event Catalog]]

---

## 1. Purpose

This document defines the technical contracts for the V1 implementation. It specifies TypeScript interfaces, domain data structures, service contracts, repository contracts, frontmatter schemas, runner templates, report contracts, and CI contracts so the plugin is modular, testable, loosely coupled, and ready to implement.

---

## 2. Design Principles

### 2.1 Dependency Direction

```
Presentation → Application → Domain
Infrastructure → Application Ports
Domain → no external dependencies
```

Enforced by the module dependency rules in [Building Block View §10](./Building%20Block%20View.md#10-module-dependency-rules).

### 2.2 Domain Isolation

The domain layer must not depend on Obsidian APIs, Node `fs`, Playwright, playwright-bdd, child processes, or DOM APIs.

### 2.3 Port / Adapter Design

Application services depend on **ports** (interfaces declared in `application/ports/` or `domain/repositories/`). Infrastructure adapters implement those ports.

### 2.4 Result-Based Flow

Application services return `Result<T, E>` instead of throwing. Exceptions are reserved for programmer errors.

---

## 3. Shared Types

### 3.1 Result

```ts
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

### 3.2 AppError

```ts
export interface AppError {
  code: ErrorCode;                         // typed union per ADR-0019
  message: string;                         // human-readable message
  details?: Record<string, unknown>;
  cause?: unknown;
}

export type ErrorCode =
  // execution
  | "RUN_IN_PROGRESS"                      // ADR-0018
  | "RUN_TIMEOUT"
  | "RUN_CANCELLED"
  // path / command safety
  | "PATH_UNSAFE"                          // PathSafetyPolicy
  | "COMMAND_DISALLOWED"                   // RunnerExecutionPolicy
  // install / runner
  | "INIT_FAILED"
  | "RUNNER_MISSING_FILE"
  | "BROWSER_NOT_INSTALLED"
  | "NPM_INSTALL_FAILED"
  // report / evidence
  | "REPORT_NOT_FOUND"
  | "REPORT_PARSE_FAILED"
  | "EVIDENCE_WRITE_FAILED"
  // settings / validation
  | "SETTINGS_INVALID"
  | "SUT_ENV_NOT_FOUND";
```

Codes are stable across plugin versions. Adding is safe; renaming is breaking.

### 3.3 Identifiers

```ts
export type Id = string;
export type PrdId = string;                // e.g. "PRD-001"; "PRD-000" is the root
export type UseCaseId = string;            // e.g. "UC-001"
export type SuiteId = string;              // e.g. "smoke"
export type RunId = string;                // e.g. "RUN-2026-06-01-100000"
export type EvidenceId = string;           // e.g. "EV-2026-06-01-100000"
export type ScenarioReference = string;    // "<featurePath>::<scenarioName>[::row-<index>]" per SDD AD-10
```

### 3.4 VaultPath

```ts
export type VaultPath = string;
```

Rules (validated by `PathSafetyPolicy`, §14.1):

- Must be relative to vault root.
- Must not start with `/`.
- Must not contain `..`.
- May reference hidden folders such as `.testrunner` and `.github`.

---

## 4. Domain Events

### 4.1 DomainEvent envelope

```ts
export interface DomainEvent<TPayload = unknown> {
  id: string;                              // ULID/UUID
  type: DomainEventType;
  occurredAt: string;                      // ISO-8601
  source: EventSource;
  correlationId?: string;                  // groups related events
  causationId?: string;                    // previous event in the chain
  payload: TPayload;
}
```

### 4.2 EventSource

```ts
export type EventSource =
  | "plugin"
  | "runner"                               // events translated from runner output
  | "ci"
  | "user"
  | "system";
```

### 4.3 DomainEventType

Full V1 set, sourced verbatim from the [Event Catalog](./Event%20Catalog.md).

```ts
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
  // report (report.detected removed — the in-process PostRunCoordinator drives
  // the import from the terminal run event; no ReportFileWatcher. See §9.7.)
  | "report.imported"
  | "report.import.failed"
  // evidence
  | "evidence.generated"
  | "evidence.linkedToUseCase"
  | "evidence.reviewed"
  | "evidence.swept"
  // dashboard (UI integration events — share the bus per EN-1)
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
```

### 4.4 EventBus

```ts
export interface EventBus {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  subscribe<TPayload>(
    eventType: DomainEventType,
    handler: EventHandler<TPayload>,
  ): Unsubscribe;
}

export type EventHandler<TPayload> = (
  event: DomainEvent<TPayload>,
) => Promise<void> | void;

export type Unsubscribe = () => void;
```

---

## 5. Settings

### 5.1 TestHubSettings

```ts
export interface TestHubSettings {
  paths: TestHubPathSettings;
  runner: RunnerSettings;
  automation: AutomationSettings;
  ci: CiSettings;
  sut: SutSettings;                        // per ADR-0013 + ADR-0014
  logging: LoggingSettings;                // per ADR-0019
}
```

### 5.1.2 LoggingSettings (per ADR-0019)

```ts
export interface LoggingSettings {
  enabled: boolean;                        // master switch for the persistent file sink
  path: VaultPath;                         // default "Test Hub/logs"
  level: "debug" | "info" | "warn" | "error";
}
```

The persistent log file is written to `<vault>/<logging.path>/plugin-<YYYY-MM-DD>.log` (daily rotation). Console and Notice sinks are unaffected by `enabled` — they are always on for `warn`/`error`. Users who want to keep logs out of git add `<logging.path>/` to their `.gitignore`. The `path` is validated by `PathSafetyPolicy`.

### 5.1.1 SutSettings (per ADR-0013, ADR-0014)

```ts
export interface SutSettings {
  active: string;                          // key into environments
  environments: Record<string, SutEnvironment>;
}

export interface SutEnvironment {
  baseUrl: string;                         // e.g. "https://staging.example.com"
  auth?: SutAuth;                          // demo Environment has none
}

export interface SutAuth {
  // Keys are injected verbatim into the runner subprocess as env vars.
  // Plugin does NOT interpret them; user step definitions read process.env.E2E_*.
  // V1 stores values in plaintext in plugin data per SDD AD-9.
  env: Record<string, string>;
}
```

### 5.2 TestHubPathSettings

```ts
export interface TestHubPathSettings {
  testHubPath: VaultPath;
  useCasesPath: VaultPath;
  specificationsPath: VaultPath;
  featureFilesPath: VaultPath;
  testSuitesPath: VaultPath;
  evidencePath: VaultPath;
  documentationPath: VaultPath;
  testRunnerPath: VaultPath;
}
```

### 5.3 RunnerSettings

```ts
export interface RunnerSettings {
  packageManager: PackageManager;
  nodeExecutable: string;
  installCommand: string;                  // `npm install` for local
  ciInstallCommand: string;                // `npm ci` for CI
  browserInstallCommand: string;
  defaultRunCommand: string;
  smokeRunCommand: string;
  ciRunCommand: string;
}
```

### 5.4 PackageManager

```ts
export type PackageManager = "npm";        // V1 fixed per AD-2; V2 union: "npm" | "pnpm" | "yarn"
```

### 5.5 AutomationSettings

```ts
export interface AutomationSettings {
  autoCreateFolders: boolean;
  autoCreateDocumentation: boolean;
  autoCreateDemoContent: boolean;
  updateUseCaseFrontmatterAfterRun: boolean;
  generateEvidenceMarkdown: boolean;
  openDashboardAfterInitialization: boolean;
  evidenceRetentionDays?: number;          // SDD AD-11: undefined = keep forever (V1 default)
}
```

### 5.6 CiSettings

```ts
export interface CiSettings {
  provider: CiProvider;                    // V1: only "github-actions" generates output
  workflowPath: string;                    // repo-root path; not a VaultPath
  nodeVersion: string;
}
```

### 5.7 CiProvider

```ts
export type CiProvider = "github-actions" | "azure-devops" | "none";
// V1: only "github-actions" emits workflow files; "azure-devops" reserved for V2.
```

### 5.8 DEFAULT_SETTINGS

```ts
export const DEFAULT_SETTINGS: TestHubSettings = {
  paths: {
    testHubPath: "Test Hub",
    useCasesPath: "Use Cases",
    specificationsPath: "Specifications",
    featureFilesPath: "Specifications/features",
    testSuitesPath: "Test Suites",
    evidencePath: "Test Evidence",
    documentationPath: "Test Hub",
    testRunnerPath: ".testrunner",
  },
  runner: {
    packageManager: "npm",
    nodeExecutable: "node",
    installCommand: "npm install",
    ciInstallCommand: "npm ci",
    browserInstallCommand: "npx playwright install chromium",
    defaultRunCommand: "npm run test",
    smokeRunCommand: "npm run test:smoke",
    ciRunCommand: "npm run test:ci",
  },
  automation: {
    autoCreateFolders: true,
    autoCreateDocumentation: true,
    autoCreateDemoContent: true,
    updateUseCaseFrontmatterAfterRun: true,
    generateEvidenceMarkdown: true,
    openDashboardAfterInitialization: true,
  },
  ci: {
    provider: "github-actions",
    workflowPath: ".github/workflows/e2e.yml",
    nodeVersion: "22",
  },
  sut: {
    active: "demo",                        // bootstraps to the local file:// fixture
    environments: {
      demo: { baseUrl: "file://./.testrunner/src/fixtures/example.html" },
    },
  },
  logging: {
    enabled: true,
    path: "Test Hub/logs",
    level: "info",
  },
};
```

### 5.9 SettingsService

```ts
export interface SettingsService {
  load(): Promise<TestHubSettings>;
  save(settings: TestHubSettings): Promise<Result<void>>;
  reset(): Promise<Result<TestHubSettings>>;
  validate(settings: TestHubSettings): Promise<SettingsValidationResult>;
}

export interface SettingsValidationResult {
  valid: boolean;
  errors: SettingsValidationMessage[];
  warnings: SettingsValidationMessage[];
}

export interface SettingsValidationMessage {
  field: string;
  message: string;
  severity: "error" | "warning";
}
```

---

## 6. Domain Entities

### 6.1 UseCase

```ts
export interface UseCase {
  id: UseCaseId;
  title: string;
  description?: string;                    // standardized name per G6
  status: UseCaseStatus;                   // business lifecycle
  automationStatus: AutomationStatus;      // test state
  prdId?: PrdId;                           // parent PRD (ADR-0026); required once backfilled
  featureFiles: VaultPath[];               // 0..N per ADR-0012; empty = not automated
  suites: SuiteId[];
  evidence: VaultPath[];
  lastTestRun?: TestRunSummary;
  path: VaultPath;
}
```

### 6.2 UseCaseStatus (business lifecycle)

```ts
export type UseCaseStatus =
  | "draft"
  | "specified"
  | "ready-for-automation"
  | "automated"
  | "verified"
  | "deprecated";
```

### 6.3 AutomationStatus (test state)

```ts
export type AutomationStatus =
  | "not-planned"
  | "planned"
  | "missing-steps"
  | "implemented"
  | "passing"
  | "failing";
```

### 6.4 FeatureSpecification

```ts
export interface FeatureSpecification {
  path: VaultPath;
  useCaseId: UseCaseId;                    // required per ADR-0012; orphan features are a validation error
  featureName: string;
  tags: string[];
  scenarios: ScenarioSpecification[];
}
```

### 6.5 ScenarioSpecification

```ts
export interface ScenarioSpecification {
  name: string;
  tags: string[];
  steps: GherkinStep[];
}
```

### 6.6 GherkinStep

```ts
export interface GherkinStep {
  keyword: "Given" | "When" | "Then" | "And" | "But" | "*";
  text: string;
}
```

### 6.7 TestSuite

```ts
export interface TestSuite {
  id: SuiteId;
  name: string;
  description?: string;
  tagExpression: string;                   // tag expression per AD-4 (playwright-bdd), e.g. "@smoke and not @wip"
  path: VaultPath;
}
```

### 6.8 TestRun

```ts
export interface TestRun {
  id: RunId;
  scope: ExecutionScope;
  target: string;                          // id or path of the scoped entity
  status: TestRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  command: string;
  workingDirectory: VaultPath;
  result?: TestRunResult;
  reportPaths: ReportPaths;
}
```

### 6.9 ExecutionScope

```ts
export type ExecutionScope =
  | "use-case"
  | "feature"
  | "suite"
  | "all"
  | "demo";
```

### 6.10 TestRunStatus

```ts
export type TestRunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "errored"                              // per EN-2: never reached normal completion
  | "cancelled";
```

Terminal-event invariant: exactly one terminal status per run (see [Event Catalog §7](./Event%20Catalog.md) and Runtime View RV-5).

### 6.11 TestRunResult

```ts
export interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}
```

### 6.12 TestRunSummary

```ts
export interface TestRunSummary {
  runId: RunId;
  status: TestRunStatus;
  date: string;
  evidencePath?: VaultPath;
}
```

### 6.13 ReportPaths

```ts
export interface ReportPaths {
  json?: VaultPath;                        // .testrunner/reports/cucumber-report.json
  html?: VaultPath;                        // .testrunner/reports/html/index.html
  markdown?: VaultPath;                    // Test Evidence/.../summary.md
  screenshots?: VaultPath[];
  traces?: VaultPath[];
}
```

### 6.14 Evidence

```ts
export interface Evidence {
  id: EvidenceId;
  runId: RunId;
  path: VaultPath;                         // the Markdown evidence note
  linkedUseCases: UseCaseId[];
  result: TestRunResult;
  createdAt: string;
  artifacts: EvidenceArtifact[];           // references, not copies
}
```

### 6.15 EvidenceArtifact

```ts
export interface EvidenceArtifact {
  type: "report" | "screenshot" | "trace" | "log";
  path: VaultPath;                         // VaultPath into .testrunner/reports — link, do not duplicate
  label?: string;
}
```

### 6.16 Prd (ADR-0026)

```ts
export type PrdStatus = "draft" | "active" | "deprecated";

// Read model for a PRD note — the synthesis layer between research Domains and
// Use Cases. PRDs form a single-parent tree; PRD-000 is the root product vision.
export interface Prd {
  id: PrdId;                               // "PRD-NNN"; "PRD-000" is the root
  title: string;
  status: PrdStatus;
  parentPrdId?: PrdId;                     // undefined for the root PRD
  domains: string[];                       // research domains this PRD synthesizes from
  vision: string;
  scopeIn: string[];
  scopeOut: string[];
  displayOrder: number;                    // sibling ordering, separate from the immutable id
  path: VaultPath;                         // <prdsPath>/<id>-<slug>/<id>-<slug>.md
}
```

---

## 7. Repository Contracts

Repositories live in `domain/repositories/` (interfaces) with adapters in `infrastructure/`.

```ts
export interface UseCaseRepository {
  create(useCase: UseCase): Promise<Result<void>>;
  update(useCase: UseCase): Promise<Result<void>>;
  delete(id: UseCaseId): Promise<Result<void>>;
  findById(id: UseCaseId): Promise<Result<UseCase | null>>;
  findAll(): Promise<Result<UseCase[]>>;
}

export interface SpecificationRepository {
  create(specification: FeatureSpecification): Promise<Result<void>>;
  update(specification: FeatureSpecification): Promise<Result<void>>;
  findByPath(path: VaultPath): Promise<Result<FeatureSpecification | null>>;
  findAll(): Promise<Result<FeatureSpecification[]>>;
}

export interface SuiteRepository {
  create(suite: TestSuite): Promise<Result<void>>;
  update(suite: TestSuite): Promise<Result<void>>;
  delete(id: SuiteId): Promise<Result<void>>;
  findById(id: SuiteId): Promise<Result<TestSuite | null>>;
  findAll(): Promise<Result<TestSuite[]>>;
}

export interface EvidenceRepository {
  create(evidence: Evidence): Promise<Result<void>>;
  findByRunId(runId: RunId): Promise<Result<Evidence | null>>;
  findByUseCaseId(useCaseId: UseCaseId): Promise<Result<Evidence[]>>;
}

export interface TestRunRepository {
  create(run: TestRun): Promise<Result<void>>;
  update(run: TestRun): Promise<Result<void>>;
  findById(runId: RunId): Promise<Result<TestRun | null>>;
  findLatest(limit: number): Promise<Result<TestRun[]>>;
}
```

---

## 8. Application Service Contracts

### 8.1 InitializationService

```ts
export interface InitializationService {
  initialize(request: InitializeTestHubRequest): Promise<Result<InitializeTestHubResult>>;
}

export interface InitializeTestHubRequest {
  settings: TestHubSettings;
  installDependencies: boolean;
  installBrowsers: boolean;
  generateDemoContent: boolean;
  generateDocumentation: boolean;
}

export interface InitializeTestHubResult {
  createdFolders: VaultPath[];
  createdFiles: VaultPath[];
  defaultSuitesCreated: SuiteId[];         // per G1
  runnerInstalled: boolean;
  documentationGenerated: boolean;
  demoGenerated: boolean;
}
```

### 8.2 RunnerInstallationService

```ts
export interface RunnerInstallationService {
  createRunner(settings: TestHubSettings): Promise<Result<RunnerInstallationResult>>;
  installDependencies(settings: TestHubSettings): Promise<Result<RunnerCommandResult>>;
  installBrowsers(settings: TestHubSettings): Promise<Result<RunnerCommandResult>>;
}

export interface RunnerInstallationResult {
  runnerPath: VaultPath;
  createdFiles: VaultPath[];
}
```

Validation is **not** on this service; it lives on `EnvironmentValidationService` (§8.3).

### 8.3 EnvironmentValidationService

```ts
export interface EnvironmentValidationService {
  validateEnvironment(): Promise<RunnerValidationResult>;          // UC-002
  validateCiReadiness(settings: TestHubSettings): Promise<CiReadinessResult>; // UC-020
}

export interface RunnerValidationResult {
  valid: boolean;
  nodeAvailable: boolean;
  packageManagerAvailable: boolean;
  runnerFolderExists: boolean;
  packageJsonExists: boolean;
  dependenciesInstalled: boolean;
  browsersInstalled: boolean;              // Chromium per AD-5
  issues: RunnerValidationIssue[];
}

export interface RunnerValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface CiReadinessResult {
  ready: boolean;
  missingItems: string[];
  warnings: string[];
}
```

### 8.4 MaintenanceService

```ts
export interface MaintenanceService {
  repair(): Promise<Result<RepairResult>>;                         // UC-003
  reset(confirm: ResetConfirmation): Promise<Result<void>>;        // UC-024
  sweepEvidence(confirm?: SweepConfirmation): Promise<Result<SweepResult>>; // SDD AD-11
}

export interface RepairResult {
  repairedFiles: VaultPath[];
  reinstalledPackages: boolean;
  reinstalledBrowsers: boolean;
}

export interface ResetConfirmation {
  confirmed: true;                         // typed proof that the user confirmed
  profile: "default";
}

export interface SweepConfirmation {
  confirmed: true;                         // required on the first sweep after enabling retention
}

export interface SweepResult {
  deletedPaths: VaultPath[];               // evidence folders removed
  updatedUseCases: UseCaseId[];            // UCs whose evidence[] was pruned
}
```

### 8.5 DocumentationGenerationService

```ts
export interface DocumentationGenerationService {
  generate(): Promise<Result<GeneratedDocumentation>>;
}

export interface GeneratedDocumentation {
  documents: VaultPath[];                  // Getting Started, User Manual, Troubleshooting (per G5)
}
```

### 8.6 UseCaseService

```ts
export interface UseCaseService {
  create(request: CreateUseCaseRequest): Promise<Result<UseCase>>;
  update(useCase: UseCase): Promise<Result<void>>;
  findAll(): Promise<Result<UseCase[]>>;
  linkFeature(useCaseId: UseCaseId, featurePath: VaultPath): Promise<Result<void>>;
  linkEvidence(useCaseId: UseCaseId, evidencePath: VaultPath): Promise<Result<void>>;
  // ADR-0026 — write the parent PRD link (validated against the live PRD index
  // and serialized with PRD create/delete through the shared mutation lock).
  assignToPrd(id: UseCaseId, prdId: PrdId): Promise<Result<UseCase>>;
  listDomains(): Promise<Result<{ domain: string; count: number }[]>>;
  countUseCasesByPrd(): Promise<Result<Map<string, number>>>;
}

export interface CreateUseCaseRequest {
  title: string;
  description?: string;
  suites?: SuiteId[];
}
```

### 8.7 SpecificationService

```ts
export interface SpecificationService {
  createFromUseCase(useCaseId: UseCaseId): Promise<Result<FeatureSpecification>>;
  update(specification: FeatureSpecification): Promise<Result<void>>;
  validate(featurePath: VaultPath): Promise<Result<SpecificationValidationResult>>;
  detectMissingSteps(featurePath: VaultPath): Promise<Result<MissingStepResult>>;
}

export interface SpecificationValidationResult {
  valid: boolean;
  errors: SpecificationValidationError[];
}

export interface SpecificationValidationError {
  line?: number;
  message: string;
}

export interface MissingStepResult {
  featurePath: VaultPath;
  missingSteps: string[];
}
```

### 8.8 SuiteService

```ts
export interface SuiteService {
  create(request: CreateSuiteRequest): Promise<Result<TestSuite>>;
  createDefaults(): Promise<Result<TestSuite[]>>;                  // Smoke + Regression per G1
  findAll(): Promise<Result<TestSuite[]>>;
  resolveTagExpression(suiteId: SuiteId): Promise<Result<string>>; // per AD-4
}

export interface CreateSuiteRequest {
  name: string;
  description?: string;
  tagExpression: string;
}
```

### 8.9 StepDefinitionService

```ts
export interface StepDefinitionService {
  generate(featurePath: VaultPath, missingSteps: string[]): Promise<Result<StepGenerationResult>>;
}

export interface StepGenerationResult {
  stepFile: VaultPath;                     // .testrunner/src/steps/*.ts
  generatedSteps: string[];
}
```

### 8.10 TestExecutionService

```ts
export interface TestExecutionService {
  execute(request: ExecuteTestRequest): Promise<Result<TestRun>>;
  cancel(runId: RunId): Promise<Result<void>>;
}

export interface ExecuteTestRequest {
  scope: ExecutionScope;
  target: string;
}
```

Implementation invariants:

- EN-2 terminal-event invariant: exactly one of `testrun.completed` / `testrun.failed` / `testrun.cancelled` per run.
- ADR-0018 single-active invariant: `execute()` returns `Result.failure({ code: "RUN_IN_PROGRESS", details: { activeRunId } })` when invoked while another run is active. Caller must `cancel(activeRunId)` and await `testrun.cancelled` before retrying.

### 8.11 ReportImportService

```ts
export interface ReportImportService {
  import(run: TestRun): Promise<Result<ImportedReport>>;
}

export interface ImportedReport {
  runId: RunId;
  result: TestRunResult;
  scenarioResults: ScenarioResult[];
  artifacts: EvidenceArtifact[];
}

export interface ScenarioResult {
  feature: string;
  scenario: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  errorMessage?: string;
}
```

### 8.12 EvidenceGenerationService

```ts
export interface EvidenceGenerationService {
  generate(request: GenerateEvidenceRequest): Promise<Result<Evidence>>;
}

export interface GenerateEvidenceRequest {
  run: TestRun;
  report: ImportedReport;
}
```

### 8.13 PipelineGenerationService

```ts
export interface PipelineGenerationService {
  generate(request: GeneratePipelineRequest): Promise<Result<GeneratedPipeline>>;
}

export interface GeneratePipelineRequest {
  provider: CiProvider;
  settings: TestHubSettings;
  overwriteExisting?: boolean;             // default false (OQ-005 default)
}

export interface GeneratedPipeline {
  provider: CiProvider;
  path: string;                            // repo-root absolute or relative; not a VaultPath
}
```

### 8.14 TraceabilityService

```ts
export interface TraceabilityService {
  refreshDashboard(): Promise<Result<DashboardSnapshot>>;
  linksFor(useCaseId: UseCaseId): Promise<Result<TraceabilityRecord>>;
  // Suite-membership index (per SDD AD-10):
  refreshMembership(changedFeaturePath?: VaultPath): Promise<Result<void>>;
  scenarioCountFor(suiteId: SuiteId): number;
  suitesFor(scenario: ScenarioReference): SuiteId[];
}

export interface DashboardSnapshot {
  totalUseCases: number;
  specifiedUseCases: number;
  automatedUseCases: number;
  passingUseCases: number;
  failingUseCases: number;
  recentRuns: TestRunSummary[];
}

export interface TraceabilityRecord {
  useCaseId: UseCaseId;
  featurePath?: VaultPath;
  suites: SuiteId[];
  runs: RunId[];
  evidence: EvidenceId[];
}
```

### 8.15 PrdService (ADR-0026)

```ts
export interface PrdService {
  create(request: CreatePrdRequest): Promise<Result<Prd>>;
  findAll(): Promise<Result<Prd[]>>;
  findById(id: PrdId): Promise<Result<Prd | null>>;
  deletePrd(id: PrdId): Promise<Result<DeletePrdResult>>;
  // The PRD note-write critical section (key "prd:mutate"). UseCaseService.assignToPrd
  // enters the SAME section, serializing link writes against create/delete.
  withMutationLock<T>(operation: () => Promise<T>): Promise<T>;
}

export interface CreatePrdRequest {
  title: string;
  parentPrdId?: PrdId;                     // omit/empty → root (PRD-000) on first PRD
  domains: string[];
  vision: string;
  scopeIn: string[];
  scopeOut: string[];
  research?: string;
}

export interface DeletePrdResult {
  prdId: PrdId;
  preservedFiles: number;                  // sibling attachments left in the PRD folder
}
```

---

## 9. Infrastructure Port Contracts

### 9.1 VaultFileSystem

```ts
export interface VaultFileSystem {
  exists(path: VaultPath): Promise<boolean>;
  createFolder(path: VaultPath): Promise<Result<void>>;
  createFile(path: VaultPath, content: string): Promise<Result<void>>;
  readFile(path: VaultPath): Promise<Result<string>>;
  writeFile(path: VaultPath, content: string): Promise<Result<void>>;
  listFiles(path: VaultPath): Promise<Result<VaultPath[]>>;
}
```

### 9.2 WorkspacePort

```ts
export interface WorkspacePort {
  openFile(path: VaultPath): Promise<Result<void>>;
  openView(viewType: string): Promise<Result<void>>;
  revealInExplorer(path: VaultPath): Promise<Result<void>>;
}
```

### 9.3 FrontmatterPort

```ts
export interface FrontmatterPort {
  read(path: VaultPath): Promise<Result<Record<string, unknown>>>;
  update(path: VaultPath, values: Record<string, unknown>): Promise<Result<void>>;
}
```

### 9.4 AbsoluteFileSystem

For paths that may live outside the Obsidian vault index (`.testrunner` internals during process spawn, `.github/workflows/` for CI).

```ts
export interface AbsoluteFileSystem {
  getVaultBasePath(): Promise<Result<string>>;
  existsAbsolute(path: string): Promise<boolean>;
  writeAbsolute(path: string, content: string): Promise<Result<void>>;
}
```

### 9.5 ChildProcessRunner

```ts
export interface ChildProcessRunner {
  run(request: RunCommandRequest): Promise<Result<RunnerCommandResult>>;
  runStreaming(
    request: RunCommandRequest,
    onOutput: (output: RunnerOutput) => void,
  ): Promise<Result<RunnerCommandResult>>;
  cancel(processId: string): Promise<Result<void>>;
}

export interface RunCommandRequest {
  command: string;
  cwd: string;                             // absolute path, must end in /.testrunner per RunnerExecutionPolicy
  env?: Record<string, string>;
}

export interface RunnerOutput {
  stream: "stdout" | "stderr";
  line: string;
  timestamp: string;
}

export interface RunnerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

### 9.6 TemplateWriter

```ts
export interface TemplateWriter {
  writeTemplates(request: TemplateWriteRequest): Promise<Result<TemplateWriteResult>>;
}

export interface TemplateWriteRequest {
  targetPath: VaultPath;
  templates: TemplateFile[];
}

export interface TemplateFile {
  path: VaultPath;
  content: string;
  overwrite: boolean;
}

export interface TemplateWriteResult {
  writtenFiles: VaultPath[];
  skippedFiles: VaultPath[];
}
```

### 9.7 ReportFileWatcher — _not built (removed)_

The originally-planned `ReportFileWatcher` (which would have emitted `report.detected`) was **never built and is removed**. The post-run import is driven **in-process** by the application-layer `PostRunCoordinator`, which subscribes to the EN-2 terminal run events (`testrun.completed`/`failed`/`cancelled`) and reads the runner's report files after the run ends. See Building Block View §5.11a, Runtime View RV-6, and Event Catalog §8.

### 9.7.1 FeatureFileWatcher (per SDD AD-10)

```ts
export interface FeatureFileWatcher {
  start(featureFilesPath: VaultPath): Promise<Result<void>>;
  stop(): Promise<void>;
  // Subscribes to vault.on('modify' | 'create' | 'rename' | 'delete') for *.feature.
  // Hands each event to TraceabilityService.refreshMembership(path);
  // does NOT emit a public event per file change.
}
```

### 9.8 LogSinkPort (per ADR-0019)

```ts
export interface LogSinkPort {
  init(settings: LoggingSettings): Promise<Result<void>>;
  write(line: string): Promise<void>;      // line is already redacted by Logger
  rotate(today: string): Promise<void>;    // ensures plugin-<YYYY-MM-DD>.log is the active target
  close(): Promise<void>;
}
```

The plugin-side `Logger` (Shared Kernel) builds a redacted, structured log line, then hands it to whichever `LogSinkPort` implementations are wired in. Default wiring is `ConsoleSink` + `VaultFileSink` (the latter respects `LoggingSettings.enabled`).

### 9.8 ReportParser

```ts
export interface ReportParser {
  // Pure (no I/O): parses a runner report's raw text into a ParsedReport. The
  // first implementation parses cucumber-JSON (ADR-0021 — the report FORMAT is
  // unchanged); a Cucumber Messages parser (ADR-0022) slots in beside it.
  parse(rawContent: string, ctx: ReportParseContext): Result<ParsedReport>;
}

export interface ParsedReport {
  result: TestRunResult;
  scenarioResults: ScenarioResult[];
  artifacts: EvidenceArtifact[];
}
```

---

## 10. Frontmatter Schemas

YAML examples; field names use snake_case for Obsidian-idiomatic frontmatter.

### 10.1 Use Case

```yaml
type: use-case
id: UC-001
title: Open Example Page
status: specified
automation_status: passing
description: A new user verifies that the Test Hub demo runs end-to-end.
feature_file: Specifications/features/UC-001-open-example-page.feature
suites:
  - smoke
  - regression
last_test_status: passed
last_test_run: 2026-06-01T10:00:00Z
last_evidence: Test Evidence/runs/2026-06-01-1000/summary.md
```

### 10.2 Test Suite

```yaml
type: test-suite
id: smoke
title: Smoke Suite
description: Critical-path tests.
tag_expression: "@smoke"
```

### 10.3 Evidence

```yaml
type: test-evidence
id: EV-20260601-1000
run_id: RUN-20260601-1000
status: passed
created_at: 2026-06-01T10:00:00Z
linked_use_cases:
  - UC-001
report_json: .testrunner/reports/runs/2026-06-01-1000/cucumber-report.json
report_html: .testrunner/reports/runs/2026-06-01-1000/html/index.html
screenshots: []
traces: []
```

### 10.4 Dashboard

```yaml
type: test-hub-dashboard
generated_by: obsidian-e2e-test-hub
updated_at: 2026-06-01T10:00:00Z
```

---

## 11. Runner File Templates (`.testrunner/`)

Templates honour AD-2 (npm), AD-5 (Chromium), and AD-8 (local static HTML fixture). The runner is a **Playwright + playwright-bdd** project: `bddgen` generates Playwright tests from the `.feature` files, then `playwright test` runs them — the entry point is `playwright.config.ts`. (ADR-0021 superseded AD-7's `tsx`/`cucumber.mjs` setup; TypeScript now runs natively under the Playwright Test runner.)

### 11.1 `package.json`

```json
{
  "name": "obsidian-e2e-test-runner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bddgen && playwright test --pass-with-no-tests",
    "test:smoke": "bddgen && playwright test --grep @smoke --pass-with-no-tests",
    "test:ci": "bddgen && playwright test --pass-with-no-tests",
    "install:browsers": "playwright install chromium",
    "install:browsers:ci": "playwright install --with-deps chromium"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@types/node": "^22.0.0",
    "playwright": "^1.60.0",
    "playwright-bdd": "^9.0.0",
    "typescript": "^5.6.0"
  }
}
```

### 11.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`Preserve`/`Bundler` (not `NodeNext`): playwright-bdd resolves extensionless relative imports like a bundler, so `NodeNext` flagged every generated relative import as needing an explicit `.js` extension even though the suite ran fine.

### 11.3 `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";
import { defineBddConfig, cucumberReporter } from "playwright-bdd";

const testDir = defineBddConfig({
  // BDD_FEATURES (newline-separated, runner-relative paths) scopes generation
  // for feature/use-case/all runs; unset → the full glob (§13.2).
  features: process.env.BDD_FEATURES
    ? process.env.BDD_FEATURES.split("\n")
    : "../Specifications/features/**/*.feature",
  // playwright-bdd requires every feature under featuresRoot; features live in
  // the vault, OUTSIDE the runner, so point it at the configured feature folder.
  featuresRoot: "../Specifications/features",
  steps: "src/steps/**/*.ts",
  // BDD_TAGS conveys a suite's tag expression; bddgen applies the FULL tag
  // expression at generation (§13.2). Undefined runs everything.
  tags: process.env.BDD_TAGS || undefined,
});

export default defineConfig({
  testDir,
  reporter: [
    ["list"],
    cucumberReporter("json", {
      outputFile: "reports/cucumber-report.json",
      skipAttachments: false, // default true drops all embeddings (ADR-0016)
    }),
  ],
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

`bddgen` reads this config to generate Playwright tests from the `.feature` files; `playwright test` then runs them. The run report stays **cucumber-JSON** (`cucumberReporter("json")` → `reports/cucumber-report.json`), so the report format — and the `CucumberJsonReportParser` that reads it (§9.8) — is unchanged from V1; `skipAttachments: false` preserves failure-screenshot embeddings (ADR-0016). There is no Cucumber `World` or `hooks.ts`: per-scenario browser lifecycle is the Playwright `{ page }` fixture playwright-bdd injects into each step (§11.7).

### 11.4 `src/support/paths.ts`

```ts
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const runnerRoot = resolve(here, "..", "..");

// pathToFileURL produces a valid, URL-encoded file:// URL on every platform
// (Windows drive letters, spaces) — string-prefixing does not.
export const fixtureUrl = (file: string): string =>
  pathToFileURL(resolve(runnerRoot, "src", "fixtures", file)).href;
```

### 11.5 `src/fixtures/example.html` (per AD-8)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Specorator Testrunner — Demo</title>
  </head>
  <body>
    <h1>Specorator Testrunner Demo</h1>
    <button id="continue">Continue</button>
    <div id="result"></div>
    <script>
      document.getElementById("continue").addEventListener("click", () => {
        document.getElementById("result").textContent = "Test completed";
      });
    </script>
  </body>
</html>
```

### 11.6 `src/pages/ExamplePage.ts`

```ts
import type { Page } from "@playwright/test";
import { fixtureUrl } from "../support/paths";

export class ExamplePage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(fixtureUrl("example.html"));
  }

  async continue(): Promise<void> {
    await this.page.click("#continue");
  }

  async resultText(): Promise<string | null> {
    return this.page.textContent("#result");
  }
}
```

### 11.7 `src/steps/example.steps.ts`

```ts
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { ExamplePage } from "../pages/ExamplePage";

const { Given, When, Then } = createBdd();

Given("I open the local example page", async ({ page }) => {
  await new ExamplePage(page).open();
});

When("I click the {string} button", async ({ page }, label: string) => {
  if (label !== "Continue") throw new Error(`Unknown button: ${label}`);
  await new ExamplePage(page).continue();
});

Then("I should see {string}", async ({ page }, expected: string) => {
  await expect(page.locator("#result")).toHaveText(expected);
});
```

### 11.8 Demo feature — `Specifications/features/UC-001-open-example-page.feature`

```gherkin
@demo @smoke
Feature: Open Example Page
  As a new user
  I want to run a working demo test
  So that I can verify the Test Hub installation

  Scenario: Complete the local demo page
    Given I open the local example page
    When I click the "Continue" button
    Then I should see "Test completed"
```

Playwright is driven by the **Playwright Test runner via playwright-bdd**: `bddgen` generates the tests from this feature and `playwright.config.ts` (§11.3) is the entry point. There is no Cucumber `World` or `hooks.ts` — each step receives Playwright's `{ page }` fixture directly (§11.7).

---

## 12. CI Template Contract

### 12.1 GitHub Actions Workflow

Path: `.github/workflows/e2e.yml` (per AD-3).

```yaml
name: E2E Tests
on:
  pull_request:
  push:
    branches:
      - main
jobs:
  e2e:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: .testrunner
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: .testrunner/package-lock.json
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright browsers
        run: npm run install:browsers:ci
      - name: Run tests
        run: npm run test:ci
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-reports
          path: .testrunner/reports
```

Pre-write checks (per OQ-005 default): refuse to overwrite an existing workflow unless `GeneratePipelineRequest.overwriteExisting === true`.

---

## 13. Command Contracts

### 13.1 RunnerCommandBuilder

```ts
export interface RunnerCommandBuilder {
  build(
    request: ExecuteTestRequest,
    settings: TestHubSettings,
  ): Result<RunCommandRequest>;
}
```

### 13.2 Command Mapping

| Scope | Resolved command | Scope env |
| --- | --- | --- |
| `demo` | `npm run test:smoke` | `BDD_TAGS=@smoke` |
| `suite` | `npm run test` | `BDD_TAGS=<tagExpression>` |
| `feature` | `npm run test` | `BDD_FEATURES=<feature path>` |
| `use-case` | `npm run test` | `BDD_FEATURES=<UC feature paths>` |
| `all` | `npm run test` | — (cleared; `BDD_FEATURES` = non-deprecated UCs when any UC is deprecated, per ADR-0012) |
| `ci` | `npm run test:ci` | — |

Scope is conveyed through the **environment**, not CLI args: the generated `playwright.config.ts` (`defineBddConfig`, §11.3) reads `BDD_TAGS` (suite/demo tag expression) and `BDD_FEATURES` (feature/use-case/all newline-separated paths) so `bddgen` generates only the targeted scenarios. The base command is otherwise unchanged, and a scoped run never fails because some other unrelated/malformed feature elsewhere in the vault doesn't parse.

`cwd` is always the runner path resolved from `settings.paths.testRunnerPath` plus the vault base path (`AbsoluteFileSystem.getVaultBasePath()`).

`env` is built from the **Active Environment** per ADR-0013 / ADR-0014:

```
{
  BASE_URL: <active env baseUrl>,
  ...<active env auth.env>,                // E2E_USERNAME, E2E_PASSWORD, or whatever the user named
}
```

The demo Environment (`active: "demo"`) injects only `BASE_URL` pointing at the `file://` fixture; no auth keys.

---

## 13.3 Logger (Shared Kernel, per ADR-0019)

```ts
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, error?: Error | AppError, fields?: Record<string, unknown>): void;
}
```

The Logger redacts sensitive fields before serialising:

- Field keys matching `/pass|secret|token|key|auth|credential/i` are replaced with `"***"`.
- Values matching any entry in the Active Environment's `SutAuth.env` map are replaced with `"***"`.

Redaction is enforced inside the Logger; call sites cannot bypass it without dropping to raw `console.*`. Field name `runId` is a convention so log filtering by run is trivial.

## 14. Domain Policies

### 14.1 PathSafetyPolicy

```ts
export interface PathSafetyPolicy {
  validate(path: VaultPath): Result<void>;
}
```

Rules:

- Path must not be absolute.
- Path must not contain `..`.
- Path must not be empty.
- Path must not overwrite existing user content unless explicitly confirmed.

### 14.2 RunnerExecutionPolicy

```ts
export interface RunnerExecutionPolicy {
  canExecute(command: RunCommandRequest): Result<void>;
}
```

Rules:

- `cwd` must resolve under `settings.paths.testRunnerPath`.
- Command must match the allowlist in §13.2 (no arbitrary user-supplied commands in V1 — OQ-004 default).
- Command must not contain shell metacharacters that imply destructive operations (`rm`, `&&`, `;`, redirects, etc.).

### 14.3 UseCaseAutomationPolicy (per ADR-0017)

```ts
export interface UseCaseAutomationPolicy {
  rollUp(useCase: UseCase, features: FeatureSpecification[], runs: TestRun[]): AutomationStatus;
}
```

Inputs are pure values (no I/O). The policy excludes Features tagged `@wip` and returns one of the six `AutomationStatus` values per the table in ADR-0017. `TraceabilityService.refreshDashboard()` calls this policy once per UC when computing KPI counts.

---

## 15. Testing Strategy

| Layer | Required tests |
| --- | --- |
| Unit | `SettingsService`, `PathSafetyPolicy`, `RunnerCommandBuilder`, `RunnerExecutionPolicy`, `UseCaseService`, `SpecificationService`, `SuiteService`, `EvidenceGenerationService`, `PipelineGenerationService`, `TraceabilityService`. |
| Integration | `InitializationService`, `RunnerInstallationService`, `ReportImportService` (against fixture JSON), `EnvironmentValidationService`. |
| E2E (happy path) | Fresh vault → initialize Test Hub → execute demo test → generate evidence — backed by AC-001…AC-018 in the PRD. |

NFR-002 target: Vitest coverage ≥ 80%.

---

## 16. Implementation-Readiness Checklist

- [x] Settings interfaces defined
- [x] Domain entities defined
- [x] EventBus contract defined
- [x] Repository contracts defined
- [x] Application services defined
- [x] Infrastructure ports defined
- [x] Frontmatter schemas defined
- [x] Runner templates defined
- [x] CI template defined
- [x] Validation policies defined
- [x] Testing contracts defined

---

## 17. Open design questions — resolved

| ID | Question | Resolution (V1) |
| --- | --- | --- |
| OQ-001 | Should `.testrunner` be hidden in the Obsidian file explorer? | **Obsidian default behavior** — dotfolders are hidden. No plugin action required. |
| OQ-002 | Should test reports be duplicated into Test Evidence or linked? | **Link only.** Evidence notes hold relative paths into `.testrunner/reports`. Avoids vault bloat. |
| OQ-003 | Should the plugin support `pnpm` in V1? | **No** — deferred to V2 per AD-2. |
| OQ-004 | Should the plugin allow arbitrary custom runner commands in V1? | **No** — `RunnerExecutionPolicy` enforces the §13.2 allowlist. |
| OQ-005 | Should CI pipeline generation overwrite existing workflows? | **No** — never without explicit `overwriteExisting=true` (§8.13). |

---

## 18. Acceptance for this specification

The TIS is complete when:

- All modules have stable contracts.
- All contracts can be tested independently.
- All runner templates support standalone execution (local + CI).
- All Markdown artifacts have schemas.
- The generated CI pipeline runs without Obsidian.
- The implementation team can start with minimal ambiguity.

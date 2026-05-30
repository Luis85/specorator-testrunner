# Technical Interface Specification — Obsidian E2E Test Hub

> Concrete TypeScript contracts for V1: shared types, domain entities, repositories, application services, infrastructure ports, frontmatter schemas, runner templates, CI templates, and validation policies. Implementation-ready.

- **Version:** 1.0
- **Status:** Draft
- **Stage:** Solution Design / Implementation Preparation
- **Type:** Technical Contract Document
- **Companion documents:** [Obsidian E2E Test Hub PRD](../Obsidian%20E2E%20Test%20Hub.md), [Solution Design](./Solution%20Design.md), [Building Block View](./Building%20Block%20View.md), [Runtime View](./Runtime%20View.md), [Event Catalog](./Event%20Catalog.md), [Use Cases V1](../use-cases/V1.md)

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

The domain layer must not depend on Obsidian APIs, Node `fs`, Playwright, Cucumber, child processes, or DOM APIs.

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
  code: string;                            // stable machine-readable code
  message: string;                         // human-readable message
  details?: Record<string, unknown>;
  cause?: unknown;
}
```

### 3.3 Identifiers

```ts
export type Id = string;
export type UseCaseId = string;            // e.g. "UC-001"
export type SuiteId = string;              // e.g. "smoke"
export type RunId = string;                // e.g. "RUN-2026-06-01-100000"
export type EvidenceId = string;           // e.g. "EV-2026-06-01-100000"
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
  // report
  | "report.detected"
  | "report.imported"
  | "report.import.failed"
  // evidence
  | "evidence.generated"
  | "evidence.linkedToUseCase"
  | "evidence.reviewed"
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
}
```

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
  tagExpression: string;                   // Cucumber tag expression per AD-4 (e.g. "@smoke and not @wip")
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

Implementation enforces the EN-2 terminal-event invariant: exactly one of `testrun.completed` / `testrun.failed` / `testrun.cancelled` per run.

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

### 9.7 ReportFileWatcher

```ts
export interface ReportFileWatcher {
  start(runnerPath: VaultPath): Promise<Result<void>>;
  stop(): Promise<void>;
  // emits `report.detected` events through the EventBus.
}
```

### 9.8 ReportParser

```ts
export interface ReportParser {
  parseCucumberJson(path: VaultPath): Promise<Result<ParsedCucumberReport>>;
}

export interface ParsedCucumberReport {
  scenarios: ScenarioResult[];
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

Templates honour AD-2 (npm), AD-5 (Chromium), AD-6 (serial), AD-7 (`cucumber.mjs` with `tsx` loader), AD-8 (local static HTML fixture).

### 11.1 `package.json`

```json
{
  "name": "obsidian-e2e-test-runner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "cucumber-js --config cucumber.mjs",
    "test:smoke": "cucumber-js --config cucumber.mjs --tags @smoke",
    "test:ci": "cucumber-js --config cucumber.mjs --format json:reports/cucumber-report.json",
    "install:browsers": "playwright install chromium",
    "install:browsers:ci": "playwright install --with-deps chromium"
  },
  "devDependencies": {
    "@cucumber/cucumber": "^11.0.0",
    "playwright": "^1.49.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

### 11.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

### 11.3 `cucumber.mjs`

```js
export default {
  default: {
    loader: ["tsx"],
    import: ["src/support/**/*.ts", "src/steps/**/*.ts"],
    paths: ["../Specifications/features/**/*.feature"],
    format: [
      "progress",
      "json:reports/cucumber-report.json",
    ],
    publishQuiet: true,
    parallel: 0,
  },
};
```

`parallel: 0` enforces AD-6 (serial execution) in V1.

### 11.4 `src/support/world.ts`

```ts
import { World, setWorldConstructor } from "@cucumber/cucumber";
import { Browser, BrowserContext, Page, chromium } from "playwright";

export class TestWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;

  async openBrowser(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  async closeBrowser(): Promise<void> {
    await this.page?.close();
    await this.context?.close();
    await this.browser?.close();
  }
}

setWorldConstructor(TestWorld);
```

### 11.5 `src/support/hooks.ts`

```ts
import { After, Before } from "@cucumber/cucumber";
import { TestWorld } from "./world";

Before(async function (this: TestWorld) {
  await this.openBrowser();
});

After(async function (this: TestWorld) {
  await this.closeBrowser();
});
```

### 11.6 `src/support/paths.ts`

```ts
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const runnerRoot = resolve(here, "..", "..");

export const fixtureUrl = (file: string): string =>
  `file://${resolve(runnerRoot, "src", "fixtures", file)}`;
```

### 11.7 `src/fixtures/example.html` (per AD-8)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Obsidian E2E Test Hub — Demo</title>
  </head>
  <body>
    <h1>Obsidian E2E Test Hub Demo</h1>
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

### 11.8 `src/pages/ExamplePage.ts`

```ts
import { Page } from "playwright";
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

### 11.9 `src/steps/example.steps.ts`

```ts
import { Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { ExamplePage } from "../pages/ExamplePage";
import { TestWorld } from "../support/world";

Given("I open the local example page", async function (this: TestWorld) {
  if (!this.page) throw new Error("Page not initialized");
  const example = new ExamplePage(this.page);
  await example.open();
});

When("I click the {string} button", async function (this: TestWorld, label: string) {
  if (!this.page) throw new Error("Page not initialized");
  if (label !== "Continue") throw new Error(`Unsupported button: ${label}`);
  const example = new ExamplePage(this.page);
  await example.continue();
});

Then("I should see {string}", async function (this: TestWorld, expected: string) {
  if (!this.page) throw new Error("Page not initialized");
  const example = new ExamplePage(this.page);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await example.resultText()) === expected) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await example.resultText(), expected);
});
```

### 11.10 Demo feature — `Specifications/features/UC-001-open-example-page.feature`

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

No `playwright.config.ts` is generated: Playwright is driven via the Cucumber `World` (§11.4), not the Playwright Test runner.

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

| Scope | Resolved command |
| --- | --- |
| `demo` | `npm run test:smoke` |
| `suite` | `npm run test -- --tags "<tagExpression>"` |
| `feature` | `npm run test -- ../Specifications/features/<path>.feature` |
| `use-case` | `npm run test -- ../Specifications/features/<UC-id>-*.feature` |
| `all` | `npm run test` |
| `ci` | `npm run test:ci` |

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

## 14. Validation Contracts

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

import type { DocumentationGenerationService } from "./documentation-generation-service";
import type { DemoContentService } from "./demo-content-service";
import type { EnvironmentValidationService } from "./environment-validation-service";
import type { RunnerInstallationService } from "./runner-installation-service";
import type { SettingsService } from "./settings-service";
import type { SuiteService } from "./suite-service";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import type { TestHubSettings } from "../../domain/settings/settings";
import type { SuiteId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError, type AppError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/** Initialization contract (TIS §8.1). */
export interface InitializationService {
  /**
   * Runs the full init flow. A `correlationId` may be supplied by
   * {@link MaintenanceService.reset} (UC-024) so the whole reset flow —
   * `settings.reset` plus this `testhub.initialization.*` chain — shares one
   * reset-invocation id (Event Catalog §19). When omitted, the id of the
   * `testhub.initialization.started` event is used (the UC-001 wizard path).
   */
  initialize(
    request: InitializeTestHubRequest,
    onProgress?: ProgressReporter,
    correlationId?: string,
  ): Promise<Result<InitializeTestHubResult>>;
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
  defaultSuitesCreated: SuiteId[];
  runnerInstalled: boolean;
  documentationGenerated: boolean;
  demoGenerated: boolean;
}

export type ProgressReporter = (progress: InitializationProgress) => void;

export interface InitializationProgress {
  step: InitializationStep;
  label: string;
  status: "running" | "done" | "skipped" | "failed";
  detail?: string;
}

export type InitializationStep =
  | "settings"
  | "folders"
  | "documentation"
  | "suites"
  | "demo"
  | "runner"
  | "dependencies"
  | "browsers"
  | "validate";

/** Shared state threaded through the initialization step methods. */
interface InitializationContext {
  request: InitializeTestHubRequest;
  correlationId: string;
  onProgress: ProgressReporter;
  result: InitializeTestHubResult;
}

export class DefaultInitializationService implements InitializationService {
  /**
   * Re-entrancy guard (entry-point review): two wizards (ribbon + palette) or a
   * double Retry must not run two init flows concurrently — both would rewrite
   * `.testrunner` templates and run `npm install` in the same directory.
   * Synchronous flag, set before the first await, so there is no check-then-act
   * window.
   */
  private initializing = false;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly documentation: DocumentationGenerationService,
    private readonly suites: SuiteService,
    private readonly demo: DemoContentService,
    private readonly runnerInstall: RunnerInstallationService,
    private readonly validation: EnvironmentValidationService,
    private readonly pathSafety: PathSafetyPolicy,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    /**
     * Probe for the single active Test Run (ADR-0018), wired in main.ts to
     * `testExecutionService.activeRunId`. Initialization rewrites the
     * `.testrunner` files an in-flight run is READING, so it must refuse while
     * a run is active — the same exclusion repair()/reset() already enforce via
     * the maintenance lock. Optional (defaults to "no run") so the
     * MaintenanceService.reset() nested call — which already holds the
     * run/maintenance lock — and existing tests need no extra wiring.
     */
    private readonly activeRunId: () => string | null = () => null,
  ) {}

  async initialize(
    request: InitializeTestHubRequest,
    onProgress: ProgressReporter = () => {},
    suppliedCorrelationId?: string,
  ): Promise<Result<InitializeTestHubResult>> {
    if (this.initializing) {
      return err(
        appError(
          "INIT_FAILED",
          "Initialization is already in progress. Wait for it to finish before starting another.",
        ),
      );
    }
    const activeRun = this.activeRunId();
    if (activeRun !== null) {
      return err(
        appError(
          "RUN_IN_PROGRESS",
          `Cannot initialize while Test Run ${activeRun} is active. Cancel it first.`,
        ),
      );
    }
    this.initializing = true;
    try {
      return await this.runInitialization(request, onProgress, suppliedCorrelationId);
    } finally {
      this.initializing = false;
    }
  }

  private async runInitialization(
    request: InitializeTestHubRequest,
    onProgress: ProgressReporter = () => {},
    suppliedCorrelationId?: string,
  ): Promise<Result<InitializeTestHubResult>> {
    // The Test Hub folder is the in-vault root the wizard initializes; the
    // catalog's `vaultPath` is reported as that configured path (the service
    // has no handle to the absolute vault root, and only writes vault-relative).
    const vaultPath = request.settings.paths.testHubPath;
    const started = createEvent(
      "testhub.initialization.started",
      { vaultPath },
      { source: "user" },
    );
    // A reset threads in its own invocation id so `settings.reset` and this
    // chain group under one correlationId (UC-024, Event Catalog §19); the
    // wizard path falls back to the started event's id (UC-001).
    const correlationId = suppliedCorrelationId ?? started.id;
    await this.eventBus.publish({ ...started, correlationId });
    this.logger.info("Initializing Test Hub", { correlationId });

    const ctx: InitializationContext = {
      request,
      correlationId,
      onProgress,
      result: {
        createdFolders: [],
        createdFiles: [],
        defaultSuitesCreated: [],
        runnerInstalled: false,
        documentationGenerated: false,
        demoGenerated: false,
      },
    };

    const steps: ((ctx: InitializationContext) => Promise<Result<void>>)[] = [
      (c) => this.persistSettingsStep(c),
      (c) => this.createFoldersStep(c),
      (c) => this.documentationStep(c),
      (c) => this.defaultSuitesStep(c),
      (c) => this.demoContentStep(c),
      (c) => this.createRunnerStep(c),
      (c) => this.installDependenciesStep(c),
      (c) => this.validateEnvironmentStep(c),
    ];
    for (const step of steps) {
      const outcome = await step(ctx);
      if (!outcome.ok) return outcome;
    }

    await this.eventBus.publish(
      createEvent(
        "testhub.initialization.completed",
        {
          testHubPath: request.settings.paths.testHubPath,
          runnerPath: request.settings.paths.testRunnerPath,
        },
        { correlationId },
      ),
    );
    this.logger.info("Test Hub initialized", {
      correlationId,
      folders: ctx.result.createdFolders.length,
      files: ctx.result.createdFiles.length,
    });
    return ok(ctx.result);
  }

  /** Reports + publishes a step failure (UC-001 failure shape) and returns it. */
  private async failStep(
    ctx: InitializationContext,
    step: InitializationStep,
    error: AppError,
  ): Promise<Result<never>> {
    ctx.onProgress({ step, label: step, status: "failed", detail: error.message });
    this.logger.error("Initialization failed", error, {
      correlationId: ctx.correlationId,
      step,
    });
    await this.eventBus.publish(
      createEvent(
        "testhub.initialization.failed",
        { reason: error.message, step },
        { correlationId: ctx.correlationId },
      ),
    );
    return err(error);
  }

  /** 1. Persist settings (defaults loaded + validated). */
  private async persistSettingsStep(ctx: InitializationContext): Promise<Result<void>> {
    ctx.onProgress({ step: "settings", label: "Saving settings", status: "running" });
    const saved = await this.settingsService.save(ctx.request.settings);
    if (!saved.ok) return this.failStep(ctx, "settings", saved.error);
    ctx.onProgress({ step: "settings", label: "Saving settings", status: "done" });
    return ok(undefined);
  }

  /** 2. Create the vault folder structure (US-005). */
  private async createFoldersStep(ctx: InitializationContext): Promise<Result<void>> {
    ctx.onProgress({ step: "folders", label: "Creating folders", status: "running" });
    const folders = await this.createFolders(ctx.request.settings);
    if (!folders.ok) return this.failStep(ctx, "folders", folders.error);
    ctx.result.createdFolders = folders.value;
    ctx.onProgress({
      step: "folders",
      label: "Creating folders",
      status: "done",
      detail: `${folders.value.length} folders`,
    });
    return ok(undefined);
  }

  /** 3. Documentation (US-009) — optional. */
  private async documentationStep(ctx: InitializationContext): Promise<Result<void>> {
    if (!ctx.request.generateDocumentation) {
      ctx.onProgress({
        step: "documentation",
        label: "Generating documentation",
        status: "skipped",
      });
      return ok(undefined);
    }
    ctx.onProgress({ step: "documentation", label: "Generating documentation", status: "running" });
    const docs = await this.documentation.generate(ctx.correlationId);
    if (!docs.ok) return this.failStep(ctx, "documentation", docs.error);
    ctx.result.createdFiles.push(...docs.value.documents);
    ctx.result.documentationGenerated = true;
    ctx.onProgress({ step: "documentation", label: "Generating documentation", status: "done" });
    return ok(undefined);
  }

  /** 4. Default suites (US-008): Smoke + Regression. */
  private async defaultSuitesStep(ctx: InitializationContext): Promise<Result<void>> {
    ctx.onProgress({ step: "suites", label: "Creating default suites", status: "running" });
    const suites = await this.suites.createDefaults(ctx.correlationId);
    if (!suites.ok) return this.failStep(ctx, "suites", suites.error);
    ctx.result.defaultSuitesCreated = suites.value.map((suite) => suite.id);
    ctx.result.createdFiles.push(...suites.value.map((suite) => suite.path));
    ctx.onProgress({ step: "suites", label: "Creating default suites", status: "done" });
    return ok(undefined);
  }

  /** 5. Demo content (US-006/US-007) — optional. */
  private async demoContentStep(ctx: InitializationContext): Promise<Result<void>> {
    if (!ctx.request.generateDemoContent) {
      ctx.onProgress({ step: "demo", label: "Generating demo content", status: "skipped" });
      return ok(undefined);
    }
    ctx.onProgress({ step: "demo", label: "Generating demo content", status: "running" });
    const demo = await this.demo.generate();
    if (!demo.ok) return this.failStep(ctx, "demo", demo.error);
    ctx.result.createdFiles.push(demo.value.useCasePath, demo.value.featurePath);
    ctx.result.demoGenerated = true;
    ctx.onProgress({ step: "demo", label: "Generating demo content", status: "done" });
    return ok(undefined);
  }

  /** 6. Materialise the .testrunner project (US-010, RV-1). */
  private async createRunnerStep(ctx: InitializationContext): Promise<Result<void>> {
    ctx.onProgress({ step: "runner", label: "Creating runner project", status: "running" });
    const runner = await this.runnerInstall.createRunner(ctx.request.settings, ctx.correlationId);
    if (!runner.ok) return this.failStep(ctx, "runner", runner.error);
    ctx.result.runnerInstalled = true;
    ctx.result.createdFiles.push(...runner.value.createdFiles);
    ctx.onProgress({ step: "runner", label: "Creating runner project", status: "done" });
    return ok(undefined);
  }

  /**
   * 7. Install dependencies (US-011). Handles browser installation (original
   * phase 8, US-012) inline — browsers only run after deps succeed. A
   * non-zero exit fails init (RV-1).
   */
  private async installDependenciesStep(ctx: InitializationContext): Promise<Result<void>> {
    if (!ctx.request.installDependencies) {
      ctx.onProgress({ step: "dependencies", label: "Installing dependencies", status: "skipped" });
      return ok(undefined);
    }
    ctx.onProgress({ step: "dependencies", label: "Installing dependencies", status: "running" });
    const deps = await this.runnerInstall.installDependencies(ctx.request.settings);
    if (!deps.ok) return this.failStep(ctx, "dependencies", deps.error);
    ctx.onProgress({ step: "dependencies", label: "Installing dependencies", status: "done" });

    if (ctx.request.installBrowsers) {
      ctx.onProgress({ step: "browsers", label: "Installing browsers", status: "running" });
      const browsers = await this.runnerInstall.installBrowsers(ctx.request.settings);
      if (!browsers.ok) return this.failStep(ctx, "browsers", browsers.error);
      ctx.onProgress({ step: "browsers", label: "Installing browsers", status: "done" });
    }
    return ok(undefined);
  }

  /**
   * 9. Validate the environment (US-013, UC-002). Diagnostic only — an
   * incomplete environment (e.g. skipped install) does not fail init.
   */
  private async validateEnvironmentStep(ctx: InitializationContext): Promise<Result<void>> {
    ctx.onProgress({ step: "validate", label: "Validating environment", status: "running" });
    const validation = await this.validation.validateEnvironment(ctx.correlationId);
    ctx.onProgress({
      step: "validate",
      label: "Validating environment",
      status: "done",
      detail: validation.valid ? "ready" : `${validation.issues.length} issue(s)`,
    });
    return ok(undefined);
  }

  /** Creates each configured folder (idempotent), validating paths first. */
  private async createFolders(settings: TestHubSettings): Promise<Result<VaultPath[]>> {
    const folders = this.foldersToCreate(settings);
    const created: VaultPath[] = [];
    for (const folder of folders) {
      const safe = this.pathSafety.validate(folder);
      if (!safe.ok) return err(safe.error);
      if (await this.fs.exists(folder)) continue;
      const result = await this.fs.createFolder(folder);
      if (!result.ok) {
        return err(
          appError("INIT_FAILED", `Could not create folder "${folder}".`, {
            cause: result.error,
          }),
        );
      }
      created.push(folder);
    }
    return ok(created);
  }

  /** Deduplicated, parent-before-child folder list from settings paths. */
  private foldersToCreate(settings: TestHubSettings): VaultPath[] {
    const { paths, logging } = settings;
    const candidates = [
      paths.testHubPath,
      paths.domainsPath,
      paths.prdsPath,
      paths.useCasesPath,
      paths.specificationsPath,
      paths.featureFilesPath,
      paths.testSuitesPath,
      paths.evidencePath,
      paths.documentationPath,
      paths.testRunnerPath,
      logging.path,
    ];
    return [...new Set(candidates)].sort((a, b) => a.split("/").length - b.split("/").length);
  }
}

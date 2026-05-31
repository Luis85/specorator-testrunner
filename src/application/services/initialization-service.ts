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
  initialize(
    request: InitializeTestHubRequest,
    onProgress?: ProgressReporter,
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

export class DefaultInitializationService implements InitializationService {
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
  ) {}

  async initialize(
    request: InitializeTestHubRequest,
    onProgress: ProgressReporter = () => {},
  ): Promise<Result<InitializeTestHubResult>> {
    const correlationId = createEvent("testhub.initialization.started", {}).id;
    await this.eventBus.publish(
      createEvent("testhub.initialization.started", {}, { correlationId, source: "user" }),
    );
    this.logger.info("Initializing Test Hub", { correlationId });

    const result: InitializeTestHubResult = {
      createdFolders: [],
      createdFiles: [],
      defaultSuitesCreated: [],
      runnerInstalled: false,
      documentationGenerated: false,
      demoGenerated: false,
    };

    const fail = async (step: InitializationStep, error: AppError) => {
      onProgress({ step, label: step, status: "failed", detail: error.message });
      this.logger.error("Initialization failed", error, { correlationId, step });
      await this.eventBus.publish(
        createEvent("testhub.initialization.failed", { step, error }, { correlationId }),
      );
      return err(error);
    };

    // 1. Persist settings (defaults loaded + validated).
    onProgress({ step: "settings", label: "Saving settings", status: "running" });
    const saved = await this.settingsService.save(request.settings);
    if (!saved.ok) return fail("settings", saved.error);
    onProgress({ step: "settings", label: "Saving settings", status: "done" });

    // 2. Create the vault folder structure (US-005).
    onProgress({ step: "folders", label: "Creating folders", status: "running" });
    const folders = await this.createFolders(request.settings);
    if (!folders.ok) return fail("folders", folders.error);
    result.createdFolders = folders.value;
    onProgress({
      step: "folders",
      label: "Creating folders",
      status: "done",
      detail: `${folders.value.length} folders`,
    });

    // 3. Documentation (US-009).
    if (request.generateDocumentation) {
      onProgress({ step: "documentation", label: "Generating documentation", status: "running" });
      const docs = await this.documentation.generate();
      if (!docs.ok) return fail("documentation", docs.error);
      result.createdFiles.push(...docs.value.documents);
      result.documentationGenerated = true;
      onProgress({ step: "documentation", label: "Generating documentation", status: "done" });
    } else {
      onProgress({ step: "documentation", label: "Generating documentation", status: "skipped" });
    }

    // 4. Default suites (US-008): Smoke + Regression.
    onProgress({ step: "suites", label: "Creating default suites", status: "running" });
    const suites = await this.suites.createDefaults();
    if (!suites.ok) return fail("suites", suites.error);
    result.defaultSuitesCreated = suites.value.map((suite) => suite.id);
    result.createdFiles.push(...suites.value.map((suite) => suite.path));
    onProgress({ step: "suites", label: "Creating default suites", status: "done" });

    // 5. Demo content (US-006/US-007).
    if (request.generateDemoContent) {
      onProgress({ step: "demo", label: "Generating demo content", status: "running" });
      const demo = await this.demo.generate();
      if (!demo.ok) return fail("demo", demo.error);
      result.createdFiles.push(demo.value.useCasePath, demo.value.featurePath);
      result.demoGenerated = true;
      onProgress({ step: "demo", label: "Generating demo content", status: "done" });
    } else {
      onProgress({ step: "demo", label: "Generating demo content", status: "skipped" });
    }

    // 6. Materialise the .testrunner project (US-010, RV-1).
    onProgress({ step: "runner", label: "Creating runner project", status: "running" });
    const runner = await this.runnerInstall.createRunner(request.settings);
    if (!runner.ok) return fail("runner", runner.error);
    result.runnerInstalled = true;
    result.createdFiles.push(...runner.value.createdFiles);
    onProgress({ step: "runner", label: "Creating runner project", status: "done" });

    // 7. Install dependencies (US-011). A non-zero exit fails init (RV-1).
    if (request.installDependencies) {
      onProgress({ step: "dependencies", label: "Installing dependencies", status: "running" });
      const deps = await this.runnerInstall.installDependencies(request.settings);
      if (!deps.ok) return fail("dependencies", deps.error);
      onProgress({ step: "dependencies", label: "Installing dependencies", status: "done" });

      // 8. Install Playwright browsers (US-012) — only after deps succeed.
      if (request.installBrowsers) {
        onProgress({ step: "browsers", label: "Installing browsers", status: "running" });
        const browsers = await this.runnerInstall.installBrowsers(request.settings);
        if (!browsers.ok) return fail("browsers", browsers.error);
        onProgress({ step: "browsers", label: "Installing browsers", status: "done" });
      }
    } else {
      onProgress({ step: "dependencies", label: "Installing dependencies", status: "skipped" });
    }

    // 9. Validate the environment (US-013, UC-002). Diagnostic only — an
    //    incomplete environment (e.g. skipped install) does not fail init.
    onProgress({ step: "validate", label: "Validating environment", status: "running" });
    const validation = await this.validation.validateEnvironment();
    onProgress({
      step: "validate",
      label: "Validating environment",
      status: "done",
      detail: validation.valid ? "ready" : `${validation.issues.length} issue(s)`,
    });

    await this.eventBus.publish(
      createEvent("testhub.initialization.completed", { result }, { correlationId }),
    );
    this.logger.info("Test Hub initialized", {
      correlationId,
      folders: result.createdFolders.length,
      files: result.createdFiles.length,
    });
    return ok(result);
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

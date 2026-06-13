import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Plugin } from "obsidian";
import type { TestHubCommandDeps } from "../src/presentation/commands/register-commands";
import { registerCommands } from "../src/presentation/commands/register-commands";
import type { EnvironmentValidationService } from "../src/application/services/environment-validation-service";
import type { MaintenanceService } from "../src/application/services/maintenance-service";
import type { PipelineGenerationService } from "../src/application/services/pipeline-generation-service";
import type { DocumentationGenerationService } from "../src/application/services/documentation-generation-service";
import type { UseCaseService } from "../src/application/services/use-case-service";
import type { SpecificationService } from "../src/application/services/specification-service";
import type { StepDefinitionService } from "../src/application/services/step-definition-service";
import type { SuiteService } from "../src/application/services/suite-service";
import type { RunLauncher } from "../src/presentation/run/run-launcher";
import type { PostRunCoordinator } from "../src/application/services/post-run-coordinator";
import type { WorkspacePort } from "../src/application/ports/workspace-port";

/**
 * Test for Create PRD command registration (Task 11)
 */
describe("Create PRD command", () => {
  let plugin: Plugin;
  let commands: { id: string; name: string; callback: () => void }[];

  beforeEach(() => {
    commands = [];
    plugin = {
      addCommand: vi.fn((command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
  });

  const createMockDeps = (): TestHubCommandDeps => ({
    getSettings: vi.fn(),
    validationService: {} as Partial<EnvironmentValidationService> as EnvironmentValidationService,
    maintenanceService: {} as Partial<MaintenanceService> as MaintenanceService,
    pipelineService: {} as Partial<PipelineGenerationService> as PipelineGenerationService,
    documentationService:
      {} as Partial<DocumentationGenerationService> as DocumentationGenerationService,
    useCaseService: {} as Partial<UseCaseService> as UseCaseService,
    specificationService: {} as Partial<SpecificationService> as SpecificationService,
    stepDefinitionService: {} as Partial<StepDefinitionService> as StepDefinitionService,
    suiteService: {} as Partial<SuiteService> as SuiteService,
    runLauncher: {} as Partial<RunLauncher> as RunLauncher,
    postRunCoordinator: {} as Partial<PostRunCoordinator> as Pick<
      PostRunCoordinator,
      "importLastRun"
    >,
    workspace: {} as Partial<WorkspacePort> as WorkspacePort,
    openWizard: vi.fn(),
    openCreateUseCase: vi.fn(),
    openCreateSuite: vi.fn(),
    openDocumentation: vi.fn(),
    openPrdBuilder: vi.fn(),
  });

  it("registers Create PRD command with correct id", () => {
    const mockDeps = createMockDeps();

    registerCommands(plugin, mockDeps);

    const createPrdCommand = commands.find((cmd) => cmd.id === "create-prd");
    expect(createPrdCommand).toBeTruthy();
    expect(createPrdCommand?.name).toBe("New PRD");
  });

  it("invoking Create PRD command calls openPrdBuilder", () => {
    const openPrdBuilder = vi.fn();

    const mockDeps = createMockDeps();
    mockDeps.openPrdBuilder = openPrdBuilder;

    registerCommands(plugin, mockDeps);

    const createPrdCommand = commands.find((cmd) => cmd.id === "create-prd");
    expect(createPrdCommand).toBeTruthy();

    createPrdCommand?.callback();

    expect(openPrdBuilder).toHaveBeenCalled();
  });

  it("Create PRD command appears in the command list", () => {
    const mockDeps = createMockDeps();

    registerCommands(plugin, mockDeps);

    // Verify the command has the right structure
    const createPrdCommand = commands.find((cmd) => cmd.id === "create-prd");
    expect(createPrdCommand?.id).toBe("create-prd");
    expect(createPrdCommand?.name).toBe("New PRD");
    expect(typeof createPrdCommand?.callback).toBe("function");
  });
});

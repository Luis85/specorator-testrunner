import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Plugin } from "obsidian";
import { Notice } from "obsidian";
import type { TestHubCommandDeps } from "../src/presentation/commands/register-commands";
import { registerCommands } from "../src/presentation/commands/register-commands";
import type { DefaultUseCaseService } from "../src/application/services/use-case-service";
import type { SettingsService } from "../src/application/services/settings-service";
import { InMemoryEventBus } from "../src/shared/event-bus/event-bus";
import { silentLogger } from "./fakes";

/**
 * Test for Create PRD command registration (Task 11)
 */
describe("Create PRD command", () => {
  let plugin: Plugin;
  let commands: Array<{ id: string; name: string; callback: () => void }>;

  beforeEach(() => {
    commands = [];
    plugin = {
      addCommand: vi.fn((command) => {
        commands.push(command);
      }),
    } as unknown as Plugin;
  });

  it("registers Create PRD command with correct id", () => {
    const mockDeps: TestHubCommandDeps = {
      getSettings: vi.fn(),
      validationService: {} as any,
      maintenanceService: {} as any,
      pipelineService: {} as any,
      documentationService: {} as any,
      useCaseService: {} as any,
      specificationService: {} as any,
      stepDefinitionService: {} as any,
      suiteService: {} as any,
      runLauncher: {} as any,
      postRunCoordinator: {} as any,
      workspace: {} as any,
      openWizard: vi.fn(),
      openCreateUseCase: vi.fn(),
      openCreateSuite: vi.fn(),
      openDocumentation: vi.fn(),
      openPrdBuilder: vi.fn(),
    } as unknown as TestHubCommandDeps;

    registerCommands(plugin, mockDeps as any);

    const createPrdCommand = commands.find((cmd) => cmd.id === "create-prd");
    expect(createPrdCommand).toBeTruthy();
    expect(createPrdCommand?.name).toBe("Create PRD");
  });

  it("invoking Create PRD command calls openPrdBuilder", () => {
    const openPrdBuilder = vi.fn();

    const mockDeps: TestHubCommandDeps = {
      getSettings: vi.fn(),
      validationService: {} as any,
      maintenanceService: {} as any,
      pipelineService: {} as any,
      documentationService: {} as any,
      useCaseService: {} as any,
      specificationService: {} as any,
      stepDefinitionService: {} as any,
      suiteService: {} as any,
      runLauncher: {} as any,
      postRunCoordinator: {} as any,
      workspace: {} as any,
      openWizard: vi.fn(),
      openCreateUseCase: vi.fn(),
      openCreateSuite: vi.fn(),
      openDocumentation: vi.fn(),
      openPrdBuilder,
    } as unknown as TestHubCommandDeps;

    registerCommands(plugin, mockDeps as any);

    const createPrdCommand = commands.find((cmd) => cmd.id === "create-prd");
    expect(createPrdCommand).toBeTruthy();

    createPrdCommand?.callback();

    expect(openPrdBuilder).toHaveBeenCalled();
  });

  it("Create PRD command appears in the command list", () => {
    const mockDeps: TestHubCommandDeps = {
      getSettings: vi.fn(),
      validationService: {} as any,
      maintenanceService: {} as any,
      pipelineService: {} as any,
      documentationService: {} as any,
      useCaseService: {} as any,
      specificationService: {} as any,
      stepDefinitionService: {} as any,
      suiteService: {} as any,
      runLauncher: {} as any,
      postRunCoordinator: {} as any,
      workspace: {} as any,
      openWizard: vi.fn(),
      openCreateUseCase: vi.fn(),
      openCreateSuite: vi.fn(),
      openDocumentation: vi.fn(),
      openPrdBuilder: vi.fn(),
    } as unknown as TestHubCommandDeps;

    registerCommands(plugin, mockDeps as any);

    // Verify the command has the right structure
    const createPrdCommand = commands.find((cmd) => cmd.id === "create-prd");
    expect(createPrdCommand?.id).toBe("create-prd");
    expect(createPrdCommand?.name).toBe("Create PRD");
    expect(typeof createPrdCommand?.callback).toBe("function");
  });
});

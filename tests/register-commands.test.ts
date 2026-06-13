import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import { registerCommands } from "../src/presentation/commands/register-commands";
import type { TestHubCommandDeps } from "../src/presentation/commands/register-commands";
import type { RunLauncher } from "../src/presentation/run/run-launcher";
import { ok } from "../src/shared/result/result";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

interface RecordedCommand {
  id: string;
  name: string;
  callback?: () => unknown;
  // boolean | undefined avoids the @typescript-eslint/no-invalid-void-type rule
  checkCallback?: (checking: boolean) => boolean | undefined;
}

const buildPlugin = () => {
  const commands: RecordedCommand[] = [];
  const plugin = {
    addCommand: (command: RecordedCommand) => {
      commands.push(command);
      return command;
    },
    app: {
      workspace: {
        // getActiveFile(): return null so activeFeaturePath() returns early
        // (new Notice + return null); no .feature extension means it won't
        // proceed to service calls.
        getActiveFile: vi.fn(() => null),
      },
    },
  } as unknown as Plugin;
  return { plugin, commands };
};

/**
 * Builds a fully-typed `TestHubCommandDeps` stub. Every service method returns
 * the ok-shape its callers expect so all command callbacks can run without
 * throwing. Empty arrays are the safe "no items" shape (triggers early-exit
 * Notices rather than modal opens, which is fine — Modal stubs are inert).
 *
 * Typed as `TestHubCommandDeps` (not `as never`) — the compiler enforces that
 * every stub returns the right domain shape. The RunLauncher stub is cast via
 * `as unknown as RunLauncher` because RunLauncher is a class (not a structural
 * interface), so only the two public methods used by registerCommands are
 * stubbed rather than the private fields.
 */
const buildDeps = (): TestHubCommandDeps => ({
  getSettings: vi.fn(() => DEFAULT_SETTINGS),

  validationService: {
    validateEnvironment: vi.fn(async () => ({
      valid: true,
      nodeAvailable: true,
      packageManagerAvailable: true,
      runnerFolderExists: true,
      packageJsonExists: true,
      dependenciesInstalled: true,
      playwrightAvailable: true,
      browsersInstalled: true,
      issues: [],
    })),
    validateCiReadiness: vi.fn(async () => ({
      ready: true,
      missingItems: [],
      warnings: [],
    })),
  },

  maintenanceService: {
    repair: vi.fn(async () =>
      ok({ repairedFiles: [], reinstalledPackages: false, reinstalledBrowsers: false }),
    ),
    reset: vi.fn(async () => ok({ deletedFolders: [], recreatedFiles: [], correlationId: "stub" })),
  },

  pipelineService: {
    generate: vi.fn(async () =>
      ok({ provider: "github-actions" as const, path: ".github/workflows/e2e.yml" }),
    ),
  },

  documentationService: {
    generate: vi.fn(async () => ok({ documents: [] })),
    open: vi.fn(async () => ok({ path: vp("Test Hub/index.md"), documentType: "index" as const })),
  },

  useCaseService: {
    create: vi.fn(async () =>
      ok({
        id: "UC-001",
        title: "stub",
        status: "draft" as const,
        automationStatus: "not-planned" as const,
        featureFiles: [],
        suites: [],
        evidence: [],
        path: vp("Use Cases/UC-001.md"),
      }),
    ),
    findAll: vi.fn(async () => ok([])),
    findById: vi.fn(async () => ok(null)),
    update: vi.fn(async () => ok(undefined)),
    updateMetadata: vi.fn(async () =>
      ok({
        id: "UC-001",
        title: "stub",
        status: "draft" as const,
        automationStatus: "not-planned" as const,
        featureFiles: [],
        suites: [],
        evidence: [],
        path: vp("Use Cases/UC-001.md"),
      }),
    ),
  },

  specificationService: {
    createFromUseCase: vi.fn(async () =>
      ok({
        path: vp("Specifications/features/UC-001-happy-path.feature"),
        useCaseId: "UC-001",
        featureName: "UC-001 Happy Path",
        tags: [],
        scenarios: [],
      }),
    ),
    update: vi.fn(async () => ok(undefined)),
    validate: vi.fn(async () => ok({ valid: true, errors: [] })),
    detectMissingSteps: vi.fn(async () =>
      ok({
        featurePath: vp("Specifications/features/UC-001-happy-path.feature"),
        missingSteps: [],
        detectionEventId: "stub-event-id",
      }),
    ),
    listFeatures: vi.fn(async () => ok([])),
    announceUpdated: vi.fn(async () => undefined),
    listStepPatterns: vi.fn(async () => ok([])),
  },

  stepDefinitionService: {
    generate: vi.fn(async () =>
      ok({
        generatedSteps: [],
        stepFile: vp(".testrunner/src/steps/UC-001-happy-path.steps.ts"),
        appended: false,
      }),
    ),
  },

  suiteService: {
    create: vi.fn(async () =>
      ok({
        id: "SUITE-001",
        name: "stub",
        tagExpression: "@smoke",
        path: vp("Test Suites/SUITE-001.md"),
      }),
    ),
    createDefaults: vi.fn(async () => ok([])),
    findAll: vi.fn(async () => ok([])),
    resolveTagExpression: vi.fn(async () => ok("@smoke")),
  },

  // RunLauncher is a class (not a structural interface) — cast the stub via
  // `as unknown` so only the two public methods used by registerCommands need
  // to be present.
  runLauncher: {
    launch: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  } as unknown as RunLauncher,

  postRunCoordinator: {
    importLastRun: vi.fn(async () => ok({ kind: "no-run" as const })),
  },

  workspace: {
    openFile: vi.fn(async () => ok(undefined)),
    openView: vi.fn(async () => ok(undefined)),
  },

  openWizard: vi.fn(() => undefined),
  openCreateUseCase: vi.fn(() => undefined),
  openCreateSuite: vi.fn(() => undefined),
  openDocumentation: vi.fn(async () => undefined),
});

describe("registerCommands (smoke)", () => {
  it("registers the full command surface with unique, well-formed ids", () => {
    const { plugin, commands } = buildPlugin();
    registerCommands(plugin, buildDeps());
    const ids = commands.map((command) => command.id);
    // register-commands.ts currently registers 29 commands; the >=25 floor
    // catches meaningful registration loss while giving V2 room to add more.
    // The id spot-check below is the tighter guard against silent removal.
    expect(commands.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of commands) {
      expect(command.id).toMatch(/^[a-z0-9-]+$/);
      expect(command.name.trim().length).toBeGreaterThan(0);
    }
    // Spot-check a representative cross-section of command ids so a silent
    // removal of any named command is caught even inside the count floor.
    const knownIds = [
      "initialize-test-hub",
      "validate-environment",
      "generate-ci-workflow",
      "open-dashboard",
      "run-all-tests",
      "import-report-last-run",
      "generate-documentation",
      "generate-step-definitions",
      "open-test-console",
    ];
    for (const id of knownIds) {
      expect(ids, `command "${id}" missing from registered set`).toContain(id);
    }
  });

  it("returns the generateCiWorkflow helper", () => {
    const { plugin } = buildPlugin();
    const helpers = registerCommands(plugin, buildDeps());
    expect(typeof helpers.generateCiWorkflow).toBe("function");
  });

  // Scope caveat: command bodies follow Obsidian's `() => void asyncFn()`
  // convention, so this pins only that no callback throws SYNCHRONOUSLY —
  // async rejections are discarded by the void-wrap and cannot surface here.
  it("every command callback is invocable against stubbed services without throwing", async () => {
    const { plugin, commands } = buildPlugin();
    registerCommands(plugin, buildDeps());
    for (const command of commands) {
      if (command.callback)
        await expect(Promise.resolve(command.callback())).resolves.not.toThrow();
      if (command.checkCallback) expect(() => command.checkCallback?.(true)).not.toThrow();
    }
  });
});

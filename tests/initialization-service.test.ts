import { describe, expect, it } from "vitest";
import { DefaultDemoContentService } from "../src/application/services/demo-content-service";
import { DefaultDocumentationGenerationService } from "../src/application/services/documentation-generation-service";
import {
  DefaultInitializationService,
  type InitializationProgress,
  type InitializeTestHubRequest,
} from "../src/application/services/initialization-service";
import { DefaultEnvironmentValidationService } from "../src/application/services/environment-validation-service";
import { DefaultRunnerInstallationService } from "../src/application/services/runner-installation-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultSuiteService } from "../src/application/services/suite-service";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { DEMO_FEATURE_CONTENT } from "../src/application/content/demo-content";
import type { Logger } from "../src/shared/logging/logger";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
  FakeTemplateWriter,
  FakeVaultFileSystem,
  recordingEventBus,
} from "./fakes";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const buildHarness = () => {
  const store = new FakeDataStore();
  const fs = new FakeVaultFileSystem();
  const pathSafety = new DefaultPathSafetyPolicy();
  const commandSafety = new DefaultCommandSafetyPolicy();
  const { bus, types } = recordingEventBus();
  const settings = new DefaultSettingsService(store, pathSafety, bus);
  const docs = new DefaultDocumentationGenerationService(settings, fs, bus);
  const suites = new DefaultSuiteService(settings, fs, bus);
  const demo = new DefaultDemoContentService(settings, fs, bus);

  const absoluteFs = new FakeAbsoluteFileSystem();
  const childProcess = new FakeChildProcessRunner();
  const templates = new FakeTemplateWriter();
  const runnerInstall = new DefaultRunnerInstallationService(
    templates,
    childProcess,
    absoluteFs,
    commandSafety,
    bus,
    silentLogger,
  );
  const validation = new DefaultEnvironmentValidationService(
    settings,
    childProcess,
    absoluteFs,
    commandSafety,
    bus,
  );
  const service = new DefaultInitializationService(
    settings,
    fs,
    docs,
    suites,
    demo,
    runnerInstall,
    validation,
    pathSafety,
    bus,
    silentLogger,
  );
  return { service, fs, types, childProcess, templates };
};

const request: InitializeTestHubRequest = {
  settings: DEFAULT_SETTINGS,
  installDependencies: false,
  installBrowsers: false,
  generateDemoContent: true,
  generateDocumentation: true,
};

describe("DefaultInitializationService", () => {
  it("creates folders, docs, suites, and demo content end to end", async () => {
    const { service, fs } = buildHarness();
    const progress: InitializationProgress[] = [];

    const result = await service.initialize(request, (p) => progress.push(p));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Folders (US-005): the six business folders + runner + logs, deduped.
    expect(fs.folders.has(".testrunner")).toBe(true);
    expect(fs.folders.has("Use Cases")).toBe(true);
    expect(fs.folders.has("Test Evidence")).toBe(true);
    expect(result.value.createdFolders).toContain("Specifications/features");

    // Default suites (US-008).
    expect(result.value.defaultSuitesCreated).toEqual(["smoke", "regression"]);

    // Documentation (US-009).
    expect(result.value.documentationGenerated).toBe(true);
    expect(fs.files.has("Test Hub/Getting Started.md")).toBe(true);
    expect(fs.files.has("Test Hub/User Manual.md")).toBe(true);
    expect(fs.files.has("Test Hub/Troubleshooting.md")).toBe(true);

    // Demo content (US-006/US-007).
    expect(result.value.demoGenerated).toBe(true);
    const featurePath = "Specifications/features/UC-001-open-example-page.feature";
    expect(fs.files.get(featurePath)).toBe(DEMO_FEATURE_CONTENT);
    expect([...fs.files.keys()].some((p) => p.includes("UC-001"))).toBe(true);

    // Runner project is materialised (US-010).
    expect(result.value.runnerInstalled).toBe(true);
    expect(result.value.createdFiles.some((p) => p.startsWith(".testrunner/"))).toBe(true);

    // Progress reported a terminal state for each executed step.
    const doneSteps = progress.filter((p) => p.status === "done").map((p) => p.step);
    expect(doneSteps).toEqual(
      expect.arrayContaining(["settings", "folders", "documentation", "suites", "demo"]),
    );
  });

  it("publishes the UC-001 event sequence", async () => {
    const { service, types } = buildHarness();
    await service.initialize(request);

    const emitted = types();
    expect(emitted[0]).toBe("testhub.initialization.started");
    expect(emitted).toContain("documentation.generated");
    expect(emitted.filter((t) => t === "suite.created")).toHaveLength(2);
    expect(emitted).toContain("usecase.created");
    expect(emitted).toContain("specification.linkedToUseCase");
    expect(emitted).toContain("testrunner.installed");
    expect(emitted).toContain("testrunner.validated");
    expect(emitted.at(-1)).toBe("testhub.initialization.completed");
    expect(emitted).not.toContain("testhub.initialization.failed");
  });

  it("installs dependencies and browsers when requested, failing init on a non-zero exit", async () => {
    const { service, childProcess } = buildHarness();
    const result = await service.initialize({
      ...request,
      installDependencies: true,
      installBrowsers: true,
    });
    expect(result.ok).toBe(true);
    const commands = childProcess.calls.map((c) => c.args.join(" "));
    expect(commands).toContain(DEFAULT_SETTINGS.runner.installCommand);
    expect(commands).toContain(DEFAULT_SETTINGS.runner.browserInstallCommand);
  });

  it("fails init when dependency installation exits non-zero", async () => {
    const { service, childProcess } = buildHarness();
    childProcess.exitCodes.set("npm install", 1);
    const result = await service.initialize({ ...request, installDependencies: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NPM_INSTALL_FAILED");
  });

  it("skips documentation when generateDocumentation is false", async () => {
    const { service, fs } = buildHarness();
    const result = await service.initialize({ ...request, generateDocumentation: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.documentationGenerated).toBe(false);
    expect(fs.files.has("Test Hub/Getting Started.md")).toBe(false);
  });

  it("is idempotent: a second run creates no new folders", async () => {
    const { service } = buildHarness();
    await service.initialize(request);
    const second = await service.initialize(request);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.createdFolders).toEqual([]);
  });

  it("reports failure and emits initialization.failed when a write fails", async () => {
    const { service, fs, types } = buildHarness();
    fs.failOn = { path: "Test Hub/Getting Started.md", message: "disk full" };

    const result = await service.initialize(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INIT_FAILED");
    expect(types()).toContain("testhub.initialization.failed");
    expect(types()).not.toContain("testhub.initialization.completed");
  });

  it("fails fast when settings are invalid", async () => {
    const { service, fs } = buildHarness();
    const badRequest: InitializeTestHubRequest = {
      ...request,
      settings: {
        ...DEFAULT_SETTINGS,
        paths: { ...DEFAULT_SETTINGS.paths, useCasesPath: "../escape" },
      },
    };

    const result = await service.initialize(badRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SETTINGS_INVALID");
    expect(fs.folders.size).toBe(0); // bailed before touching the vault
  });
});

import { describe, expect, it } from "vitest";
import { DefaultEnvironmentValidationService } from "../src/application/services/environment-validation-service";
import { DefaultMaintenanceService } from "../src/application/services/maintenance-service";
import { DefaultRunnerInstallationService } from "../src/application/services/runner-installation-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { REQUIRED_RUNNER_DEPENDENCIES } from "../src/application/content/runner-templates";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
  FakeTemplateWriter,
  recordingEventBus,
  silentLogger,
} from "./fakes";

const build = () => {
  const absoluteFs = new FakeAbsoluteFileSystem();
  const childProcess = new FakeChildProcessRunner();
  const templates = new FakeTemplateWriter();
  const commandSafety = new DefaultCommandSafetyPolicy();
  const { bus, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
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
    { HOME: "/home/u" },
    "linux",
  );
  const activeRun = {
    runId: null as string | null,
    settled: false,
    activeRunId() {
      return this.runId;
    },
    whenActiveSettles() {
      this.settled = true;
      return Promise.resolve();
    },
  };
  const service = new DefaultMaintenanceService(
    settings,
    validation,
    runnerInstall,
    bus,
    silentLogger,
    activeRun,
  );
  return { service, absoluteFs, childProcess, templates, types, activeRun };
};

const seedHealthyRunner = (absoluteFs: FakeAbsoluteFileSystem) => {
  absoluteFs.existing.add("/vault/.testrunner");
  absoluteFs.existing.add("/vault/.testrunner/package.json");
  absoluteFs.existing.add("/vault/.testrunner/node_modules");
  for (const dep of REQUIRED_RUNNER_DEPENDENCIES) {
    absoluteFs.existing.add(`/vault/.testrunner/${dep}`);
  }
  absoluteFs.existing.add("/home/u/.cache/ms-playwright/chromium-1148/chrome");
};

describe("DefaultMaintenanceService", () => {
  it("recreates files and reinstalls when dependencies and browsers are missing", async () => {
    const { service, childProcess, templates, types } = build();
    // absoluteFs is empty → validation sees deps and browsers missing.

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repairedFiles.length).toBeGreaterThan(0);
    expect(result.value.reinstalledPackages).toBe(true);
    expect(result.value.reinstalledBrowsers).toBe(true);
    expect(templates.requests).toHaveLength(1); // re-synced once
    const commands = childProcess.calls.map((c) => c.args.join(" "));
    expect(commands).toContain("npm install");
    expect(commands).toContain("npx playwright install chromium");
    expect(types()).toContain("testrunner.repaired");
  });

  it("skips the dependency reinstall when deps are healthy, but always (re)verifies the browser", async () => {
    const { service, absoluteFs, childProcess } = build();
    seedHealthyRunner(absoluteFs);

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reinstalledPackages).toBe(false);
    expect(result.value.reinstalledBrowsers).toBe(true); // authoritative, idempotent
    const commands = childProcess.calls.map((c) => c.args.join(" "));
    expect(commands).not.toContain("npm install");
    expect(commands).toContain("npx playwright install chromium");
  });

  it("reinstalls dependencies when Playwright is present but not runnable", async () => {
    const { service, absoluteFs, childProcess } = build();
    seedHealthyRunner(absoluteFs);
    childProcess.exitCodes.set("npx playwright --version", 1);

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reinstalledPackages).toBe(true);
    expect(result.value.reinstalledBrowsers).toBe(true);
    expect(childProcess.calls.map((c) => c.args.join(" "))).toContain("npm install");
  });

  it("fails when a required reinstall fails", async () => {
    const { service, childProcess } = build();
    childProcess.exitCodes.set("npm install", 1);
    const result = await service.repair();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NPM_INSTALL_FAILED");
  });

  it("refuses to repair while a test run is active (P0-3)", async () => {
    const { service, templates, childProcess, activeRun } = build();
    activeRun.runId = "RUN-2026-05-31-120000";

    const result = await service.repair();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RUN_IN_PROGRESS");
      expect(result.error.details?.activeRunId).toBe("RUN-2026-05-31-120000");
    }
    // Nothing was mutated: no template re-sync, no install commands.
    expect(templates.requests).toHaveLength(0);
    expect(childProcess.calls).toHaveLength(0);
  });

  it("awaits the active run settling before mutating the runner (P0-3)", async () => {
    const { service, activeRun } = build();
    // No active run id, but a settle hook is still awaited before any mutation.
    const result = await service.repair();
    expect(result.ok).toBe(true);
    expect(activeRun.settled).toBe(true);
  });
});

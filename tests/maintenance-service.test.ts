import { describe, expect, it } from "vitest";
import { DefaultEnvironmentValidationService } from "../src/application/services/environment-validation-service";
import { DefaultMaintenanceService } from "../src/application/services/maintenance-service";
import { DefaultRunnerInstallationService } from "../src/application/services/runner-installation-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
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
  const service = new DefaultMaintenanceService(
    settings,
    validation,
    runnerInstall,
    bus,
    silentLogger,
  );
  return { service, absoluteFs, childProcess, templates, types };
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
    const commands = childProcess.calls.map((c) => c.command);
    expect(commands).toContain("npm install");
    expect(commands).toContain("npx playwright install chromium");
    expect(types()).toContain("testrunner.repaired");
  });

  it("recreates files but skips installs when everything is already present", async () => {
    const { service, absoluteFs, childProcess } = build();
    absoluteFs.existing.add("/vault/.testrunner");
    absoluteFs.existing.add("/vault/.testrunner/package.json");
    absoluteFs.existing.add("/vault/.testrunner/node_modules");
    absoluteFs.existing.add("/home/u/.cache/ms-playwright");

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reinstalledPackages).toBe(false);
    expect(result.value.reinstalledBrowsers).toBe(false);
    expect(childProcess.calls.map((c) => c.command)).not.toContain("npm install");
  });

  it("reinstalls dependencies when Playwright is present but not runnable", async () => {
    const { service, absoluteFs, childProcess } = build();
    absoluteFs.existing.add("/vault/.testrunner");
    absoluteFs.existing.add("/vault/.testrunner/package.json");
    absoluteFs.existing.add("/vault/.testrunner/node_modules");
    absoluteFs.existing.add("/home/u/.cache/ms-playwright");
    childProcess.exitCodes.set("npx playwright --version", 1);

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reinstalledPackages).toBe(true);
    expect(result.value.reinstalledBrowsers).toBe(false);
    expect(childProcess.calls.map((c) => c.command)).toContain("npm install");
  });

  it("fails when a required reinstall fails", async () => {
    const { service, childProcess } = build();
    childProcess.exitCodes.set("npm install", 1);
    const result = await service.repair();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NPM_INSTALL_FAILED");
  });
});

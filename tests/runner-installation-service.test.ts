import { describe, expect, it } from "vitest";
import { DefaultRunnerInstallationService } from "../src/application/services/runner-installation-service";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DEFAULT_SETTINGS, type TestHubSettings } from "../src/domain/settings/settings";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeTemplateWriter,
  recordingEventBus,
  silentLogger,
} from "./fakes";

const build = () => {
  const templates = new FakeTemplateWriter();
  const childProcess = new FakeChildProcessRunner();
  const absoluteFs = new FakeAbsoluteFileSystem();
  const { bus, types } = recordingEventBus();
  const service = new DefaultRunnerInstallationService(
    templates,
    childProcess,
    absoluteFs,
    new DefaultCommandSafetyPolicy(),
    bus,
    silentLogger,
  );
  return { service, templates, childProcess, types };
};

describe("DefaultRunnerInstallationService", () => {
  it("createRunner writes the runner project and publishes testrunner.installed", async () => {
    const { service, templates, types } = build();
    const result = await service.createRunner(DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.runnerPath).toBe(".testrunner");
    expect(templates.requests[0].targetPath).toBe(".testrunner");
    expect(types()).toContain("testrunner.installed");
  });

  it("createRunner surfaces a template write failure", async () => {
    const { service, templates } = build();
    templates.fail = true;
    const result = await service.createRunner(DEFAULT_SETTINGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INIT_FAILED");
  });

  it("installDependencies runs the install command in the runner cwd", async () => {
    const { service, childProcess } = build();
    const result = await service.installDependencies(DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    expect(childProcess.calls[0].command).toBe(DEFAULT_SETTINGS.runner.installCommand);
    expect(childProcess.calls[0].cwd).toBe("/vault/.testrunner");
  });

  it("installDependencies maps a non-zero exit to NPM_INSTALL_FAILED", async () => {
    const { service, childProcess } = build();
    childProcess.exitCodes.set("npm install", 1);
    const result = await service.installDependencies(DEFAULT_SETTINGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NPM_INSTALL_FAILED");
  });

  it("installBrowsers maps a non-zero exit to BROWSER_NOT_INSTALLED", async () => {
    const { service, childProcess } = build();
    childProcess.exitCodes.set("playwright install", 1);
    const result = await service.installBrowsers(DEFAULT_SETTINGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BROWSER_NOT_INSTALLED");
  });

  it("refuses to spawn a command flagged by the safety policy", async () => {
    const { service, childProcess } = build();
    const tampered: TestHubSettings = {
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, installCommand: "npm install && rm -rf /" },
    };
    const result = await service.installDependencies(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COMMAND_DISALLOWED");
    expect(childProcess.calls).toHaveLength(0); // never spawned
  });
});

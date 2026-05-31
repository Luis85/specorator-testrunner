import { describe, expect, it } from "vitest";
import { DefaultEnvironmentValidationService } from "../src/application/services/environment-validation-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
  recordingEventBus,
} from "./fakes";

const ENV = { HOME: "/home/u" };

const build = (env: Record<string, string | undefined> = ENV) => {
  const absoluteFs = new FakeAbsoluteFileSystem();
  const childProcess = new FakeChildProcessRunner();
  const { bus, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const service = new DefaultEnvironmentValidationService(
    settings,
    childProcess,
    absoluteFs,
    new DefaultCommandSafetyPolicy(),
    bus,
    env,
    "linux",
  );
  return { service, absoluteFs, childProcess, types };
};

const markFullyInstalled = (absoluteFs: FakeAbsoluteFileSystem) => {
  absoluteFs.existing.add("/vault/.testrunner");
  absoluteFs.existing.add("/vault/.testrunner/package.json");
  absoluteFs.existing.add("/vault/.testrunner/node_modules");
  absoluteFs.existing.add("/home/u/.cache/ms-playwright");
};

describe("DefaultEnvironmentValidationService", () => {
  it("reports a healthy environment as valid with no issues", async () => {
    const { service, absoluteFs, types } = build();
    markFullyInstalled(absoluteFs);

    const result = await service.validateEnvironment();

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.browsersInstalled).toBe(true);
    expect(types()).toContain("testrunner.validated");
  });

  it("flags every missing component (UC-002 checks)", async () => {
    const { service, childProcess } = build();
    childProcess.exitCodes.set("node --version", 1);
    childProcess.exitCodes.set("npm --version", 1);

    const result = await service.validateEnvironment();

    expect(result.valid).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "NODE_MISSING",
        "NPM_MISSING",
        "RUNNER_MISSING_FILE",
        "DEPENDENCIES_MISSING",
        "BROWSER_NOT_INSTALLED",
      ]),
    );
  });

  it("is invalid when node_modules exists but Playwright is not runnable", async () => {
    const { service, absoluteFs, childProcess } = build();
    markFullyInstalled(absoluteFs);
    childProcess.exitCodes.set("npx playwright --version", 1);

    const result = await service.validateEnvironment();

    expect(result.dependenciesInstalled).toBe(true);
    expect(result.playwrightAvailable).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.code === "PLAYWRIGHT_MISSING")?.severity).toBe("error");
  });

  it("does not probe Playwright until dependencies are installed", async () => {
    const { service, absoluteFs, childProcess } = build();
    absoluteFs.existing.add("/vault/.testrunner");
    absoluteFs.existing.add("/vault/.testrunner/package.json");
    // no node_modules
    await service.validateEnvironment();
    expect(childProcess.calls.map((c) => c.command)).not.toContain("npx playwright --version");
  });

  it("detects browsers in Playwright hermetic mode (PLAYWRIGHT_BROWSERS_PATH=0)", async () => {
    const { service, absoluteFs } = build({ HOME: "/home/u", PLAYWRIGHT_BROWSERS_PATH: "0" });
    absoluteFs.existing.add("/vault/.testrunner");
    absoluteFs.existing.add("/vault/.testrunner/package.json");
    absoluteFs.existing.add("/vault/.testrunner/node_modules");
    absoluteFs.existing.add("/vault/.testrunner/node_modules/playwright-core/.local-browsers");

    const result = await service.validateEnvironment();

    expect(result.browsersInstalled).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("validateCiReadiness reports the missing workflow", async () => {
    const { service, absoluteFs } = build();
    markFullyInstalled(absoluteFs);
    const result = await service.validateCiReadiness(DEFAULT_SETTINGS);
    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("CI workflow"))).toBe(true);
  });
});

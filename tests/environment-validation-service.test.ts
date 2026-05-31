import { describe, expect, it } from "vitest";
import { DefaultEnvironmentValidationService } from "../src/application/services/environment-validation-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import {
  REQUIRED_RUNNER_DEPENDENCIES,
  VALIDATED_RUNNER_FILES,
} from "../src/application/content/runner-templates";
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

const addManagedFiles = (absoluteFs: FakeAbsoluteFileSystem) => {
  absoluteFs.existing.add("/vault/.testrunner");
  for (const file of VALIDATED_RUNNER_FILES) {
    absoluteFs.existing.add(`/vault/.testrunner/${file}`);
  }
};

const addDependencies = (absoluteFs: FakeAbsoluteFileSystem) => {
  absoluteFs.existing.add("/vault/.testrunner/node_modules");
  for (const dep of REQUIRED_RUNNER_DEPENDENCIES) {
    absoluteFs.existing.add(`/vault/.testrunner/${dep}`);
  }
};

const markFullyInstalled = (absoluteFs: FakeAbsoluteFileSystem) => {
  addManagedFiles(absoluteFs);
  addDependencies(absoluteFs);
  absoluteFs.existing.add("/home/u/.cache/ms-playwright/chromium-1148/chrome-linux/chrome");
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
    expect(childProcess.calls.map((c) => c.args.join(" "))).not.toContain("npx playwright --version");
  });

  it("is invalid when a managed runner file is missing even if deps/browser are present", async () => {
    const { service, absoluteFs } = build();
    markFullyInstalled(absoluteFs);
    absoluteFs.existing.delete("/vault/.testrunner/cucumber.mjs");

    const result = await service.validateEnvironment();

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === "RUNNER_MISSING_FILE" && i.message.includes("cucumber.mjs"),
      ),
    ).toBe(true);
  });

  it("is invalid when node_modules exists but Cucumber/tsx are missing", async () => {
    const { service, absoluteFs } = build();
    markFullyInstalled(absoluteFs);
    absoluteFs.existing.delete("/vault/.testrunner/node_modules/tsx");

    const result = await service.validateEnvironment();

    expect(result.dependenciesInstalled).toBe(false);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === "DEPENDENCIES_MISSING" && i.message.includes("tsx")),
    ).toBe(true);
  });

  it("detects browsers in Playwright hermetic mode (PLAYWRIGHT_BROWSERS_PATH=0)", async () => {
    const { service, absoluteFs } = build({ HOME: "/home/u", PLAYWRIGHT_BROWSERS_PATH: "0" });
    addManagedFiles(absoluteFs);
    addDependencies(absoluteFs);
    absoluteFs.existing.add(
      "/vault/.testrunner/node_modules/playwright-core/.local-browsers/chromium-1148/chrome",
    );

    const result = await service.validateEnvironment();

    expect(result.browsersInstalled).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("does not count a cache that lacks Chromium (e.g. Firefox-only/partial)", async () => {
    const { service, absoluteFs } = build();
    addManagedFiles(absoluteFs);
    addDependencies(absoluteFs);
    absoluteFs.existing.add("/home/u/.cache/ms-playwright/firefox-1234/firefox");

    const result = await service.validateEnvironment();

    expect(result.browsersInstalled).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "BROWSER_NOT_INSTALLED")).toBe(true);
  });

  it("validateCiReadiness reports the missing workflow", async () => {
    const { service, absoluteFs } = build();
    markFullyInstalled(absoluteFs);
    const result = await service.validateCiReadiness(DEFAULT_SETTINGS);
    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("CI workflow"))).toBe(true);
  });

  it("validateCiReadiness lists package.json, lockfile and workflow when nothing exists (US-041)", async () => {
    const { service } = build();
    const result = await service.validateCiReadiness(DEFAULT_SETTINGS);
    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("package.json"))).toBe(true);
    expect(result.missingItems.some((m) => m.includes("package-lock.json"))).toBe(true);
    expect(result.missingItems.some((m) => m.includes("CI workflow"))).toBe(true);
  });

  it("validateCiReadiness is ready when runner, lockfile and workflow are present (UC-020)", async () => {
    const { service, absoluteFs, types } = build();
    absoluteFs.existing.add("/vault/.testrunner");
    absoluteFs.existing.add("/vault/.testrunner/package.json");
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const result = await service.validateCiReadiness(DEFAULT_SETTINGS);

    expect(result.ready).toBe(true);
    expect(result.missingItems).toHaveLength(0);
    expect(types()).toContain("ci.readiness.checked");
  });

  it("validateCiReadiness warns about committed node_modules and an empty BASE_URL", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.existing.add("/vault/.testrunner");
    absoluteFs.existing.add("/vault/.testrunner/package.json");
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add("/vault/.testrunner/node_modules");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const settings = {
      ...DEFAULT_SETTINGS,
      sut: {
        active: "demo",
        environments: { demo: { baseUrl: "" } },
      },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(true);
    expect(result.warnings.some((w) => w.includes("node_modules"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("E2E_BASE_URL"))).toBe(true);
  });
});

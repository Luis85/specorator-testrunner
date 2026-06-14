import { describe, expect, it } from "vitest";
import { DefaultEnvironmentValidationService } from "../src/application/services/environment-validation-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import {
  REQUIRED_RUNNER_DEPENDENCIES,
  VALIDATED_RUNNER_FILES,
  testrunnerManifestContent,
} from "../src/application/content/runner-manifest";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
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

/** Seeds an otherwise-healthy runner's files, deps and browser cache WITHOUT
 *  the manifest — the base for the manifest-advisory cases (absent/older/newer)
 *  that seed their own manifest content (or none). */
const markHealthyRunnerWithoutManifest = (absoluteFs: FakeAbsoluteFileSystem) => {
  addManagedFiles(absoluteFs);
  addDependencies(absoluteFs);
  absoluteFs.existing.add("/home/u/.cache/ms-playwright/chromium-1148/chrome-linux/chrome");
};

const markFullyInstalled = (absoluteFs: FakeAbsoluteFileSystem) => {
  markHealthyRunnerWithoutManifest(absoluteFs);
  // Seed the CURRENT manifest content so an otherwise-healthy runner does not
  // emit a spurious RUNNER_MANIFEST_OUTDATED advisory.
  absoluteFs.seed("/vault/.testrunner/testrunner-manifest.json", testrunnerManifestContent());
};

/** Seeds the managed runner files the CI readiness check requires (except
 *  package.json, which callers seed with content for the test:ci check). */
const seedManagedRunnerFiles = (
  absoluteFs: FakeAbsoluteFileSystem,
  runnerDir = "/vault/.testrunner",
) => {
  absoluteFs.existing.add(runnerDir);
  for (const file of VALIDATED_RUNNER_FILES) {
    if (file === "package.json") continue;
    absoluteFs.existing.add(`${runnerDir}/${file}`);
  }
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
    expect(childProcess.calls.map((c) => c.args.join(" "))).not.toContain(
      "npx playwright --version",
    );
  });

  it("is invalid when a managed runner file is missing even if deps/browser are present", async () => {
    const { service, absoluteFs } = build();
    markFullyInstalled(absoluteFs);
    absoluteFs.existing.delete("/vault/.testrunner/playwright.config.ts");

    const result = await service.validateEnvironment();

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === "RUNNER_MISSING_FILE" && i.message.includes("playwright.config.ts"),
      ),
    ).toBe(true);
  });

  it("flags a RUNNER_MANIFEST_OUTDATED advisory when the manifest is absent", async () => {
    const { service, absoluteFs } = build();
    // Healthy runner, but no manifest content seeded → reader sees undefined.
    markHealthyRunnerWithoutManifest(absoluteFs);

    const result = await service.validateEnvironment();

    expect(result.issues.some((i) => i.code === "RUNNER_MANIFEST_OUTDATED")).toBe(true);
  });

  it("flags a RUNNER_MANIFEST_OUTDATED advisory when the manifest is older", async () => {
    const { service, absoluteFs } = build();
    markHealthyRunnerWithoutManifest(absoluteFs);
    absoluteFs.seed("/vault/.testrunner/testrunner-manifest.json", '{"manifestVersion": 0}');

    const result = await service.validateEnvironment();

    expect(result.issues.some((i) => i.code === "RUNNER_MANIFEST_OUTDATED")).toBe(true);
  });

  it("flags a RUNNER_MANIFEST_OUTDATED advisory when the runner is stamped at version 2 (previous version)", async () => {
    const { service, absoluteFs } = build();
    markHealthyRunnerWithoutManifest(absoluteFs);
    absoluteFs.seed("/vault/.testrunner/testrunner-manifest.json", '{"manifestVersion": 2}');

    const result = await service.validateEnvironment();

    expect(result.issues.some((i) => i.code === "RUNNER_MANIFEST_OUTDATED")).toBe(true);
  });

  it("flags a RUNNER_MANIFEST_OUTDATED advisory when the manifest is newer", async () => {
    const { service, absoluteFs } = build();
    markHealthyRunnerWithoutManifest(absoluteFs);
    absoluteFs.seed("/vault/.testrunner/testrunner-manifest.json", '{"manifestVersion": 99}');

    const result = await service.validateEnvironment();

    expect(result.issues.some((i) => i.code === "RUNNER_MANIFEST_OUTDATED")).toBe(true);
  });

  it("does not flag the manifest, and stays valid, when it carries the current version", async () => {
    const { service, absoluteFs } = build();
    markFullyInstalled(absoluteFs);

    const result = await service.validateEnvironment();

    expect(result.issues.some((i) => i.code === "RUNNER_MANIFEST_OUTDATED")).toBe(false);
    expect(result.valid).toBe(true);
  });

  it("is invalid when node_modules exists but playwright-bdd/Playwright are missing", async () => {
    const { service, absoluteFs } = build();
    markFullyInstalled(absoluteFs);
    absoluteFs.existing.delete("/vault/.testrunner/node_modules/playwright-bdd");

    const result = await service.validateEnvironment();

    expect(result.dependenciesInstalled).toBe(false);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === "DEPENDENCIES_MISSING" && i.message.includes("playwright-bdd"),
      ),
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

  it("validates browsers installed when every selected browser is cached (firefox-only)", async () => {
    // settings.runner.browsers = ["firefox"]; cache lists e.g. ["firefox-1438"]
    const { absoluteFs, childProcess, types } = build();
    const { bus } = recordingEventBus();
    const store = new FakeDataStore({ runner: { browsers: ["firefox"] } });
    const settingsService = new DefaultSettingsService(store, new DefaultPathSafetyPolicy(), bus);
    const svc = new DefaultEnvironmentValidationService(
      settingsService,
      childProcess,
      absoluteFs,
      new DefaultCommandSafetyPolicy(),
      recordingEventBus().bus,
      ENV,
      "linux",
    );
    addManagedFiles(absoluteFs);
    addDependencies(absoluteFs);
    absoluteFs.existing.add("/home/u/.cache/ms-playwright/firefox-1438/firefox");

    const result = await svc.validateEnvironment();

    expect(result.browsersInstalled).toBe(true);
    void types; // consumed by other tests via build()
  });

  it("reports browsers missing when a selected browser is absent (firefox selected, only chromium cached)", async () => {
    // settings.runner.browsers = ["firefox"]; cache lists ["chromium-1124"]
    const { absoluteFs, childProcess } = build();
    const store = new FakeDataStore({ runner: { browsers: ["firefox"] } });
    const settingsService = new DefaultSettingsService(
      store,
      new DefaultPathSafetyPolicy(),
      recordingEventBus().bus,
    );
    const svc = new DefaultEnvironmentValidationService(
      settingsService,
      childProcess,
      absoluteFs,
      new DefaultCommandSafetyPolicy(),
      recordingEventBus().bus,
      ENV,
      "linux",
    );
    addManagedFiles(absoluteFs);
    addDependencies(absoluteFs);
    absoluteFs.existing.add("/home/u/.cache/ms-playwright/chromium-1124/chrome-linux/chrome");

    const result = await svc.validateEnvironment();

    expect(result.browsersInstalled).toBe(false);
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

  it("validateCiReadiness flags a package.json without a test:ci script (UC-020)", async () => {
    const { service, absoluteFs } = build();
    absoluteFs.existing.add("/vault/.testrunner");
    absoluteFs.seed("/vault/.testrunner/package.json", JSON.stringify({ scripts: { test: "x" } }));
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const result = await service.validateCiReadiness(DEFAULT_SETTINGS);
    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("test:ci"))).toBe(true);
  });

  it("validateCiReadiness is ready when runner, lockfile, test:ci script and workflow are present (UC-020)", async () => {
    const { service, absoluteFs, types } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "cucumber-js" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const result = await service.validateCiReadiness(DEFAULT_SETTINGS);

    expect(result.ready).toBe(true);
    expect(result.missingItems).toHaveLength(0);
    expect(types()).toContain("ci.readiness.checked");
  });

  it("validateCiReadiness finds the workflow when workflowPath uses Windows separators", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    // Generation normalizes `\`→`/`, so the file lives at the POSIX path.
    absoluteFs.existing.add("/vault/.github/workflows/e2e.yml");

    const settings = {
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, workflowPath: ".github\\workflows\\e2e.yml" },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.missingItems.some((m) => m.includes("CI workflow"))).toBe(false);
    expect(result.ready).toBe(true);
  });

  it("validateCiReadiness normalizes a Windows-separator testRunnerPath", async () => {
    const { service, absoluteFs } = build();
    // Files exist at the POSIX path a CI checkout uses.
    seedManagedRunnerFiles(absoluteFs, "/vault/e2e/runner");
    absoluteFs.seed(
      "/vault/e2e/runner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/e2e/runner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const settings = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath: vp("e2e\\runner") },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.missingItems).toHaveLength(0);
    expect(result.ready).toBe(true);
  });

  it("validateCiReadiness warns to set repository secrets for configured auth keys (ADR-0014)", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const settings = {
      ...DEFAULT_SETTINGS,
      sut: {
        active: "prod",
        environments: {
          demo: { baseUrl: "https://demo", auth: { env: { API_TOKEN: "x" } } },
          prod: {
            baseUrl: "https://prod",
            auth: { env: { BASIC_AUTH_USER: "u", API_TOKEN: "y" } },
          },
        },
      },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(true);
    const secretWarning = result.warnings.find((w) => w.includes("repository secrets"));
    expect(secretWarning).toBeDefined();
    // Union across environments, deduped + sorted.
    expect(secretWarning).toContain("API_TOKEN");
    expect(secretWarning).toContain("BASIC_AUTH_USER");
  });

  it("validateCiReadiness rejects a traversal workflowPath like generation does", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");

    const settings = {
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, workflowPath: "../../outside/e2e.yml" },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("invalid"))).toBe(true);
  });

  it("validateCiReadiness checks the script named by a configured ciRunCommand", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    // package.json provides only test:ci, but CI is configured to run e2e:ci.
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const settings = {
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, ciRunCommand: "npm run e2e:ci" },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("e2e:ci"))).toBe(true);
  });

  it("validateCiReadiness still requires a lockfile for an npm ci variant", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    // No package-lock.json.
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const settings = {
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, ciInstallCommand: "npm ci --no-audit" },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("package-lock"))).toBe(true);
  });

  it("validateCiReadiness does not require a lockfile when the install command omits one", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    // No package-lock.json present.
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const settings = {
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, ciInstallCommand: "npm install --no-package-lock" },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(true);
    expect(result.missingItems.some((m) => m.includes("package-lock"))).toBe(false);
  });

  it("validateCiReadiness is not ready for a non-github-actions provider", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    const settings = {
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, provider: "none" as const },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("provider"))).toBe(true);
  });

  it("validateCiReadiness flags a CI command Generate CI Workflow would reject", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed("/vault/.testrunner/package.json", JSON.stringify({ name: "runner" }));
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    // `npx cucumber-js ...` is not an npm ci/run shape, so Generate CI Workflow
    // refuses it — readiness must flag it rather than green-light a config the
    // generator can't produce.
    const settings = {
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, ciRunCommand: "npx cucumber-js --config cucumber.mjs" },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(false);
    expect(
      result.missingItems.some((m) => m.includes("not supported by Generate CI Workflow")),
    ).toBe(true);
  });

  it("validateCiReadiness is not ready when a managed runner file (playwright.config.ts) is missing", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);
    // A damaged runner missing the Playwright config the test:ci script needs.
    absoluteFs.existing.delete("/vault/.testrunner/playwright.config.ts");

    const result = await service.validateCiReadiness(DEFAULT_SETTINGS);

    expect(result.ready).toBe(false);
    expect(result.missingItems.some((m) => m.includes("playwright.config.ts"))).toBe(true);
  });

  it("validateCiReadiness always warns to set E2E_BASE_URL even with a local base URL", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
    absoluteFs.existing.add("/vault/.testrunner/package-lock.json");
    absoluteFs.existing.add(`/vault/${DEFAULT_SETTINGS.ci.workflowPath}`);

    // Active env HAS a non-empty local baseUrl — CI still reads from the repo var.
    const settings = {
      ...DEFAULT_SETTINGS,
      sut: { active: "demo", environments: { demo: { baseUrl: "https://example.test" } } },
    };
    const result = await service.validateCiReadiness(settings);

    expect(result.ready).toBe(true);
    expect(result.warnings.some((w) => w.includes("E2E_BASE_URL"))).toBe(true);
  });

  it("validateCiReadiness warns about committed node_modules and an empty BASE_URL", async () => {
    const { service, absoluteFs } = build();
    seedManagedRunnerFiles(absoluteFs);
    absoluteFs.seed(
      "/vault/.testrunner/package.json",
      JSON.stringify({ scripts: { "test:ci": "x" } }),
    );
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

import { describe, expect, it } from "vitest";
import { DefaultDemoContentService } from "../src/application/services/demo-content-service";
import { DefaultDocumentationGenerationService } from "../src/application/services/documentation-generation-service";
import { DefaultEnvironmentValidationService } from "../src/application/services/environment-validation-service";
import { DefaultInitializationService } from "../src/application/services/initialization-service";
import { DefaultMaintenanceService } from "../src/application/services/maintenance-service";
import { DefaultRunnerInstallationService } from "../src/application/services/runner-installation-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { DefaultSuiteService } from "../src/application/services/suite-service";
import {
  DefaultTestExecutionService,
  type MaintenanceLock,
} from "../src/application/services/test-execution-service";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import {
  REQUIRED_RUNNER_DEPENDENCIES,
  testrunnerManifestContent,
} from "../src/application/content/runner-manifest";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
  FakePrdLookup,
  FakeTemplateWriter,
  FakeVaultFileSystem,
  recordingEventBus,
  serviceHarness,
  silentLogger,
} from "./fakes";

const build = () => {
  const absoluteFs = new FakeAbsoluteFileSystem();
  const childProcess = new FakeChildProcessRunner();
  const templates = new FakeTemplateWriter();
  const commandSafety = new DefaultCommandSafetyPolicy();
  const { bus, types, settings } = serviceHarness();
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
  // Seed the CURRENT manifest so validateEnvironment() does not push a stale
  // RUNNER_MANIFEST_OUTDATED warning that would itself trigger a reinstall.
  // Pass the default browsers so the stamped selection matches what the default
  // settings service reports (browsers stamp is now required by US-055).
  absoluteFs.seed(
    "/vault/.testrunner/testrunner-manifest.json",
    testrunnerManifestContent(DEFAULT_SETTINGS.runner.browsers),
  );
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

  it("reinstalls dependencies on a manifest-version mismatch even when deps are healthy", async () => {
    const { service, absoluteFs, childProcess } = build();
    seedHealthyRunner(absoluteFs);
    // Overwrite the current manifest seeded above with a STALE one so
    // validateEnvironment() flags RUNNER_MANIFEST_OUTDATED before createRunner.
    absoluteFs.seed("/vault/.testrunner/testrunner-manifest.json", '{"manifestVersion": 0}');

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reinstalledPackages).toBe(true);
    expect(childProcess.calls.map((c) => c.args.join(" "))).toContain("npm install");
  });

  it("does NOT npm-install on a browser-only change (current version, browser drift) — repair stays green offline (codex P2)", async () => {
    const { service, absoluteFs, childProcess } = build();
    seedHealthyRunner(absoluteFs);
    // Current-version manifest, but the stamped browser set differs from settings
    // (default ["chromium"]) → RUNNER_BROWSERS_OUTDATED, NOT a version mismatch.
    absoluteFs.seed(
      "/vault/.testrunner/testrunner-manifest.json",
      JSON.stringify({ manifestVersion: 3, browsers: ["firefox"] }),
    );
    // npm install would FAIL (e.g. offline) — proving a browser-only repair never
    // calls it. Before the fix, browser drift reused RUNNER_MANIFEST_OUTDATED, so
    // repair force-ran npm install and errored here before installing browsers.
    childProcess.exitCodes.set("npm install", 1);

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reinstalledPackages).toBe(false);
    const commands = childProcess.calls.map((c) => c.args.join(" "));
    expect(commands).not.toContain("npm install");
    // The browser matrix is still (re)installed by repair's unconditional pass.
    expect(result.value.reinstalledBrowsers).toBe(true);
    expect(commands).toContain("npx playwright install chromium");
  });

  it("regenerates managed files on a manifest-version bump and preserves the user's overwrite:false steps/pages (no migration)", async () => {
    const { service, absoluteFs, childProcess } = build();
    seedHealthyRunner(absoluteFs);
    // A runner stamped at a PREVIOUS version: the bump flags RUNNER_MANIFEST_OUTDATED
    // → repair regenerates managed files + reinstalls deps. Clean-slate: there is no
    // cross-runtime clean-cut, so the user's overwrite:false steps/pages survive.
    absoluteFs.seed("/vault/.testrunner/testrunner-manifest.json", '{"manifestVersion": 2}');
    absoluteFs.seed(
      "/vault/.testrunner/src/steps/example.steps.ts",
      "// user-edited steps — must survive",
    );
    absoluteFs.seed(
      "/vault/.testrunner/src/pages/ExamplePage.ts",
      "// user-edited page object — must survive",
    );

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A version mismatch regenerates + reinstalls (the managed shape may have changed).
    expect(result.value.reinstalledPackages).toBe(true);
    expect(childProcess.calls.map((c) => c.args.join(" "))).toContain("npm install");
    // The user's own files are never deleted.
    expect(await absoluteFs.existsAbsolute("/vault/.testrunner/src/steps/example.steps.ts")).toBe(
      true,
    );
    expect(await absoluteFs.existsAbsolute("/vault/.testrunner/src/pages/ExamplePage.ts")).toBe(
      true,
    );
  });

  it("a healthy current-version runner: regenerates managed files, reinstalls nothing, deletes nothing", async () => {
    const { service, absoluteFs, templates } = build();
    seedHealthyRunner(absoluteFs);
    // The CURRENT manifest is already seeded by seedHealthyRunner. Seed an extra
    // file to prove repair never deletes files it does not manage.
    absoluteFs.seed("/vault/.testrunner/extra-user-file.ts", "should survive a healthy repair");

    const result = await service.repair();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reinstalledPackages).toBe(false);
    expect(await absoluteFs.existsAbsolute("/vault/.testrunner/extra-user-file.ts")).toBe(true);
    expect(templates.requests).toHaveLength(1);
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

/**
 * Full UC-024 reset wiring: a real InitializationService + a real
 * DefaultTestExecutionService (for its synchronous maintenance lock), so the
 * tests exercise the actual event chain, deletion scope, and TOCTOU close.
 */
const buildReset = (
  opts: {
    /** Injected post-run settle hook (PostRunCoordinator.whenSettled). */
    whenPostRunSettled?: () => Promise<void>;
    /** Injected execution-log settle hook (ExecutionLogService.whenSettled). */
    whenExecutionLogSettled?: () => Promise<void>;
    /** Wraps the execution service's lock, e.g. to record acquisition order. */
    wrapLock?: (lock: MaintenanceLock) => MaintenanceLock;
  } = {},
) => {
  const vault = new FakeVaultFileSystem();
  const absoluteFs = new FakeAbsoluteFileSystem();
  const childProcess = new FakeChildProcessRunner();
  const templates = new FakeTemplateWriter();
  const commandSafety = new DefaultCommandSafetyPolicy();
  const pathSafety = new DefaultPathSafetyPolicy();
  const { bus, types, events } = recordingEventBus();
  const settings = new DefaultSettingsService(new FakeDataStore(), pathSafety, bus);
  const docs = new DefaultDocumentationGenerationService(settings, vault, bus);
  const suites = new DefaultSuiteService(settings, vault, bus);
  const demo = new DefaultDemoContentService(settings, vault, bus);
  const useCaseService = new DefaultUseCaseService(
    settings,
    vault,
    bus,
    silentLogger,
    new FakePrdLookup(),
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
  const initialization = new DefaultInitializationService(
    settings,
    vault,
    docs,
    suites,
    demo,
    runnerInstall,
    validation,
    pathSafety,
    bus,
    silentLogger,
  );
  const execution = new DefaultTestExecutionService(
    settings,
    suites,
    useCaseService,
    childProcess,
    absoluteFs,
    commandSafety,
    bus,
    silentLogger,
  );
  const activeRun = {
    activeRunId: () => execution.activeRunId(),
    whenActiveSettles: () => execution.whenActiveSettles(),
  };
  const lock = opts.wrapLock ? opts.wrapLock(execution.maintenanceLock) : execution.maintenanceLock;
  const service = new DefaultMaintenanceService(
    settings,
    validation,
    runnerInstall,
    bus,
    silentLogger,
    activeRun,
    initialization,
    vault,
    lock,
    opts.whenPostRunSettled,
    opts.whenExecutionLogSettled,
  );
  return { service, vault, absoluteFs, execution, types, events, settings };
};

describe("DefaultMaintenanceService.reset (UC-024)", () => {
  it("emits settings.reset then the full init chain under one shared correlationId", async () => {
    const { service, types, events } = buildReset();

    const result = await service.reset();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const emitted = types();
    const resetIdx = emitted.indexOf("settings.reset");
    const startedIdx = emitted.indexOf("testhub.initialization.started");
    const completedIdx = emitted.indexOf("testhub.initialization.completed");
    // Order per Event Catalog §14: settings.reset → init.started → … → completed.
    expect(resetIdx).toBeGreaterThanOrEqual(0);
    expect(startedIdx).toBeGreaterThan(resetIdx);
    expect(completedIdx).toBeGreaterThan(startedIdx);
    expect(emitted).not.toContain("testhub.initialization.failed");

    // One reset-invocation correlationId across the whole chain (§19).
    const correlationId = result.value.correlationId;
    expect(correlationId).toBeTruthy();
    const flowTypes = new Set([
      "settings.reset",
      "testhub.initialization.started",
      "documentation.generated",
      "suite.created",
      "testrunner.installed",
      "testrunner.validated",
      "testhub.initialization.completed",
    ]);
    const flowEvents = events.filter((e) => flowTypes.has(e.type));
    expect(flowEvents.length).toBeGreaterThan(4);
    for (const event of flowEvents) {
      expect(event.correlationId).toBe(correlationId);
    }
  });

  it("refuses to reset (no deletion) when testRunnerPath overlaps user content (review M1)", async () => {
    const { service, vault, settings } = buildReset();
    // A tampered/synced data.json repoints the runner folder at a user-content
    // folder. "Use Cases" passes PathSafetyPolicy (no traversal/injection), so
    // only the reset target-guard can stop the recursive delete from eating it.
    const tampered = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath: vp("Use Cases") },
    };
    expect((await settings.save(tampered)).ok).toBe(true);
    vault.files.set("Use Cases/UC-099.md", "user-authored use case");

    const result = await service.reset();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PATH_UNSAFE");
    // Nothing was deleted — user content survives.
    expect(vault.files.get("Use Cases/UC-099.md")).toBe("user-authored use case");
  });

  it("refuses to reset when testRunnerPath overlaps Story Maps content", async () => {
    const { service, vault, settings } = buildReset();
    const tampered = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath: vp("Story Maps") },
    };
    expect((await settings.save(tampered)).ok).toBe(true);
    vault.files.set("Story Maps/SM-001-x/SM-001-x.md", "user-authored story map");

    const result = await service.reset();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PATH_UNSAFE");
    expect(vault.files.get("Story Maps/SM-001-x/SM-001-x.md")).toBe("user-authored story map");
  });

  it("refuses to reset when testRunnerPath overlaps Personas content", async () => {
    const { service, vault, settings } = buildReset();
    const tampered = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath: vp("Personas") },
    };
    expect((await settings.save(tampered)).ok).toBe(true);
    vault.files.set("Personas/persona-001.md", "user-authored persona");

    const result = await service.reset();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PATH_UNSAFE");
    expect(vault.files.get("Personas/persona-001.md")).toBe("user-authored persona");
  });

  it("refuses dot-segment runner paths that normalize onto user content (review)", async () => {
    // `./Use Cases` and `.` pass PathSafetyPolicy and the vault adapter would
    // normalize the leading `./` away before deleting, so the overlap guard must
    // collapse `.` segments too or it deletes user content / the whole vault.
    for (const hostile of ["./Use Cases", "Use Cases/.", "."]) {
      const { service, vault, settings } = buildReset();
      expect(
        (
          await settings.save({
            ...DEFAULT_SETTINGS,
            paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath: vp(hostile) },
          })
        ).ok,
      ).toBe(true);
      vault.files.set("Use Cases/UC-099.md", "user-authored use case");

      const result = await service.reset();

      expect(result.ok, hostile).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("PATH_UNSAFE");
      expect(vault.files.get("Use Cases/UC-099.md")).toBe("user-authored use case");
    }
  });

  it("removes the regenerable .testrunner runtime and re-creates defaults", async () => {
    const { service, vault } = buildReset();
    // Seed a stale runner artefact + user-authored business content.
    await vault.createFolder(vp(".testrunner"));
    vault.files.set(".testrunner/cucumber.mjs", "stale generated config");
    vault.files.set(".testrunner/src/steps/old.ts", "stale stub");
    vault.files.set("Use Cases/UC-099.md", "user-authored use case");
    vault.files.set("Specifications/features/UC-099.feature", "user feature");
    vault.files.set("Test Evidence/RUN-old.md", "audit evidence");

    const result = await service.reset();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The stale runner runtime is gone (only the runner folder is destructive).
    expect(vault.files.has(".testrunner/cucumber.mjs")).toBe(false);
    expect(vault.files.has(".testrunner/src/steps/old.ts")).toBe(false);
    expect(result.value.deletedFolders).toEqual([".testrunner"]);

    // User-authored business content is preserved (conservative deletion scope).
    expect(vault.files.get("Use Cases/UC-099.md")).toBe("user-authored use case");
    expect(vault.files.get("Specifications/features/UC-099.feature")).toBe("user feature");
    expect(vault.files.get("Test Evidence/RUN-old.md")).toBe("audit evidence");

    // Defaults were re-created (folders + documentation + suites + runner files).
    expect(vault.folders.has("Use Cases")).toBe(true);
    expect(vault.files.has("Test Hub/Getting Started.md")).toBe(true);
    expect(result.value.recreatedFiles.length).toBeGreaterThan(0);
  });

  it("restores default settings as part of the reset", async () => {
    const { service, settings } = buildReset();
    // Mutate settings away from defaults first.
    const loaded = await settings.load();
    await settings.save({ ...loaded, ci: { ...loaded.ci, nodeVersion: "99" } });

    const result = await service.reset();
    expect(result.ok).toBe(true);

    const after = await settings.load();
    expect(after.ci.nodeVersion).not.toBe("99");
  });

  it("refuses to reset while a test run is active and mutates nothing (P0-3 / TOCTOU)", async () => {
    const { service, vault, execution } = buildReset();
    vault.files.set(".testrunner/cucumber.mjs", "stale generated config");
    // Reserve the active-run slot synchronously via the lock (a live run holds it).
    const lock = execution.maintenanceLock;
    // Simulate an active run by beginning maintenance is the wrong direction;
    // instead start a run and let it register. Use a never-resolving runner.
    const beginResult = lock.begin();
    expect(beginResult.ok).toBe(true); // no run yet → maintenance can begin
    lock.end();

    // Now actually start a run so activeRunId() !== null when reset runs.
    void execution.execute({ scope: "demo", target: "demo" });
    for (let i = 0; i < 100 && execution.activeRunId() === null; i++) {
      await Promise.resolve();
    }
    expect(execution.activeRunId()).not.toBeNull();

    const result = await service.reset();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUN_IN_PROGRESS");
    // Nothing deleted: the stale runner config survives the refused reset.
    expect(vault.files.has(".testrunner/cucumber.mjs")).toBe(true);

    const activeId = execution.activeRunId();
    if (activeId) await execution.cancel(activeId).catch(() => undefined);
    await execution.whenActiveSettles().catch(() => undefined);
  });

  it("drains the post-run evidence chain AFTER lock acquisition and BEFORE deletion", async () => {
    // Evidence writes outlive the active-run slot (the coordinator updates Use
    // Case frontmatter after the slot frees), so reset() must await the injected
    // settle hook INSIDE the lock (no new run can start) and before the
    // destructive delete — observable via call-order recording.
    const order: string[] = [];
    const env = buildReset({
      whenPostRunSettled: async () => {
        order.push("post-run-settled");
      },
      whenExecutionLogSettled: async () => {
        order.push("execution-log-settled");
      },
      wrapLock: (lock) => ({
        inProgress: () => lock.inProgress(),
        begin: () => {
          order.push("lock-acquired");
          return lock.begin();
        },
        end: () => {
          order.push("lock-released");
          lock.end();
        },
      }),
    });
    env.vault.files.set(".testrunner/cucumber.mjs", "stale generated config");
    const realDelete = env.vault.deleteFolder.bind(env.vault);
    env.vault.deleteFolder = async (path) => {
      order.push("delete-runner");
      return realDelete(path);
    };

    const result = await env.service.reset();

    expect(result.ok).toBe(true);
    expect(order.indexOf("lock-acquired")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("post-run-settled")).toBeGreaterThan(order.indexOf("lock-acquired"));
    // The execution-log write queue drains under the lock too, before the
    // destructive delete — so a late log write cannot re-materialise
    // `<runner>/history` after the runtime is removed (ADR-0032).
    expect(order.indexOf("execution-log-settled")).toBeGreaterThan(order.indexOf("lock-acquired"));
    expect(order.indexOf("delete-runner")).toBeGreaterThan(order.indexOf("execution-log-settled"));
    expect(order[order.length - 1]).toBe("lock-released");
  });

  it("repair() also drains the post-run evidence chain under the lock", async () => {
    const order: string[] = [];
    const env = buildReset({
      whenPostRunSettled: async () => {
        order.push("post-run-settled");
      },
      wrapLock: (lock) => ({
        inProgress: () => lock.inProgress(),
        begin: () => {
          order.push("lock-acquired");
          return lock.begin();
        },
        end: () => {
          order.push("lock-released");
          lock.end();
        },
      }),
    });

    const result = await env.service.repair();

    expect(result.ok).toBe(true);
    expect(order.slice(0, 2)).toEqual(["lock-acquired", "post-run-settled"]);
    expect(order[order.length - 1]).toBe("lock-released");
  });

  it("rejects a run started while reset holds the maintenance lock (TOCTOU, both directions)", async () => {
    const { service, execution } = buildReset();
    const lock = execution.maintenanceLock;

    // Acquire the lock synchronously, as reset() does before any await.
    expect(lock.begin().ok).toBe(true);
    try {
      // A run racing in while maintenance holds the lock is rejected.
      const run = await execution.execute({ scope: "demo", target: "demo" });
      expect(run.ok).toBe(false);
      if (!run.ok) expect(run.error.code).toBe("MAINTENANCE_IN_PROGRESS");
      expect(execution.activeRunId()).toBeNull();
    } finally {
      lock.end();
    }

    // Once the lock is released, a real reset proceeds and re-initializes.
    const result = await service.reset();
    expect(result.ok).toBe(true);
  });
});

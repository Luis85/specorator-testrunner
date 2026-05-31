import type { EnvironmentValidationService } from "./environment-validation-service";
import type { InitializationService } from "./initialization-service";
import type { MaintenanceLock } from "./test-execution-service";
import type { RunnerInstallationService } from "./runner-installation-service";
import type { SettingsService } from "./settings-service";
import type { VaultFileSystem } from "../ports/vault-file-system";
import { appError } from "../../shared/errors/errors";
import { DEFAULT_SETTINGS } from "../../domain/settings/settings";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Repair (UC-003), reset (UC-024) and — in later sprints — evidence sweep
 * (SDD AD-11). EPIC-003 delivers `repair()`; `reset()` lands the UC-024 chain.
 */
export interface MaintenanceService {
  repair(): Promise<Result<RepairResult>>;
  reset(): Promise<Result<ResetResult>>;
}

/**
 * The narrow slice of the test-execution contract repair() needs to refuse and
 * wait on an in-flight run (P0-3). Kept minimal to avoid coupling maintenance
 * to the full execution service.
 */
export interface ActiveRunGuard {
  activeRunId(): RunId | null;
  whenActiveSettles(): Promise<void>;
}

export interface RepairResult {
  repairedFiles: VaultPath[];
  reinstalledPackages: boolean;
  reinstalledBrowsers: boolean;
}

export interface ResetResult {
  /** The folder(s) removed before re-initialization. */
  deletedFolders: VaultPath[];
  /** Files re-created by the re-initialization pass. */
  recreatedFiles: VaultPath[];
  /** The single reset-invocation correlationId stamped across the chain. */
  correlationId: string;
}

export class DefaultMaintenanceService implements MaintenanceService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly validation: EnvironmentValidationService,
    private readonly runnerInstall: RunnerInstallationService,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly activeRun?: ActiveRunGuard,
    // reset() needs to re-initialize and to remove the regenerable runtime; the
    // maintenance lock closes the reset/run TOCTOU (security L1). All three are
    // optional so existing repair()-only construction/tests keep compiling.
    private readonly initialization?: InitializationService,
    private readonly fs?: VaultFileSystem,
    private readonly maintenanceLock?: MaintenanceLock,
  ) {}

  async repair(): Promise<Result<RepairResult>> {
    // Repair re-syncs `.testrunner` (and may reinstall deps/browsers); doing so
    // while a run is in flight could rewrite files the runner is reading and
    // redirect report/evidence writes. Acquire the maintenance lock SYNCHRONOUSLY
    // (no await before it) so a `runTest` issued in the check-then-act gap cannot
    // reserve the single-run slot while we mutate `.testrunner` (security L1).
    // The lock's begin() also performs the ADR-0018 / P0-3 active-run refusal.
    const lock = this.maintenanceLock;
    const acquired = lock ? lock.begin() : this.refuseIfActive();
    if (!acquired.ok) return err(acquired.error);
    try {
      // When no lock is wired (repair-only construction/tests), keep the legacy
      // wait-for-settle behaviour so an already-finishing run drains first.
      if (!lock) await this.activeRun?.whenActiveSettles().catch(() => undefined);

      const settings = await this.settingsService.load();

      // 1. Diagnose what's broken (RV-8 step 1).
      const before = await this.validation.validateEnvironment();

      // 2. Re-sync the managed template files; user-authored steps/pages are
      //    preserved because their templates declare overwrite:false (RV-8).
      const recreated = await this.runnerInstall.createRunner(settings);
      if (!recreated.ok) return err(recreated.error);

      // 3. Reinstall only what's missing. A present-but-unrunnable Playwright
      //    (node_modules exists yet `npx playwright --version` fails) counts as a
      //    broken dependency set and triggers a reinstall.
      let reinstalledPackages = false;
      if (!before.dependenciesInstalled || !before.playwrightAvailable) {
        const deps = await this.runnerInstall.installDependencies(settings);
        if (!deps.ok) return err(deps.error);
        reinstalledPackages = true;
      }

      // The cache heuristic cannot prove the cached Chromium revision matches the
      // installed Playwright, so repair always runs the idempotent browser
      // installer (a no-op when the correct browser is already present) — making
      // repair the authoritative path to a launchable browser.
      const browsers = await this.runnerInstall.installBrowsers(settings);
      if (!browsers.ok) return err(browsers.error);
      const reinstalledBrowsers = true;

      // 4. Re-validate (publishes testrunner.validated, RV-8 step "validate").
      await this.validation.validateEnvironment();

      const repairedFiles = recreated.value.createdFiles;
      await this.eventBus.publish(createEvent("testrunner.repaired", { repairedFiles }));
      this.logger.info("Runner repaired", {
        files: repairedFiles.length,
        reinstalledPackages,
        reinstalledBrowsers,
      });
      return ok({ repairedFiles, reinstalledPackages, reinstalledBrowsers });
    } finally {
      lock?.end();
    }
  }

  /**
   * UC-024 Reset Test Hub: restore the Test Hub to a clean state.
   *
   * Order (Event Catalog §14): `settings.reset` → `testhub.initialization.started`
   * → … → `testhub.initialization.completed`/`.failed`. One reset-invocation
   * `correlationId` is minted up front and stamped across the whole chain so the
   * `settings.reset` and the re-initialization events group (Event Catalog §19).
   *
   * Destructive scope is DELIBERATELY conservative: only the regenerable
   * `.testrunner` runtime (managed runner scaffolding — generated config, step
   * stubs, npm project) is deleted, then re-materialised by re-initialization.
   * User-authored business content (Use Cases, Specifications, Feature files,
   * Test Suites, Test Evidence) is NOT deleted — UC-024 says "remove generated
   * assets / recreate defaults", and those folders hold hand-written audit-first
   * artefacts the product exists to preserve. Documentation and default suites
   * are regenerable and are re-created idempotently by the re-init pass (their
   * templates skip/overwrite managed notes) rather than blanket-deleted, because
   * the documentation folder defaults to the Test Hub root and a recursive delete
   * there would take user content with it.
   */
  async reset(): Promise<Result<ResetResult>> {
    if (!this.initialization || !this.fs) {
      // Defensive: reset() requires the init service + vault FS; a repair-only
      // construction cannot reset.
      return err(
        appError(
          "INIT_FAILED",
          "Reset is not available: the maintenance service is not fully wired.",
        ),
      );
    }

    // Mutual exclusion with runs, acquired SYNCHRONOUSLY before any await so a
    // `runTest` issued in the gap cannot reserve the single-run slot while we
    // delete `.testrunner` and re-initialize (security L1 TOCTOU close). begin()
    // also enforces the ADR-0018 active-run refusal.
    const lock = this.maintenanceLock;
    const acquired = lock ? lock.begin() : this.refuseIfActive();
    if (!acquired.ok) return err(acquired.error);
    try {
      if (!lock) await this.activeRun?.whenActiveSettles().catch(() => undefined);

      // One id for the whole reset flow (Event Catalog §19 "reset invocation id").
      const correlationId = createEvent("settings.reset", { profile: "default" }).id;

      const settings = await this.settingsService.load();

      // 1. Remove the regenerable runner runtime (idempotent: a missing folder is
      //    not an error). This is the only destructive step — see the method-level
      //    comment for the deliberately preserved user content.
      const runnerPath = settings.paths.testRunnerPath;
      const deleted = await this.fs.deleteFolder(runnerPath);
      if (!deleted.ok) return err(deleted.error);
      this.logger.info("Removed regenerable runner runtime for reset", {
        correlationId,
        runnerPath,
      });

      // 2. Restore default settings, stamping the shared correlationId on
      //    `settings.reset` (emitted before the init chain, per Event Catalog §14).
      const resetSettings = await this.settingsService.reset(correlationId);
      if (!resetSettings.ok) return err(resetSettings.error);

      // 3. Re-initialize to a clean default install, threading the same
      //    correlationId so `testhub.initialization.started/completed` group with
      //    `settings.reset`. Deps/browsers are NOT reinstalled here (the network
      //    install is expensive and may be intact under ms-playwright's cache);
      //    re-init re-materialises the scaffolding and validation reports any
      //    missing deps so the user can Repair if needed.
      const initialized = await this.initialization.initialize(
        {
          settings: DEFAULT_SETTINGS,
          installDependencies: false,
          installBrowsers: false,
          generateDemoContent: DEFAULT_SETTINGS.automation.autoCreateDemoContent,
          generateDocumentation: DEFAULT_SETTINGS.automation.autoCreateDocumentation,
        },
        undefined,
        correlationId,
      );
      if (!initialized.ok) return err(initialized.error);

      this.logger.info("Test Hub reset", {
        correlationId,
        deletedFolder: runnerPath,
        recreatedFiles: initialized.value.createdFiles.length,
      });
      return ok({
        deletedFolders: [runnerPath],
        recreatedFiles: initialized.value.createdFiles,
        correlationId,
      });
    } finally {
      lock?.end();
    }
  }

  /**
   * Legacy active-run refusal for constructions without a maintenance lock
   * (repair-only tests). The lock-backed path performs the equivalent check
   * synchronously inside begin().
   */
  private refuseIfActive(): Result<void> {
    if (this.activeRun && this.activeRun.activeRunId() !== null) {
      return err(
        appError("RUN_IN_PROGRESS", "A test run is in progress; cancel it before maintenance.", {
          details: { activeRunId: this.activeRun.activeRunId() },
        }),
      );
    }
    return ok(undefined);
  }
}

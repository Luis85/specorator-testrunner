import type { EnvironmentValidationService } from "./environment-validation-service";
import type { RunnerInstallationService } from "./runner-installation-service";
import type { SettingsService } from "./settings-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Repair (UC-003) and — in later sprints — reset (UC-024) and evidence sweep
 * (SDD AD-11). EPIC-003 delivers `repair()`; the contract grows incrementally
 * (TIS §8.4).
 */
export interface MaintenanceService {
  repair(): Promise<Result<RepairResult>>;
}

export interface RepairResult {
  repairedFiles: VaultPath[];
  reinstalledPackages: boolean;
  reinstalledBrowsers: boolean;
}

export class DefaultMaintenanceService implements MaintenanceService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly validation: EnvironmentValidationService,
    private readonly runnerInstall: RunnerInstallationService,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async repair(): Promise<Result<RepairResult>> {
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
  }
}

import type { EnvironmentValidationService } from "./environment-validation-service";
import type { InitializationService } from "./initialization-service";
import type { MaintenanceLock } from "./test-execution-service";
import type { RunnerInstallationService } from "./runner-installation-service";
import type { SettingsService } from "./settings-service";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { VaultFileSystem } from "../ports/vault-file-system";
import { resolveRunnerCwd } from "./runner-paths";
import { TESTRUNNER_MANIFEST_FILE, TESTRUNNER_MANIFEST_VERSION } from "../content/runner-manifest";
import { parseManifestVersion } from "../content/runner-manifest-version";
import { appError } from "../../shared/errors/errors";
import { DEFAULT_SETTINGS } from "../../domain/settings/settings";
import type { TestHubSettings } from "../../domain/settings/settings";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import { createEvent, newId } from "../../shared/event-bus/create-event";
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
  /**
   * True when repair clean-cut a V1 (cucumber-js era) `.testrunner` to the V2
   * playwright-bdd environment — detected via the on-disk manifest being older
   * than the current version (RUNNER_MANIFEST_OUTDATED). False for a healthy V2 repair.
   */
  migratedFromV1: boolean;
  /**
   * The V1-incompatible managed/demo files deleted during the clean-cut (empty
   * on a healthy V2 repair). The plugin-owned demo entries are recreated at the
   * current version by the subsequent createRunner pass.
   */
  removedFiles: VaultPath[];
}

/**
 * V1 (cucumber-js) managed + plugin-owned demo files that import the
 * now-removed `@cucumber/cucumber` and break the V2 runner's typecheck/run.
 * Clean-cut deletes them BEFORE createRunner re-syncs:
 *  - the V1-only managed files are gone for good (NOT in the V2 template set);
 *  - the demo entries (overwrite:false in the V2 templates) are recreated at V2
 *    once absent, so the demo passes again.
 * Paths are relative to the resolved runner cwd.
 */
const V1_INCOMPATIBLE_FILES = [
  "cucumber.mjs",
  "src/support/world.ts",
  "src/support/hooks.ts",
  "src/steps/example.steps.ts",
  "src/pages/ExamplePage.ts",
] as const;

export interface ResetResult {
  /** The folder(s) removed before re-initialization. */
  deletedFolders: VaultPath[];
  /** Files re-created by the re-initialization pass. */
  recreatedFiles: VaultPath[];
  /** The single reset-invocation correlationId stamped across the chain. */
  correlationId: string;
}

/**
 * Case-insensitive path segments, normalized the way the vault adapter will be
 * before it deletes: `/`+`\` separators collapsed, and `.` (current-dir) segments
 * dropped. Without dropping `.`, a configured `./Use Cases` (or `.`) would NOT
 * appear to overlap the protected `Use Cases`/vault-root here, yet the adapter
 * normalizes it away and recursively deletes the real folder (review: data loss).
 * A path that normalizes to NO segments is the vault root.
 */
const segmentsOf = (path: string): string[] =>
  path
    .split(/[\\/]+/)
    .filter((s) => s.length > 0 && s !== ".")
    .map((s) => s.toLowerCase());

/**
 * True when two vault paths overlap: equal, or one is an ancestor of the other.
 * An empty (vault-root) path collides with everything — deleting it would take
 * the whole vault, so reset must refuse.
 */
const pathsOverlap = (a: string, b: string): boolean => {
  const sa = segmentsOf(a);
  const sb = segmentsOf(b);
  if (sa.length === 0 || sb.length === 0) return true;
  const [shorter, longer] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return shorter.every((seg, i) => seg === longer[i]);
};

export class DefaultMaintenanceService implements MaintenanceService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly validation: EnvironmentValidationService,
    private readonly runnerInstall: RunnerInstallationService,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    // The `.testrunner` runtime lives outside the vault index, so the V1→V2
    // clean-cut deletes its cucumber-era files through the absolute FS port
    // (VaultFileSystem only deletes folders). Resolves the runner cwd the same
    // way the specification-service does (resolveRunnerCwd).
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly activeRun?: ActiveRunGuard,
    // reset() needs to re-initialize and to remove the regenerable runtime; the
    // maintenance lock closes the reset/run TOCTOU (security L1). All three are
    // optional so existing repair()-only construction/tests keep compiling.
    private readonly initialization?: InitializationService,
    private readonly fs?: VaultFileSystem,
    private readonly maintenanceLock?: MaintenanceLock,
    /**
     * Resolves when the post-run import→evidence chain has settled (the
     * PostRunCoordinator's `whenSettled`). Evidence I/O outlives the active-run
     * slot — the coordinator writes Use Case frontmatter after the slot frees —
     * so repair()/reset() await this INSIDE the maintenance lock: the lock
     * guarantees no NEW run (and thus no new post-run task) can start, and this
     * drains the tail of the PREVIOUS run's import/evidence writes before any
     * files are touched.
     */
    private readonly whenPostRunSettled?: () => Promise<void>,
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

      // Drain the tail of the previous run's post-run import/evidence chain
      // UNDER the lock (no new run can start now) so the re-sync below cannot
      // overlap in-flight evidence I/O. See the constructor doc.
      await this.whenPostRunSettled?.().catch(() => undefined);

      const settings = await this.settingsService.load();

      // 1. Diagnose what's broken (RV-8 step 1).
      const before = await this.validation.validateEnvironment();

      // A manifest-version mismatch means the on-disk runtime predates the
      // current version. We use it for BOTH the V1→V2 clean-cut migration
      // (below, before createRunner) AND the dependency reinstall (further down).
      // validateEnvironment() already read the manifest before createRunner
      // overwrites it, so detect the mismatch from `before.issues` rather than
      // re-reading — DRY and reader-consistent.
      const manifestMismatch = before.issues.some(
        (issue) => issue.code === "RUNNER_MANIFEST_OUTDATED",
      );

      // 2. V1→V2 clean-cut (US-051): when the manifest is outdated, DELETE the
      //    cucumber-era files that import the now-removed `@cucumber/cucumber`
      //    BEFORE re-syncing. The V1-only managed files (cucumber.mjs, world,
      //    hooks) are gone for good; the plugin-owned demo (example.steps/
      //    ExamplePage) is recreated at the current version by the createRunner pass below (its
      //    templates are overwrite:false → CREATE when absent). Guarded so a
      //    healthy V2 repair (no mismatch) deletes nothing.
      const migration = manifestMismatch
        ? await this.migrateV1Runner(settings)
        : ok({ migrated: false, removed: [] as VaultPath[] });
      if (!migration.ok) return err(migration.error);
      const removedFiles = migration.value.removed;

      // 3. Re-sync the managed template files; user-authored steps/pages are
      //    preserved because their templates declare overwrite:false (RV-8). On a
      //    migration this also recreates the now-deleted demo at V2.
      const recreated = await this.runnerInstall.createRunner(settings);
      if (!recreated.ok) return err(recreated.error);

      // 4. Reinstall only what's missing. A present-but-unrunnable Playwright
      //    (node_modules exists yet `npx playwright --version` fails) counts as a
      //    broken dependency set and triggers a reinstall. A manifest-version
      //    mismatch (the @cucumber→playwright-bdd swap) also forces a reinstall
      //    even though the dependency markers still resolve.
      let reinstalledPackages = false;
      if (!before.dependenciesInstalled || !before.playwrightAvailable || manifestMismatch) {
        const deps = await this.runnerInstall.installDependencies(settings);
        if (!deps.ok) return err(deps.error);
        reinstalledPackages = true;
      }

      // The cache heuristic cannot prove the cached browser revisions match the
      // installed Playwright, so repair always runs the idempotent browser
      // installer (a no-op when the correct browser is already present) — making
      // repair the authoritative path to a launchable browser.
      const browsers = await this.runnerInstall.installBrowsers(settings);
      if (!browsers.ok) return err(browsers.error);
      const reinstalledBrowsers = true;

      // 5. Re-validate (publishes testrunner.validated, RV-8 step "validate").
      await this.validation.validateEnvironment();

      const repairedFiles = recreated.value.createdFiles;
      const migratedFromV1 = migration.value.migrated;
      await this.eventBus.publish(createEvent("testrunner.repaired", { repairedFiles }));
      this.logger.info("Runner repaired", {
        files: repairedFiles.length,
        reinstalledPackages,
        reinstalledBrowsers,
        migratedFromV1,
        removedFiles: removedFiles.length,
      });
      if (migratedFromV1) {
        // Report-only: we do NOT touch genuinely user-authored (non-demo) step
        // files; their Cucumber-World form must be re-authored as createBdd steps.
        this.logger.info(
          "Migrated .testrunner from V1 (cucumber-js) to playwright-bdd: any custom V1 step " +
            "files written against the Cucumber World must be re-authored as createBdd steps.",
        );
      }
      return ok({
        repairedFiles,
        reinstalledPackages,
        reinstalledBrowsers,
        migratedFromV1,
        removedFiles,
      });
    } finally {
      lock?.end();
    }
  }

  /**
   * UC-024 Reset Test Hub: restore the Test Hub to a clean state.
   *
   * Order (UC-024 "Domain Events"): `settings.reset` → `testhub.initialization.started`
   * → … → `testhub.initialization.completed`/`.failed`. One reset-invocation
   * `correlationId` is minted up front and stamped across the whole chain so the
   * `settings.reset` and the re-initialization events group (Event Catalog §19).
   *
   * Once the maintenance lock is acquired (no new run can start), any tail of
   * the previous run's post-run import/evidence chain is drained via the
   * injected `whenPostRunSettled` hook BEFORE the destructive delete, so late
   * evidence writes cannot overlap the reset.
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

      // Drain the tail of the previous run's post-run import/evidence chain
      // UNDER the lock — evidence writes outlive the active-run slot, and the
      // lock is already held so no new run can enqueue more work. This must
      // happen before the destructive delete below so a late evidence write
      // cannot overlap the reset (see the constructor doc).
      await this.whenPostRunSettled?.().catch(() => undefined);

      // One id for the whole reset flow (Event Catalog §19 "reset invocation id").
      const correlationId = newId();

      const settings = await this.settingsService.load();

      // 1. Remove the regenerable runner runtime (idempotent: a missing folder is
      //    not an error). This is the only destructive step — see the method-level
      //    comment for the deliberately preserved user content.
      const runnerPath = settings.paths.testRunnerPath;

      // SAFETY GUARD (review M1): `testRunnerPath` is settings-controlled and only
      // validated by PathSafetyPolicy for traversal/injection — NOT for its target.
      // A tampered/synced data.json could repoint it at a user-content folder (e.g.
      // "Use Cases"), turning this recursive delete into data loss. Refuse to reset
      // if the runner path overlaps ANY user-content path rather than delete it.
      const contentPaths: Record<string, string> = {
        useCasesPath: settings.paths.useCasesPath,
        specificationsPath: settings.paths.specificationsPath,
        featureFilesPath: settings.paths.featureFilesPath,
        testSuitesPath: settings.paths.testSuitesPath,
        evidencePath: settings.paths.evidencePath,
        documentationPath: settings.paths.documentationPath,
        testHubPath: settings.paths.testHubPath,
        prdsPath: settings.paths.prdsPath,
        domainsPath: settings.paths.domainsPath,
      };
      const collision = Object.entries(contentPaths).find(([, p]) => pathsOverlap(runnerPath, p));
      if (collision) {
        return err(
          appError(
            "PATH_UNSAFE",
            `Refusing to reset: the runner folder "${runnerPath}" overlaps user content ` +
              `("${collision[0]}" = "${collision[1]}"). Point the Runner folder at a dedicated ` +
              `path (e.g. ".testrunner") before resetting.`,
            { details: { runnerPath, collidesWith: collision[0], collisionPath: collision[1] } },
          ),
        );
      }

      const deleted = await this.fs.deleteFolder(runnerPath);
      if (!deleted.ok) return err(deleted.error);
      this.logger.info("Removed regenerable runner runtime for reset", {
        correlationId,
        runnerPath,
      });

      // 2. Restore default settings, stamping the shared correlationId on
      //    `settings.reset` (emitted before the init chain, per UC-024 ordering).
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

  /**
   * V1→V2 clean-cut: delete the cucumber-era files that break the V2 runner.
   * Resolves the absolute runner cwd (the runner runtime lives outside the vault
   * index) and removes each V1-incompatible file that is actually present. When
   * the cwd cannot be resolved we skip the deletions rather than guess a path.
   * `migrated` is true only for an OLDER/unversioned (V1-era) runner; a NEWER
   * runner (a downgrade / Obsidian Sync from a future plugin) is left untouched
   * — its files are NOT V1 cucumber, so deleting them would corrupt it.
   * `removed` lists the paths that EXISTED and were deleted, so the change report
   * shows only real deletions — not idempotent no-ops for files a given V1 runner
   * never had. MUST run BEFORE createRunner so the deleted demo is recreated at
   * the current version. A delete that actually FAILS (locked/read-only stale file) returns `err`
   * and fails the repair: the demo files are recreated `overwrite:false`, so a
   * surviving V1 `@cucumber`/World file would leave the runner un-loadable while
   * Repair falsely reported success.
   */
  private async migrateV1Runner(
    settings: TestHubSettings,
  ): Promise<Result<{ migrated: boolean; removed: VaultPath[] }>> {
    const cwd = await resolveRunnerCwd(this.absoluteFs, settings.paths.testRunnerPath);
    if (!cwd.ok) return ok({ migrated: false, removed: [] });
    const manifest = await this.absoluteFs.readAbsolute(`${cwd.value}/${TESTRUNNER_MANIFEST_FILE}`);
    const version = parseManifestVersion(manifest.ok ? manifest.value : undefined);
    // Clean-cut only an OLDER/unversioned runner. A newer manifest is NOT V1.
    if (version !== null && version >= TESTRUNNER_MANIFEST_VERSION) {
      return ok({ migrated: false, removed: [] });
    }
    const removed: VaultPath[] = [];
    for (const relPath of V1_INCOMPATIBLE_FILES) {
      const abs = `${cwd.value}/${relPath}`;
      // Only act on a file that actually exists: deleteAbsolute is
      // force-idempotent (no error on a missing path), so without this guard the
      // change report would claim deletions a fresh-ish V1 runner never had.
      if (!(await this.absoluteFs.existsAbsolute(abs))) continue;
      const deleted = await this.absoluteFs.deleteAbsolute(abs);
      if (!deleted.ok) return err(deleted.error);
      removed.push(unsafeVaultPath(relPath));
    }
    return ok({ migrated: true, removed });
  }
}

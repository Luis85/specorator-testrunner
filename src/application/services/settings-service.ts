import type { DataStore } from "../ports/data-store";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import {
  authEnvKeyProblem,
  DEFAULT_SETTINGS,
  type AutomationSettings,
  type CiProvider,
  type CiSettings,
  type OnboardingSequenceProgress,
  type OnboardingSettings,
  type SutEnvironment,
  type TestHubPathSettings,
  type TestHubSettings,
} from "../../domain/settings/settings";
import { vaultPath } from "../../domain/value-objects/vault-path";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { SerialQueue } from "../../shared/async/serial-queue";
import {
  baseUrlProblem,
  isPlainRecord,
  nodeExecutableProblem,
  repairBrowsers,
} from "./settings-field-rules";
import { collectSettingsValidation, type SettingsValidationMessage } from "./settings-validation";

/** No-op logger so tests can construct the service without wiring one. */
const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Settings application contract (TIS §5.9). */
export interface SettingsService {
  load(): Promise<TestHubSettings>;
  save(settings: TestHubSettings): Promise<Result<void>>;
  /**
   * Restores defaults and emits `settings.reset`. A `correlationId` may be
   * threaded in by {@link MaintenanceService.reset} (UC-024) so `settings.reset`
   * shares the single reset-invocation id with the re-initialization chain that
   * follows it (Event Catalog §19).
   */
  reset(correlationId?: string): Promise<Result<TestHubSettings>>;
  validate(settings: TestHubSettings): Promise<SettingsValidationResult>;
}

export interface SettingsValidationResult {
  valid: boolean;
  errors: SettingsValidationMessage[];
  warnings: SettingsValidationMessage[];
}

export type { SettingsValidationMessage };

/**
 * The data.json schema version. Bumped when the persisted shape changes
 * incompatibly. Pre-announcement beta has no migration framework (proposal §9
 * Phase 2 scope): a present blob with a different version resets to defaults
 * with a logged report rather than being migrated.
 */
const DATA_SCHEMA_VERSION = 1;

/**
 * The schema version this envelope first shipped at — a FIXED historical
 * constant, NEVER updated when {@link DATA_SCHEMA_VERSION} bumps. A present blob
 * carrying no numeric `schemaVersion` predates the envelope, so it is treated as
 * this version: at v1 it equals {@link DATA_SCHEMA_VERSION} and merges, but once
 * the code bumps past 1 it no longer matches and resets. Kept distinct from
 * `DATA_SCHEMA_VERSION` so a future bump can't be "simplified" into folding the
 * two together (which would silently stop resetting legacy/corrupt blobs).
 */
const INITIAL_SCHEMA_VERSION = 1;

/** Runtime mirror of LoggingSettings["level"] for tamper repair on load. */
const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

/** Runtime mirror of {@link CiProvider} union for tamper repair on load. */
const CI_PROVIDERS: ReadonlySet<string> = new Set([
  "github-actions",
  "azure-devops",
  "none",
] satisfies CiProvider[]);

/** Shallow-by-section merge of persisted data over defaults. */
const mergeWithDefaults = (raw: unknown): TestHubSettings => {
  const data = (raw ?? {}) as Partial<TestHubSettings>;
  return {
    paths: { ...DEFAULT_SETTINGS.paths, ...data.paths },
    runner: { ...DEFAULT_SETTINGS.runner, ...data.runner },
    automation: { ...DEFAULT_SETTINGS.automation, ...data.automation },
    ci: { ...DEFAULT_SETTINGS.ci, ...data.ci },
    sut: { ...DEFAULT_SETTINGS.sut, ...data.sut },
    logging: { ...DEFAULT_SETTINGS.logging, ...data.logging },
    onboarding: { ...DEFAULT_SETTINGS.onboarding, ...data.onboarding },
  };
};

export class DefaultSettingsService implements SettingsService {
  constructor(
    private readonly store: DataStore,
    private readonly pathSafety: PathSafetyPolicy,
    private readonly eventBus: EventBus,
    private readonly logger: Logger = NOOP_LOGGER,
    /**
     * Optional vault access for the ADR-0015 one-project-per-vault check. When
     * omitted (e.g. in unit tests that don't exercise it) the check is skipped,
     * so existing call sites and behaviour are unaffected.
     */
    private readonly vaultFs?: VaultFileSystem,
  ) {}

  /**
   * Serializes save()/reset() persistence. The settings tab debounces saves
   * PER FIELD (P4-9), so two quick edits to different fields produce two
   * overlapping save() calls; without serialization both would read the same
   * "previous", interleave their load→save→diff sections, and the last
   * whole-object write would win — silently dropping the first change (F2).
   */
  private readonly persistQueue = new SerialQueue();

  async load(): Promise<TestHubSettings> {
    const raw = await this.store.load();
    // A present blob whose EFFECTIVE version differs from the code → beta reset
    // (log + defaults, no migration). A present-but-unversioned blob is treated
    // as v1 (the version this envelope shipped at), so at v1 it still merges,
    // but a future incompatible bump resets it instead of merging stale data.
    // First run (no data.json) falls through to defaults silently.
    if (this.schemaVersionIsStale(raw)) {
      this.logger.error(
        "data.json schemaVersion differs from this build; resetting settings to defaults (beta: no migration).",
        undefined,
        { expected: DATA_SCHEMA_VERSION },
      );
      // PERSIST the reset so the stale blob is overwritten with stamped defaults
      // — otherwise every subsequent load repeats the reset/log instead of
      // converging, AND sensitive stale data lingers (e.g. the pre-cut-over
      // plaintext `auth.env` credentials this rail must drop, ADR-0024).
      // Write DIRECTLY, NOT through `persistQueue`: `save()` runs its whole body
      // inside `persistQueue.run(...)` and calls `await this.load()` to compute
      // changedFields, so re-entering the queue here would deadlock (the reset
      // queues behind the save that is awaiting it — the re-entrancy the
      // SerialQueue docs warn about). The direct write is a blind overwrite to
      // defaults, not a read-modify-write, so interleaving with that in-flight
      // save is benign: the save's own subsequent write supersedes it. A persist
      // failure is logged but does not block the load (returned defaults are
      // correct in memory).
      const persisted = await this.persist(DEFAULT_SETTINGS);
      if (!persisted.ok) {
        this.logger.error(
          "Failed to persist the settings reset; the stale blob remains.",
          persisted.error,
        );
      }
      return DEFAULT_SETTINGS;
    }
    const settings = this.sanitizeScalarShapes(
      this.sanitizeRunnerEnvInputs(this.sanitizePaths(mergeWithDefaults(raw))),
    );
    return { ...settings, onboarding: repairOnboardingShape(settings.onboarding) };
  }

  /**
   * True for a PRESENT blob whose EFFECTIVE schema version differs from the
   * code. Only `undefined` raw (no data.json) is the silent first run. ANY
   * present value — object, array, scalar, or null — is a stored blob: its
   * effective version is its numeric `schemaVersion` if it has one, else 1 (the
   * version this envelope shipped at, fixed forever, NOT `DATA_SCHEMA_VERSION`
   * which moves on each bump). So an unversioned or malformed present blob
   * merges while the code is at v1, but resets (and is overwritten) once the
   * code bumps past 1 — a corrupt non-object blob must not silently survive an
   * incompatible bump.
   */
  private schemaVersionIsStale(raw: unknown): boolean {
    if (raw === undefined) return false; // first run, not stale
    const version =
      typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).schemaVersion
        : undefined;
    // INITIAL_SCHEMA_VERSION (not DATA_SCHEMA_VERSION) is the fallback: any
    // present-but-unversioned/non-object blob predates the envelope, so it is
    // effectively the version this envelope shipped at.
    const effective = typeof version === "number" ? version : INITIAL_SCHEMA_VERSION;
    return effective !== DATA_SCHEMA_VERSION;
  }

  /** Persists settings under the schema envelope (stamps the current version). */
  private persist(settings: TestHubSettings): Promise<Result<void>> {
    return this.store.save({ schemaVersion: DATA_SCHEMA_VERSION, ...settings });
  }

  /**
   * Repairs `ci.*` / `automation.*` scalars with the same log-and-fallback
   * posture as {@link sanitizePaths} (review §4): a tampered/synced data.json
   * must not crash `.trim()` call sites or flip automation behaviour with
   * truthy garbage. V2 grows both sections; new scalars get screened here.
   */
  private sanitizeScalarShapes(settings: TestHubSettings): TestHubSettings {
    const repair = <T>(field: string, value: unknown, valid: boolean, fallback: T): T => {
      if (valid) return value as T;
      this.logger.error(
        `Configured "${field}" has an invalid value; falling back to the default.`,
        undefined,
        { field, value, fallback },
      );
      return fallback;
    };
    const booleanFlag = (field: keyof AutomationSettings): boolean =>
      repair(
        `automation.${field}`,
        settings.automation[field],
        typeof settings.automation[field] === "boolean",
        DEFAULT_SETTINGS.automation[field] as boolean,
      );
    const retention = settings.automation.evidenceRetentionDays;
    return {
      ...settings,
      ci: {
        provider: repair(
          "ci.provider",
          settings.ci.provider,
          typeof settings.ci.provider === "string" && CI_PROVIDERS.has(settings.ci.provider),
          DEFAULT_SETTINGS.ci.provider,
        ),
        workflowPath: repair(
          "ci.workflowPath",
          settings.ci.workflowPath,
          typeof settings.ci.workflowPath === "string",
          DEFAULT_SETTINGS.ci.workflowPath,
        ),
        nodeVersion: repair(
          "ci.nodeVersion",
          settings.ci.nodeVersion,
          typeof settings.ci.nodeVersion === "string",
          DEFAULT_SETTINGS.ci.nodeVersion,
        ),
      } satisfies CiSettings,
      automation: {
        autoCreateFolders: booleanFlag("autoCreateFolders"),
        autoCreateDocumentation: booleanFlag("autoCreateDocumentation"),
        autoCreateDemoContent: booleanFlag("autoCreateDemoContent"),
        updateUseCaseFrontmatterAfterRun: booleanFlag("updateUseCaseFrontmatterAfterRun"),
        generateEvidenceMarkdown: booleanFlag("generateEvidenceMarkdown"),
        openDashboardAfterInitialization: booleanFlag("openDashboardAfterInitialization"),
        // undefined = keep forever (the V1 default) — also the repair fallback.
        evidenceRetentionDays: repair<number | undefined>(
          "automation.evidenceRetentionDays",
          retention,
          retention === undefined ||
            (typeof retention === "number" && Number.isFinite(retention) && retention > 0),
          undefined,
        ),
      } satisfies AutomationSettings,
    };
  }

  /**
   * Screens every configured path through PathSafetyPolicy on load. A
   * tampered/synced `data.json` could otherwise carry an unsafe path straight
   * into a code-generation sink (e.g. the `playwright.config.ts` feature glob, SEC-1 /
   * P0-1) — `save()` validates, but `load()` historically did not. Any unsafe
   * path is logged and replaced with its `DEFAULT_SETTINGS` value so the unsafe
   * value never reaches the runner generator, without breaking normal startup.
   */
  private sanitizePaths(settings: TestHubSettings): TestHubSettings {
    const paths = { ...settings.paths };
    for (const field of Object.keys(paths) as (keyof TestHubPathSettings)[]) {
      // The `vaultPath` smart constructor validates AND brands in one call (using
      // the injected policy), so validation and branding can't drift apart — this
      // is the ADR-0008 load-time chokepoint. An unsafe path is logged and
      // replaced with its default so it never reaches the runner generator.
      const safe = vaultPath(paths[field], this.pathSafety);
      if (safe.ok) {
        paths[field] = safe.value;
      } else {
        this.logger.error(
          `Configured path "paths.${field}" is unsafe; falling back to the default.`,
          safe.error,
          { field, value: paths[field], fallback: DEFAULT_SETTINGS.paths[field] },
        );
        paths[field] = DEFAULT_SETTINGS.paths[field];
      }
    }
    // logging.level is consumed directly by the composition root's
    // setMinLevel; an out-of-union value (tampered/synced data.json) would
    // make LEVEL_ORDER[level] undefined and silently DISABLE the level filter
    // for the whole session — repair it with the same log-and-fallback
    // posture as the path screens.
    let level = settings.logging.level;
    if (!LOG_LEVELS.has(level)) {
      this.logger.error(
        `Configured "logging.level" is not a valid level; falling back to the default.`,
        undefined,
        { value: level, fallback: DEFAULT_SETTINGS.logging.level },
      );
      level = DEFAULT_SETTINGS.logging.level;
    }

    const loggingPath = vaultPath(settings.logging.path, this.pathSafety);
    if (!loggingPath.ok) {
      this.logger.error(
        `Configured path "logging.path" is unsafe; falling back to the default.`,
        loggingPath.error,
        { value: settings.logging.path, fallback: DEFAULT_SETTINGS.logging.path },
      );
      return {
        ...settings,
        paths,
        logging: { ...settings.logging, level, path: DEFAULT_SETTINGS.logging.path },
      };
    }
    return {
      ...settings,
      paths,
      logging: { ...settings.logging, level, path: loggingPath.value },
    };
  }

  /**
   * Screens the three settings values that reach the runner child process on
   * load, mirroring the {@link sanitizePaths} posture for the env-injection
   * sink (SEC: test-execution-service builds the subprocess env as
   * `{ BASE_URL: active.baseUrl, ...active.auth.env }` VERBATIM, and
   * CommandSafetyPolicy only screens the node executable's BASENAME). A
   * tampered/synced `data.json` could otherwise carry a hostile env-var name,
   * a control-character baseUrl, or a traversal node path straight into the
   * spawn — `save()` validates, but `load()` historically did not. Every
   * invalid value is logged and dropped/replaced so it never reaches the
   * runner, without breaking normal startup:
   *
   *  - an invalid `auth.env` KEY drops that single entry (valid siblings
   *    survive). Only the KEY is logged — its value may be a credential
   *    (ADR-0019), and the load-time logger may not have the redaction set yet.
   *  - an invalid `baseUrl` falls back to the default environment's baseUrl
   *    when the environment IS a default one (so the demo `file://` fixture
   *    keeps working), else to `""`. Empty is the conservative choice: an
   *    empty `BASE_URL` is inert in the child env and `validate()` surfaces it
   *    as a warning, whereas inventing a URL could silently point runs at the
   *    wrong system.
   *  - an invalid `nodeExecutable` falls back to the default (`node`), whose
   *    basename CommandSafetyPolicy already trusts.
   */
  private sanitizeRunnerEnvInputs(settings: TestHubSettings): TestHubSettings {
    let runner = settings.runner;
    const nodeProblem = nodeExecutableProblem(runner.nodeExecutable);
    if (nodeProblem) {
      this.logger.error(
        `Configured "runner.nodeExecutable" ${nodeProblem}; falling back to the default.`,
        undefined,
        { value: runner.nodeExecutable, fallback: DEFAULT_SETTINGS.runner.nodeExecutable },
      );
      runner = { ...runner, nodeExecutable: DEFAULT_SETTINGS.runner.nodeExecutable };
    }

    const browsers = repairBrowsers(runner.browsers);
    if (browsers.repaired) {
      this.logger.error(
        `Configured "runner.browsers" was invalid; falling back to a valid set.`,
        undefined,
        { value: runner.browsers, fallback: browsers.browsers },
      );
    }
    runner = { ...runner, browsers: browsers.browsers };

    // Structural repair FIRST: the value checks below (and Object.entries)
    // assume plain records, but the shallow merge preserves whatever shape
    // data.json carried (review finding: `environments: null` crashed load).
    const sut = this.repairSutShape(settings.sut);
    const environments: Record<string, SutEnvironment> = {};
    for (const [name, environment] of Object.entries(sut.environments)) {
      environments[name] = this.screenEnvironmentValues(name, environment);
    }

    return { ...settings, runner, sut: { ...sut, environments } };
  }

  /**
   * Value-level screening for a single (structurally-repaired) environment:
   * screens the `auth.env` keys then the `baseUrl`, mirroring the
   * {@link sanitizeRunnerEnvInputs} posture (log + drop/replace, never break
   * startup). See that method's doc for the env-injection sink rationale.
   */
  private screenEnvironmentValues(name: string, environment: SutEnvironment): SutEnvironment {
    let env = this.screenAuthEnvKeys(name, environment);

    const urlProblem = baseUrlProblem(env.baseUrl);
    if (urlProblem) {
      const fallback = DEFAULT_SETTINGS.sut.environments[name]?.baseUrl ?? "";
      this.logger.error(
        `Configured "sut.environments.${name}.baseUrl" ${urlProblem}; falling back to ${JSON.stringify(fallback)}.`,
        undefined,
        { environment: name, value: env.baseUrl, fallback },
      );
      env = { ...env, baseUrl: fallback };
    }

    return env;
  }

  /**
   * Drops any `auth.env` KEY that fails {@link authEnvKeyProblem}, keeping valid
   * siblings. Reserved process-control keys (PATH, NODE_OPTIONS, …) are dropped
   * here too, so they can't reach the runner env sink. Returns the environment
   * unchanged when every key is valid.
   */
  private screenAuthEnvKeys(name: string, environment: SutEnvironment): SutEnvironment {
    const authEnv = environment.auth?.env;
    if (!authEnv || !Object.keys(authEnv).some((key) => authEnvKeyProblem(key) !== undefined)) {
      return environment;
    }
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(authEnv)) {
      const problem = authEnvKeyProblem(key);
      if (!problem) {
        kept[key] = value;
      } else {
        // Log the offending KEY + reason only — never its value (credential,
        // ADR-0019). Reserved process-control keys (PATH, NODE_OPTIONS, …)
        // are dropped here too, so they can't reach the runner env sink.
        this.logger.error(
          // Field name `entry`, not `key`: the logger's SENSITIVE_KEY
          // pattern matches the field NAME "key" and would blank exactly
          // the diagnostic this log exists to carry (F5). The env-var NAME
          // is not a credential — only its value is (ADR-0019).
          `Configured auth env key in "sut.environments.${name}" ${problem}; dropping that entry.`,
          undefined,
          { environment: name, entry: key },
        );
      }
    }
    return { ...environment, auth: { ...environment.auth, env: kept } };
  }

  /**
   * Structural repair for the `sut` section, run BEFORE the value-level
   * screening in {@link sanitizeRunnerEnvInputs}. Same posture as the value
   * checks — log + fall back, never break startup:
   *
   *  - a non-record `environments` map (null/array/scalar) → the defaults;
   *  - a non-record entry, or one whose `baseUrl` is not a string → replaced
   *    with the same-named default environment when one exists, else dropped;
   *  - a malformed `auth`/`auth.env` → auth stripped; a non-string `auth.env`
   *    VALUE → that entry dropped (the subprocess env requires string values;
   *    only the KEY is logged — the value may be a credential, ADR-0019);
   *  - an emptied map or a non-string `active` → the defaults, so startup
   *    always has an addressable active environment;
   *  - an `active` whose entry existed but was dropped by THIS repair →
   *    repointed to a surviving environment (PR #18 review: a repair-made
   *    dangle would silently run with an empty env). An `active` string naming
   *    an entry that never existed is left for validate() to flag.
   */
  private repairSutShape(sut: TestHubSettings["sut"]): TestHubSettings["sut"] {
    if (!isPlainRecord(sut.environments)) {
      this.logger.error(
        `Configured "sut.environments" is not an object; falling back to the defaults.`,
        undefined,
        { value: sut.environments },
      );
      return DEFAULT_SETTINGS.sut;
    }

    const environments = this.repairEnvironmentsRecord(sut.environments);

    if (Object.keys(environments).length === 0) {
      this.logger.error(
        `Configured "sut.environments" contains no usable environment; falling back to the defaults.`,
        undefined,
        {},
      );
      return DEFAULT_SETTINGS.sut;
    }

    return this.repairActive(sut.active, sut.environments, environments);
  }

  /**
   * Repairs each entry of the (already-confirmed-record) `environments` map,
   * dropping or defaulting malformed entries. See {@link repairSutShape} for
   * the per-concern posture this implements.
   */
  private repairEnvironmentsRecord(
    rawEnvironments: Record<string, unknown>,
  ): Record<string, SutEnvironment> {
    const environments: Record<string, SutEnvironment> = {};
    for (const [name, candidate] of Object.entries<unknown>(rawEnvironments)) {
      const repaired = this.repairEnvironmentEntry(name, candidate);
      if (repaired) environments[name] = repaired;
    }
    return environments;
  }

  /**
   * Repairs a single environment entry. A non-record entry (or one without a
   * string `baseUrl`) is replaced with the same-named default when one exists,
   * else dropped (returns `undefined`). Otherwise it is rebuilt from the known
   * fields so junk keys a tampered data.json added don't ride along.
   */
  private repairEnvironmentEntry(name: string, candidate: unknown): SutEnvironment | undefined {
    if (!isPlainRecord(candidate) || typeof candidate.baseUrl !== "string") {
      const fallback = DEFAULT_SETTINGS.sut.environments[name];
      this.logger.error(
        `Configured "sut.environments.${name}" is not an environment object; ` +
          (fallback ? `falling back to the default.` : `dropping it.`),
        undefined,
        { environment: name },
      );
      return fallback;
    }

    const auth = this.repairEnvironmentAuth(name, candidate.auth);
    // Rebuild from the known fields so junk keys a tampered data.json added
    // to an environment object don't ride along into the typed settings.
    return auth ? { baseUrl: candidate.baseUrl, auth } : { baseUrl: candidate.baseUrl };
  }

  /**
   * Repairs an environment's `auth`/`auth.env`: a malformed `auth`/`auth.env`
   * is stripped (returns `undefined`); a non-string `auth.env` VALUE drops that
   * entry (the subprocess env requires string values; only the KEY is logged —
   * the value may be a credential, ADR-0019).
   */
  private repairEnvironmentAuth(name: string, rawAuth: unknown): SutEnvironment["auth"] {
    if (rawAuth === undefined) return undefined;
    const rawEnv = isPlainRecord(rawAuth) ? rawAuth.env : undefined;
    if (!isPlainRecord(rawEnv)) {
      this.logger.error(
        `Configured "sut.environments.${name}.auth" is malformed; removing it.`,
        undefined,
        { environment: name },
      );
      return undefined;
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawEnv)) {
      if (typeof value === "string") {
        env[key] = value;
      } else {
        // KEY only — the value may be a credential (ADR-0019). Field
        // name `entry`, not `key`, so SENSITIVE_KEY doesn't blank it (F5).
        this.logger.error(
          `Configured auth env value in "sut.environments.${name}" is not a string; dropping that entry.`,
          undefined,
          { environment: name, entry: key },
        );
      }
    }
    return { env };
  }

  /**
   * Resolves the active environment against the repaired map. A non-string
   * `active`, or one whose entry existed but was dropped by THIS repair, is
   * repointed to a surviving environment so startup always has an addressable
   * active env. An `active` naming an entry that never existed is left as-is for
   * validate() to flag (that dangle is user-authored, not repair-made).
   */
  private repairActive(
    active: unknown,
    rawEnvironments: Record<string, unknown>,
    environments: Record<string, SutEnvironment>,
  ): TestHubSettings["sut"] {
    if (typeof active !== "string") {
      // Since WE pick the replacement here, it must point at a surviving
      // environment — the default name when it survived, else the first one.
      // (A user-authored active STRING that dangles is different: it is left
      // as-is below for validate() to flag, never silently rewritten.)
      const fallback = this.fallbackActive(environments);
      this.logger.error(
        `Configured "sut.active" is not a string; falling back to ${JSON.stringify(fallback)}.`,
        undefined,
        { value: active, fallback },
      );
      return { active: fallback, environments };
    }
    // Object.hasOwn (not `in`): an environment named "constructor"/"toString"
    // would hit the prototype chain with `in` and misreport as repair-dropped.
    if (!environments[active] && Object.hasOwn(rawEnvironments, active)) {
      // The active environment EXISTED in data.json but THIS repair just
      // dropped it as malformed (PR #18 review). Leaving the dangle would make
      // runEnv() silently execute with an empty env (no BASE_URL, no auth), so
      // repoint to a surviving environment exactly like the non-string repair
      // above. (An active naming an entry that never existed stays as-is for
      // validate() to flag — that dangle is user-authored, not repair-made.)
      const fallback = this.fallbackActive(environments);
      this.logger.error(
        `Configured "sut.active" pointed at the malformed environment ${JSON.stringify(active)} that was just dropped; falling back to ${JSON.stringify(fallback)}.`,
        undefined,
        { value: active, fallback },
      );
      return { active: fallback, environments };
    }
    return { active, environments };
  }

  /**
   * The repair-chosen active environment: the default name when it survived,
   * else the first surviving environment. Used only where THIS repair picks the
   * replacement, so it must point at a surviving environment.
   */
  private fallbackActive(environments: Record<string, SutEnvironment>): string {
    return environments[DEFAULT_SETTINGS.sut.active]
      ? DEFAULT_SETTINGS.sut.active
      : Object.keys(environments)[0];
  }

  save(settings: TestHubSettings): Promise<Result<void>> {
    return this.persistQueue.run(async () => {
      const validation = await this.validate(settings);
      if (!validation.valid) {
        return err(
          appError("SETTINGS_INVALID", "Settings failed validation.", {
            details: { errors: validation.errors },
          }),
        );
      }
      // Diff the persisted settings against the incoming ones so the event
      // carries the real changed field names (Event Catalog §13: { changedFields }).
      const previous = await this.load();
      const saved = await this.persist(settings);
      if (!saved.ok) return saved;
      const changedFields = diffSettings(previous, settings);
      await this.eventBus.publish(createEvent("settings.updated", { changedFields }));
      return ok(undefined);
    });
  }

  reset(correlationId?: string): Promise<Result<TestHubSettings>> {
    return this.persistQueue.run(async () => {
      const saved = await this.persist(DEFAULT_SETTINGS);
      if (!saved.ok) return saved;
      await this.eventBus.publish(
        createEvent("settings.reset", { profile: "default" }, { correlationId }),
      );
      return ok(DEFAULT_SETTINGS);
    });
  }

  async validate(settings: TestHubSettings): Promise<SettingsValidationResult> {
    const { errors, warnings } = await collectSettingsValidation(settings, {
      pathSafety: this.pathSafety,
      vaultFs: this.vaultFs,
    });
    const result: SettingsValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };
    // Event Catalog §13: { valid, warnings: string[] }. The full validation
    // messages stay on the returned result; the event carries warning text only.
    await this.eventBus.publish(
      createEvent("settings.validated", {
        valid: result.valid,
        warnings: warnings.map((warning) => warning.message),
      }),
    );
    return result;
  }
}

/**
 * Dotted field paths whose values differ between two settings objects, compared
 * section-by-section (one level deep, matching the mergeWithDefaults shape).
 * Each leaf is compared by JSON value so nested structures (e.g. environments)
 * register as a single changed field.
 */
const diffSettings = (before: TestHubSettings, after: TestHubSettings): string[] => {
  const changed: string[] = [];
  const sections = Object.keys(after) as (keyof TestHubSettings)[];
  for (const section of sections) {
    const beforeSection = before[section] as unknown as Record<string, unknown>;
    const afterSection = after[section] as unknown as Record<string, unknown>;
    const fields = new Set([
      ...Object.keys(beforeSection ?? {}),
      ...Object.keys(afterSection ?? {}),
    ]);
    for (const field of fields) {
      if (JSON.stringify(beforeSection?.[field]) !== JSON.stringify(afterSection?.[field])) {
        changed.push(`${section}.${field}`);
      }
    }
  }
  return changed;
};

/** Keeps only the string entries of a possibly-tampered array value. */
const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/**
 * Keeps only well-formed `{ index, captured? }` sequence-progress entries of a
 * possibly-tampered map: index must be a non-negative integer; a non-string
 * captured is dropped from the entry; anything else drops the entry.
 */
const sequenceProgressMap = (value: unknown): Record<string, OnboardingSequenceProgress> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const repaired: Record<string, OnboardingSequenceProgress> = {};
  for (const [stepId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { index, captures } = entry as { index?: unknown; captures?: unknown };
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) continue;
    if (!Array.isArray(captures)) continue;
    // A non-string capture degrades to null ("no capture"): correlation rules
    // then stall rather than widen, which is the safe failure mode.
    repaired[stepId] = {
      index,
      captures: captures.map((capture) => (typeof capture === "string" ? capture : null)),
    };
  }
  return repaired;
};

/**
 * Structural repair for the persisted `onboarding` section (same log-free,
 * never-break-startup posture as the other load screens — this section is
 * self-healing state, not user configuration, so silent fallback is fine):
 * non-string tourId → null; non-array step lists → []; non-string entries
 * dropped; malformed sequence-progress entries dropped; non-boolean
 * dismissed → false. Pure: no I/O.
 */
const repairOnboardingShape = (raw: OnboardingSettings): OnboardingSettings => ({
  tourId: typeof raw.tourId === "string" ? raw.tourId : null,
  completedSteps: stringArray(raw.completedSteps),
  skippedSteps: stringArray(raw.skippedSteps),
  sequenceProgress: sequenceProgressMap(raw.sequenceProgress),
  // typeof guard (not a `=== true` literal compare, which the lint forbids):
  // the field is TYPED boolean but a tampered/synced data.json can carry any
  // JSON value here, and a truthy string must still repair to false.
  dismissed: typeof raw.dismissed === "boolean" && raw.dismissed,
});

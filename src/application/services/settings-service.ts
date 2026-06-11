import type { DataStore } from "../ports/data-store";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import {
  authEnvKeyProblem,
  DEFAULT_SETTINGS,
  type OnboardingSequenceProgress,
  type OnboardingSettings,
  type SutEnvironment,
  type TestHubPathSettings,
  type TestHubSettings,
} from "../../domain/settings/settings";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { vaultPath } from "../../domain/value-objects/vault-path";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

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

export interface SettingsValidationMessage {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * True for a plain JSON record (not null, not an array). {@link mergeWithDefaults}
 * merges one level deep, so a tampered/synced `data.json` can place ANY JSON
 * shape at nested positions (`sut.environments: null`, an array, a string) —
 * consumers must re-establish "this is a record" before iterating, or
 * `Object.entries(null)` crashes settings load at plugin startup.
 */
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Runtime mirror of LoggingSettings["level"] for tamper repair on load. */
const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

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
  private persistChain: Promise<unknown> = Promise.resolve();

  /** Queues `task` behind every previously queued persistence task. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.persistChain.then(task);
    // The chain itself must survive a failed task; the failure still reaches
    // the caller through `run`.
    this.persistChain = run.catch(() => undefined);
    return run;
  }

  async load(): Promise<TestHubSettings> {
    const settings = this.sanitizeRunnerEnvInputs(
      this.sanitizePaths(mergeWithDefaults(await this.store.load())),
    );
    return { ...settings, onboarding: repairOnboardingShape(settings.onboarding) };
  }

  /**
   * Screens every configured path through PathSafetyPolicy on load. A
   * tampered/synced `data.json` could otherwise carry an unsafe path straight
   * into a code-generation sink (e.g. the `cucumber.mjs` feature glob, SEC-1 /
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

    // Structural repair FIRST: the value checks below (and Object.entries)
    // assume plain records, but the shallow merge preserves whatever shape
    // data.json carried (review finding: `environments: null` crashed load).
    const sut = this.repairSutShape(settings.sut);
    const environments: Record<string, SutEnvironment> = {};
    for (const [name, environment] of Object.entries(sut.environments)) {
      let env = environment;

      const authEnv = environment.auth?.env;
      if (authEnv && Object.keys(authEnv).some((key) => authEnvKeyProblem(key) !== undefined)) {
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
        env = { ...env, auth: { ...env.auth, env: kept } };
      }

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

      environments[name] = env;
    }

    return { ...settings, runner, sut: { ...sut, environments } };
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

    const environments: Record<string, SutEnvironment> = {};
    for (const [name, candidate] of Object.entries<unknown>(sut.environments)) {
      if (!isPlainRecord(candidate) || typeof candidate.baseUrl !== "string") {
        const fallback = DEFAULT_SETTINGS.sut.environments[name];
        this.logger.error(
          `Configured "sut.environments.${name}" is not an environment object; ` +
            (fallback ? `falling back to the default.` : `dropping it.`),
          undefined,
          { environment: name },
        );
        if (fallback) environments[name] = fallback;
        continue;
      }

      const rawAuth = candidate.auth;
      let auth: SutEnvironment["auth"];
      if (rawAuth !== undefined) {
        const rawEnv = isPlainRecord(rawAuth) ? rawAuth.env : undefined;
        if (!isPlainRecord(rawEnv)) {
          this.logger.error(
            `Configured "sut.environments.${name}.auth" is malformed; removing it.`,
            undefined,
            { environment: name },
          );
        } else {
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
          auth = { env };
        }
      }

      // Rebuild from the known fields so junk keys a tampered data.json added
      // to an environment object don't ride along into the typed settings.
      environments[name] = auth
        ? { baseUrl: candidate.baseUrl, auth }
        : { baseUrl: candidate.baseUrl };
    }

    if (Object.keys(environments).length === 0) {
      this.logger.error(
        `Configured "sut.environments" contains no usable environment; falling back to the defaults.`,
        undefined,
        {},
      );
      return DEFAULT_SETTINGS.sut;
    }

    if (typeof sut.active !== "string") {
      // Since WE pick the replacement here, it must point at a surviving
      // environment — the default name when it survived, else the first one.
      // (A user-authored active STRING that dangles is different: it is left
      // as-is below for validate() to flag, never silently rewritten.)
      const active = environments[DEFAULT_SETTINGS.sut.active]
        ? DEFAULT_SETTINGS.sut.active
        : Object.keys(environments)[0];
      this.logger.error(
        `Configured "sut.active" is not a string; falling back to ${JSON.stringify(active)}.`,
        undefined,
        { value: sut.active, fallback: active },
      );
      return { active, environments };
    }
    // Object.hasOwn (not `in`): an environment named "constructor"/"toString"
    // would hit the prototype chain with `in` and misreport as repair-dropped.
    if (!environments[sut.active] && Object.hasOwn(sut.environments, sut.active)) {
      // The active environment EXISTED in data.json but THIS repair just
      // dropped it as malformed (PR #18 review). Leaving the dangle would make
      // runEnv() silently execute with an empty env (no BASE_URL, no auth), so
      // repoint to a surviving environment exactly like the non-string repair
      // above. (An active naming an entry that never existed stays as-is for
      // validate() to flag — that dangle is user-authored, not repair-made.)
      const active = environments[DEFAULT_SETTINGS.sut.active]
        ? DEFAULT_SETTINGS.sut.active
        : Object.keys(environments)[0];
      this.logger.error(
        `Configured "sut.active" pointed at the malformed environment ${JSON.stringify(sut.active)} that was just dropped; falling back to ${JSON.stringify(active)}.`,
        undefined,
        { value: sut.active, fallback: active },
      );
      return { active, environments };
    }
    return { active: sut.active, environments };
  }

  save(settings: TestHubSettings): Promise<Result<void>> {
    return this.serialize(async () => {
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
      const saved = await this.store.save(settings);
      if (!saved.ok) return saved;
      const changedFields = diffSettings(previous, settings);
      await this.eventBus.publish(createEvent("settings.updated", { changedFields }));
      return ok(undefined);
    });
  }

  reset(correlationId?: string): Promise<Result<TestHubSettings>> {
    return this.serialize(async () => {
      const saved = await this.store.save(DEFAULT_SETTINGS);
      if (!saved.ok) return saved;
      await this.eventBus.publish(
        createEvent("settings.reset", { profile: "default" }, { correlationId }),
      );
      return ok(DEFAULT_SETTINGS);
    });
  }

  async validate(settings: TestHubSettings): Promise<SettingsValidationResult> {
    const errors: SettingsValidationMessage[] = [];
    const warnings: SettingsValidationMessage[] = [];

    for (const [field, value] of Object.entries(settings.paths) as [
      keyof TestHubPathSettings,
      VaultPath,
    ][]) {
      const safe = this.pathSafety.validate(value);
      if (!safe.ok) {
        errors.push({ field: `paths.${field}`, message: safe.error.message, severity: "error" });
      }
    }

    const loggingPath = this.pathSafety.validate(settings.logging.path);
    if (!loggingPath.ok) {
      errors.push({
        field: "logging.path",
        message: loggingPath.error.message,
        severity: "error",
      });
    }

    // Defensive shape guard: validate() is typed, but a caller can hand it a
    // pre-repair shape (raw merged data.json, adversarial tests). A non-record
    // map must validate as "active not defined" rather than crash.
    const environments = isPlainRecord(settings.sut.environments) ? settings.sut.environments : {};

    // Object.hasOwn (not a truthy index) for the same prototype-chain trap
    // repairSutShape documents: an active named "toString"/"constructor" with
    // no real environment would otherwise resolve a prototype member (truthy)
    // and slip past this error into the runner env builder.
    if (!Object.hasOwn(environments, settings.sut.active)) {
      errors.push({
        field: "sut.active",
        message: `Active environment "${settings.sut.active}" is not defined.`,
        severity: "error",
      });
    }

    // SEC: the values below feed the runner subprocess environment verbatim
    // (test-execution-service: `{ BASE_URL: active.baseUrl, ...auth.env }`),
    // so validate() must flag what {@link sanitizeRunnerEnvInputs} would have
    // to repair on load — keeping save() from ever persisting such a value.
    for (const [name, environment] of Object.entries(environments)) {
      if (!isPlainRecord(environment)) {
        errors.push({
          field: `sut.environments.${name}`,
          message: `Environment "${name}" is not an environment object.`,
          severity: "error",
        });
        continue;
      }
      // auth.env KEYS become environment-variable names in the child process
      // and `secrets.<KEY>` references in the generated workflow, so they must
      // be identifier-shaped AND not a reserved process-control variable (PATH,
      // NODE_OPTIONS, LD_*, …) that could redirect/inject the spawn. The rule is
      // shared with pipeline generation via {@link authEnvKeyProblem} in the
      // domain settings module. The CI-only `GITHUB_`-prefix rejection
      // deliberately stays in pipeline-generation-service: locally a `GITHUB_*`
      // env var is legitimate — it only fails as a GitHub repository SECRET name.
      for (const key of Object.keys(environment.auth?.env ?? {})) {
        const problem = authEnvKeyProblem(key);
        if (problem) {
          errors.push({
            field: `sut.environments.${name}.auth.env.${key}`,
            message: `Auth env key ${JSON.stringify(key)} ${problem}.`,
            severity: "error",
          });
        }
      }

      const urlProblem = baseUrlProblem(environment.baseUrl);
      if (urlProblem) {
        errors.push({
          field: `sut.environments.${name}.baseUrl`,
          message: `Environment "${name}" baseUrl ${urlProblem}.`,
          severity: "error",
        });
      } else if (environment.baseUrl.trim() === "") {
        // Empty baseUrl is a WARNING, not an error: it is incomplete
        // configuration rather than an injection vector (an empty BASE_URL is
        // inert in the child env), it is the load()-time fallback for a
        // tampered non-default environment, and erroring would block saving a
        // half-configured environment. DEFAULT_SETTINGS uses a non-empty
        // file:// demo fixture, so the defaults hit neither branch.
        warnings.push({
          field: `sut.environments.${name}.baseUrl`,
          message: `Environment "${name}" has an empty baseUrl; runs against it will receive an empty BASE_URL.`,
          severity: "warning",
        });
      }
    }

    // Bare names ("node") and absolute paths stay allowed — CommandSafetyPolicy
    // governs the basename at spawn time. Settings only reject what that check
    // cannot see: control characters/newlines and `..` traversal segments,
    // which could steer the spawn to a different binary than the basename
    // suggests.
    const nodeProblem = nodeExecutableProblem(settings.runner.nodeExecutable);
    if (nodeProblem) {
      errors.push({
        field: "runner.nodeExecutable",
        message: `Node executable ${nodeProblem}.`,
        severity: "error",
      });
    }

    if (!settings.ci.nodeVersion.trim()) {
      warnings.push({
        field: "ci.nodeVersion",
        message: "CI Node version is empty; the generated workflow may be invalid.",
        severity: "warning",
      });
    }

    // ADR-0015 one-project-per-vault: surface (as a WARNING, never an error so
    // the plugin still loads) any sibling/duplicate Test Hub folder.
    const siblingWarning = await this.detectSiblingTestHub(settings);
    if (siblingWarning) warnings.push(siblingWarning);

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

  /**
   * ADR-0015 (one project per vault): detect a sibling/duplicate `Test Hub`
   * folder colliding with the configured `testHubPath` and return it as a
   * single validation WARNING. Returns `undefined` (no-op) for the normal
   * single-folder vault, when no vault access is wired, or on any listing
   * failure (the check is advisory and must never break validation).
   *
   * Conservative interpretation — chosen because ADR-0015 only wants to flag
   * the "user copied another project's content into the vault" accident, and
   * because a warning (not a hard load failure) is the right severity for an
   * advisory data-hygiene problem:
   *
   *  - Only folders that are SIBLINGS of the configured Test Hub — i.e. share
   *    its parent directory — are considered. The settings model permits
   *    relocating `testHubPath` to a nested path (e.g. `QA/Test Hub`), and a
   *    sync/copy conflict ("Test Hub copy", "Test Hub 2") lands beside it in the
   *    SAME parent ("QA/Test Hub copy"); comparing by parent catches both the
   *    top-level and relocated cases. A folder under a different parent that
   *    merely happens to be named "Test Hub" is ignored (review P2).
   *  - A sibling collides when its base name equals the configured folder's base
   *    name, OR starts with it followed by a sync/copy-style suffix (a space/dash
   *    + "copy"/digits/"(n)"). A distinct folder that only shares a prefix word
   *    ("Test Hub Notes") is NOT flagged — avoiding false positives.
   *  - The configured folder itself is excluded; only an ADDITIONAL match
   *    triggers the warning.
   */
  private async detectSiblingTestHub(
    settings: TestHubSettings,
  ): Promise<SettingsValidationMessage | undefined> {
    if (!this.vaultFs) return undefined;

    const configured = settings.paths.testHubPath.trim();
    if (configured === "") return undefined;
    const configuredBase = baseName(configured);
    if (configuredBase === "") return undefined;
    const configuredKey = configuredBase.toLowerCase();
    // The parent the canonical Test Hub lives in ("" for a top-level folder,
    // "QA" for a relocated "QA/Test Hub"). Only folders in this same parent are
    // siblings; this is what makes the check work for a relocated testHubPath.
    const configuredParent = parentDir(configured);

    const listed = await this.vaultFs.listFolders();
    if (!listed.ok) return undefined; // advisory: never fail validation on a listing error

    const conflicts: string[] = [];
    const seen = new Set<string>();
    for (const folderPath of listed.value) {
      const trimmed = folderPath.trim();
      if (trimmed === "") continue;
      if (parentDir(trimmed) !== configuredParent) continue; // siblings only (same parent)
      if (trimmed === configured) continue; // the canonical Test Hub itself
      if (!isTestHubSibling(baseName(trimmed), configuredKey)) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push(trimmed);
    }

    if (conflicts.length === 0) return undefined;

    return {
      field: "paths.testHubPath",
      message:
        `More than one Test Hub folder was found in this vault ` +
        `(duplicates: ${conflicts.join(", ")}). A vault must contain exactly one ` +
        `Test Hub (ADR-0015). Remove or rename the duplicate(s) to avoid ambiguous ` +
        `roll-ups and ID generation.`,
      severity: "warning",
    };
  }
}

/**
 * C0 control characters + DEL. Any one of these in a value destined for the
 * runner subprocess env (or a downstream text sink) is a smuggling primitive —
 * a newline especially can split a value into extra lines/steps wherever it is
 * later rendered. Same class pipeline-generation-service rejects before
 * writing the workflow.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Protocols a SUT baseUrl may use; file: stays allowed for the demo fixture. */
const ALLOWED_BASE_URL_PROTOCOLS = new Set(["http:", "https:", "file:"]);

/**
 * Why these rules: `baseUrl` is injected verbatim into the runner subprocess
 * as `BASE_URL` (test-execution-service), so control characters are rejected
 * outright, and anything non-empty must parse as an http:/https:/file: URL so
 * a tampered value can't masquerade as something the runner would misuse
 * (DEFAULT_SETTINGS' demo environment is a `file://` fixture, hence file:).
 * Empty/whitespace-only is NOT a problem here — it is incomplete configuration,
 * not an injection vector; `validate()` surfaces it as a warning instead.
 * Returns the problem text, or `undefined` when the value is acceptable.
 * Pure: shared by validate() and load()-time sanitization so the two can't
 * drift apart.
 */
const baseUrlProblem = (value: string): string | undefined => {
  // Runtime shape defense: the parameter is typed, but adversarial settings
  // shapes can reach the validate() path before load()-time repair has run.
  if (typeof value !== "string") return "is not a string";
  if (CONTROL_CHARS.test(value)) return "contains a control character";
  if (value.trim() === "") return undefined; // warning-level, handled by callers
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    return `is not a parseable URL: ${JSON.stringify(value)}`;
  }
  if (!ALLOWED_BASE_URL_PROTOCOLS.has(protocol)) {
    return `uses unsupported protocol "${protocol}" (allowed: http:, https:, file:)`;
  }
  return undefined;
};

/**
 * Absolute executable path on either platform: POSIX `/usr/bin/node`, a
 * Windows drive path `C:\nodejs\node.exe` (or `C:/…`), or a UNC share
 * `\\server\tools\node.exe`.
 */
const isAbsoluteExecutablePath = (value: string): boolean =>
  value.startsWith("/") || /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");

/**
 * Why these rules: CommandSafetyPolicy allowlists the node executable's
 * BASENAME only, so settings must reject what that check cannot see — control
 * characters/newlines, `..` traversal segments, and RELATIVE paths with
 * separators. The runner spawns from the vault, so a vault-relative value
 * like `evil/node` (no `..` needed) would execute a binary an attacker
 * synced/committed INTO the vault while still ending in the trusted basename
 * (PR #18 review). Separators are checked on BOTH `/` and `\` so a
 * Windows-style `..\\evil\\node` can't slip through on a POSIX host. Bare
 * names ("node", resolved via PATH) and absolute paths remain allowed.
 * Returns the problem text, or `undefined`.
 */
const nodeExecutableProblem = (value: string): string | undefined => {
  // Runtime shape defense, mirroring baseUrlProblem.
  if (typeof value !== "string") return "is not a string";
  if (CONTROL_CHARS.test(value)) return "contains a control character";
  if (value.split(/[/\\]/).includes("..")) return 'contains a ".." path traversal segment';
  if (/[/\\]/.test(value) && !isAbsoluteExecutablePath(value)) {
    return "is a relative path; use a bare command name or an absolute path";
  }
  return undefined;
};

/** Last `/`-separated, non-empty segment of a vault path. */
const baseName = (path: string): string => {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.length === 0 ? "" : parts[parts.length - 1];
};

/** Parent directory of a vault path ("" for a top-level folder), normalized. */
const parentDir = (path: string): string => {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.slice(0, -1).join("/");
};

/**
 * True when `folderBaseName` (a folder's final segment) is a sync/copy-style
 * duplicate of the configured Test Hub's base name. Matches an exact name or the
 * base name followed by a conflict suffix (" 1", "-2", " copy", "copy", " (1)");
 * a folder whose suffix is a real alphabetic word (e.g. "test hub notes") is NOT
 * a duplicate.
 */
const isTestHubSibling = (folderBaseName: string, configuredKey: string): boolean => {
  const key = folderBaseName.toLowerCase();
  if (key === configuredKey) return true;
  if (!key.startsWith(configuredKey)) return false;
  const suffix = key.slice(configuredKey.length).trim();
  return /^[-_]?\s*(copy|\(?\d+\)?)?$/.test(suffix);
};

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
    const { index, captured } = entry as { index?: unknown; captured?: unknown };
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) continue;
    repaired[stepId] = typeof captured === "string" ? { index, captured } : { index };
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
  dismissed: raw.dismissed === true,
});

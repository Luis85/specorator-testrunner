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
import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import type { Logger } from "../../shared/logging/logger";
import { baseUrlProblem, nodeExecutableProblem, repairBrowsers } from "./settings-field-rules";
import { repairSutShape } from "./settings-sut-repair";

/**
 * Load-time sanitization & structural repair for the settings section
 * (TIS §5.9). A tampered/synced `data.json` can carry ANY JSON shape (the
 * merge is one level deep), and several of these values reach security sinks —
 * the runner subprocess env (`BASE_URL` + `auth.env`), the node executable
 * spawn, and code-generation path sinks. `save()` validates, but historically
 * `load()` did not, so every screen here logs + falls back/drops the bad value
 * so it never reaches a sink, WITHOUT breaking normal startup. The verdict
 * rules are the {@link ./settings-field-rules} primitives shared with
 * save-time validation so the two paths can't drift apart.
 */

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

/**
 * Repairs `ci.*` / `automation.*` scalars with the same log-and-fallback
 * posture as {@link sanitizePaths}: a tampered/synced data.json must not crash
 * `.trim()` call sites or flip automation behaviour with truthy garbage.
 */
const sanitizeScalarShapes = (settings: TestHubSettings, logger: Logger): TestHubSettings => {
  const repair = <T>(field: string, value: unknown, valid: boolean, fallback: T): T => {
    if (valid) return value as T;
    logger.error(
      `Configured "${field}" has an invalid value; falling back to the default.`,
      undefined,
      {
        field,
        value,
        fallback,
      },
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
  const historyDepth = settings.automation.historyDepth;
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
      // undefined = default depth (HISTORY_DEPTH_DEFAULT, US-057). Preserve a
      // valid configured value across load so the projection window honors it.
      // Must be a positive INTEGER: a fractional value (e.g. a synced/hand-
      // edited 0.5) floors to 0 in the history projection, producing records
      // with no `latest` and an unservable cache (codex P2).
      historyDepth: repair<number | undefined>(
        "automation.historyDepth",
        historyDepth,
        historyDepth === undefined ||
          (typeof historyDepth === "number" && Number.isInteger(historyDepth) && historyDepth > 0),
        undefined,
      ),
    } satisfies AutomationSettings,
  };
};

/**
 * Screens every configured path through PathSafetyPolicy on load. A
 * tampered/synced `data.json` could otherwise carry an unsafe path straight
 * into a code-generation sink (e.g. the `playwright.config.ts` feature glob,
 * SEC-1 / P0-1). Any unsafe path is logged and replaced with its
 * `DEFAULT_SETTINGS` value so the unsafe value never reaches the runner
 * generator, without breaking normal startup. `logging.level` and
 * `logging.path` get the same posture.
 */
const sanitizePaths = (
  settings: TestHubSettings,
  logger: Logger,
  pathSafety: PathSafetyPolicy,
): TestHubSettings => {
  const paths = { ...settings.paths };
  for (const field of Object.keys(paths) as (keyof TestHubPathSettings)[]) {
    // The `vaultPath` smart constructor validates AND brands in one call (using
    // the injected policy), so validation and branding can't drift apart — this
    // is the ADR-0008 load-time chokepoint. An unsafe path is logged and
    // replaced with its default so it never reaches the runner generator.
    const safe = vaultPath(paths[field], pathSafety);
    if (safe.ok) {
      paths[field] = safe.value;
    } else {
      logger.error(
        `Configured path "paths.${field}" is unsafe; falling back to the default.`,
        safe.error,
        {
          field,
          value: paths[field],
          fallback: DEFAULT_SETTINGS.paths[field],
        },
      );
      paths[field] = DEFAULT_SETTINGS.paths[field];
    }
  }
  // logging.level is consumed directly by the composition root's setMinLevel;
  // an out-of-union value (tampered/synced data.json) would make
  // LEVEL_ORDER[level] undefined and silently DISABLE the level filter for the
  // whole session — repair it with the same log-and-fallback posture.
  let level = settings.logging.level;
  if (!LOG_LEVELS.has(level)) {
    logger.error(
      `Configured "logging.level" is not a valid level; falling back to the default.`,
      undefined,
      {
        value: level,
        fallback: DEFAULT_SETTINGS.logging.level,
      },
    );
    level = DEFAULT_SETTINGS.logging.level;
  }

  const loggingPath = vaultPath(settings.logging.path, pathSafety);
  if (!loggingPath.ok) {
    logger.error(
      `Configured path "logging.path" is unsafe; falling back to the default.`,
      loggingPath.error,
      {
        value: settings.logging.path,
        fallback: DEFAULT_SETTINGS.logging.path,
      },
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
};

/**
 * Screens the settings values that reach the runner child process on load
 * (the env-injection sink: test-execution-service builds the subprocess env as
 * `{ BASE_URL: active.baseUrl, ...active.auth.env }` VERBATIM). Structural
 * repair of the `sut` shape runs FIRST (the value checks assume plain records),
 * then the per-environment value screening.
 */
const sanitizeRunnerEnvInputs = (settings: TestHubSettings, logger: Logger): TestHubSettings => {
  let runner = settings.runner;
  const nodeProblem = nodeExecutableProblem(runner.nodeExecutable);
  if (nodeProblem) {
    logger.error(
      `Configured "runner.nodeExecutable" ${nodeProblem}; falling back to the default.`,
      undefined,
      {
        value: runner.nodeExecutable,
        fallback: DEFAULT_SETTINGS.runner.nodeExecutable,
      },
    );
    runner = { ...runner, nodeExecutable: DEFAULT_SETTINGS.runner.nodeExecutable };
  }

  const browsers = repairBrowsers(runner.browsers);
  if (browsers.repaired) {
    logger.error(
      `Configured "runner.browsers" was invalid; falling back to a valid set.`,
      undefined,
      {
        value: runner.browsers,
        fallback: browsers.browsers,
      },
    );
  }
  runner = { ...runner, browsers: browsers.browsers };

  const sut = repairSutShape(settings.sut, logger);
  const environments: Record<string, SutEnvironment> = {};
  for (const [name, environment] of Object.entries(sut.environments)) {
    environments[name] = screenEnvironmentValues(name, environment, logger);
  }

  return { ...settings, runner, sut: { ...sut, environments } };
};

/**
 * Value-level screening for a single (structurally-repaired) environment:
 * screens the `auth.env` keys then the `baseUrl` (log + drop/replace, never
 * break startup). See {@link sanitizeRunnerEnvInputs} for the sink rationale.
 */
const screenEnvironmentValues = (
  name: string,
  environment: SutEnvironment,
  logger: Logger,
): SutEnvironment => {
  let env = screenAuthEnvKeys(name, environment, logger);

  const urlProblem = baseUrlProblem(env.baseUrl);
  if (urlProblem) {
    const fallback = DEFAULT_SETTINGS.sut.environments[name]?.baseUrl ?? "";
    logger.error(
      `Configured "sut.environments.${name}.baseUrl" ${urlProblem}; falling back to ${JSON.stringify(fallback)}.`,
      undefined,
      { environment: name, value: env.baseUrl, fallback },
    );
    env = { ...env, baseUrl: fallback };
  }

  return env;
};

/**
 * Drops any `auth.env` KEY that fails {@link authEnvKeyProblem}, keeping valid
 * siblings. Reserved process-control keys (PATH, NODE_OPTIONS, …) are dropped
 * here too. Returns the environment unchanged when every key is valid.
 */
const screenAuthEnvKeys = (
  name: string,
  environment: SutEnvironment,
  logger: Logger,
): SutEnvironment => {
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
      // ADR-0019). Field name `entry`, not `key`: the logger's SENSITIVE_KEY
      // pattern matches the field NAME "key" and would blank exactly the
      // diagnostic this log exists to carry (F5).
      logger.error(
        `Configured auth env key in "sut.environments.${name}" ${problem}; dropping that entry.`,
        undefined,
        { environment: name, entry: key },
      );
    }
  }
  return { ...environment, auth: { ...environment.auth, env: kept } };
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
 * Structural repair for the persisted `onboarding` section (same never-break-
 * startup posture; this section is self-healing state, not user configuration,
 * so silent fallback is fine). Pure: no I/O.
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

/**
 * The full load-time screen: merge persisted data over defaults, then run the
 * scalar / path / runner-env / sut-shape repairs and the onboarding repair, so
 * a tampered/synced `data.json` can never reach a sink. The schema-version
 * staleness reset stays in the service (it owns persistence).
 */
export const sanitizeLoadedSettings = (
  raw: unknown,
  deps: { logger: Logger; pathSafety: PathSafetyPolicy },
): TestHubSettings => {
  const settings = sanitizeScalarShapes(
    sanitizeRunnerEnvInputs(
      sanitizePaths(mergeWithDefaults(raw), deps.logger, deps.pathSafety),
      deps.logger,
    ),
    deps.logger,
  );
  return { ...settings, onboarding: repairOnboardingShape(settings.onboarding) };
};

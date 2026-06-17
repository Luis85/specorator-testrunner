import {
  DEFAULT_SETTINGS,
  type SutEnvironment,
  type TestHubSettings,
} from "../../domain/settings/settings";
import type { Logger } from "../../shared/logging/logger";
import { isPlainRecord } from "./settings-field-rules";

/**
 * Structural repair of the persisted `sut` section, run on load BEFORE the
 * value-level screening (the value checks and `Object.entries` assume plain
 * records, but the shallow settings merge preserves whatever shape a
 * tampered/synced `data.json` carried — `environments: null` once crashed
 * load). Same log + fall back, never break startup posture as the rest of the
 * load-time sanitization, and it always leaves an addressable active
 * environment.
 */

/**
 * Structural repair for the `sut` section, run BEFORE the value-level
 * screening — same log + fall back, never break startup posture: a non-record
 * `environments` map → the defaults; an emptied map → the defaults; otherwise
 * the per-entry repair and an `active` resolution that always leaves an
 * addressable active environment.
 */
export const repairSutShape = (
  sut: TestHubSettings["sut"],
  logger: Logger,
): TestHubSettings["sut"] => {
  if (!isPlainRecord(sut.environments)) {
    logger.error(
      `Configured "sut.environments" is not an object; falling back to the defaults.`,
      undefined,
      {
        value: sut.environments,
      },
    );
    return DEFAULT_SETTINGS.sut;
  }

  const environments = repairEnvironmentsRecord(sut.environments, logger);

  if (Object.keys(environments).length === 0) {
    logger.error(
      `Configured "sut.environments" contains no usable environment; falling back to the defaults.`,
      undefined,
      {},
    );
    return DEFAULT_SETTINGS.sut;
  }

  return repairActive(sut.active, sut.environments, environments, logger);
};

/**
 * Repairs each entry of the (already-confirmed-record) `environments` map,
 * dropping or defaulting malformed entries.
 */
const repairEnvironmentsRecord = (
  rawEnvironments: Record<string, unknown>,
  logger: Logger,
): Record<string, SutEnvironment> => {
  const environments: Record<string, SutEnvironment> = {};
  for (const [name, candidate] of Object.entries<unknown>(rawEnvironments)) {
    const repaired = repairEnvironmentEntry(name, candidate, logger);
    if (repaired) environments[name] = repaired;
  }
  return environments;
};

/**
 * Repairs a single environment entry. A non-record entry (or one without a
 * string `baseUrl`) is replaced with the same-named default when one exists,
 * else dropped. Otherwise it is rebuilt from the known fields so junk keys a
 * tampered data.json added don't ride along.
 */
const repairEnvironmentEntry = (
  name: string,
  candidate: unknown,
  logger: Logger,
): SutEnvironment | undefined => {
  if (!isPlainRecord(candidate) || typeof candidate.baseUrl !== "string") {
    const fallback = DEFAULT_SETTINGS.sut.environments[name];
    logger.error(
      `Configured "sut.environments.${name}" is not an environment object; ` +
        (fallback ? `falling back to the default.` : `dropping it.`),
      undefined,
      { environment: name },
    );
    return fallback;
  }

  const auth = repairEnvironmentAuth(name, candidate.auth, logger);
  return auth ? { baseUrl: candidate.baseUrl, auth } : { baseUrl: candidate.baseUrl };
};

/**
 * Repairs an environment's `auth`/`auth.env`: a malformed `auth`/`auth.env` is
 * stripped (returns `undefined`); a non-string `auth.env` VALUE drops that
 * entry (the subprocess env requires string values; only the KEY is logged —
 * the value may be a credential, ADR-0019).
 */
const repairEnvironmentAuth = (
  name: string,
  rawAuth: unknown,
  logger: Logger,
): SutEnvironment["auth"] => {
  if (rawAuth === undefined) return undefined;
  const rawEnv = isPlainRecord(rawAuth) ? rawAuth.env : undefined;
  if (!isPlainRecord(rawEnv)) {
    logger.error(
      `Configured "sut.environments.${name}.auth" is malformed; removing it.`,
      undefined,
      {
        environment: name,
      },
    );
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    } else {
      // KEY only — the value may be a credential (ADR-0019). Field name
      // `entry`, not `key`, so SENSITIVE_KEY doesn't blank it (F5).
      logger.error(
        `Configured auth env value in "sut.environments.${name}" is not a string; dropping that entry.`,
        undefined,
        { environment: name, entry: key },
      );
    }
  }
  return { env };
};

/**
 * Resolves the active environment against the repaired map. A non-string
 * `active`, or one whose entry existed but was dropped by THIS repair, is
 * repointed to a surviving environment so startup always has an addressable
 * active env. An `active` naming an entry that never existed is left as-is for
 * validate() to flag (that dangle is user-authored, not repair-made).
 */
const repairActive = (
  active: unknown,
  rawEnvironments: Record<string, unknown>,
  environments: Record<string, SutEnvironment>,
  logger: Logger,
): TestHubSettings["sut"] => {
  if (typeof active !== "string") {
    const fallback = fallbackActive(environments);
    logger.error(
      `Configured "sut.active" is not a string; falling back to ${JSON.stringify(fallback)}.`,
      undefined,
      {
        value: active,
        fallback,
      },
    );
    return { active: fallback, environments };
  }
  // Object.hasOwn (not `in`): an environment named "constructor"/"toString"
  // would hit the prototype chain with `in` and misreport as repair-dropped.
  if (!environments[active] && Object.hasOwn(rawEnvironments, active)) {
    // The active environment EXISTED in data.json but THIS repair just dropped
    // it as malformed (PR #18 review). Leaving the dangle would make runEnv()
    // silently execute with an empty env, so repoint to a surviving environment.
    const fallback = fallbackActive(environments);
    logger.error(
      `Configured "sut.active" pointed at the malformed environment ${JSON.stringify(active)} that was just dropped; falling back to ${JSON.stringify(fallback)}.`,
      undefined,
      { value: active, fallback },
    );
    return { active: fallback, environments };
  }
  return { active, environments };
};

/**
 * The repair-chosen active environment: the default name when it survived, else
 * the first surviving environment. Used only where THIS repair picks the
 * replacement, so it must point at a surviving environment.
 */
const fallbackActive = (environments: Record<string, SutEnvironment>): string =>
  environments[DEFAULT_SETTINGS.sut.active]
    ? DEFAULT_SETTINGS.sut.active
    : Object.keys(environments)[0];

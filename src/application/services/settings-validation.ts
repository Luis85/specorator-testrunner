import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import {
  authEnvKeyProblem,
  type SutEnvironment,
  type TestHubPathSettings,
  type TestHubSettings,
} from "../../domain/settings/settings";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { VaultFileSystem } from "../ports/vault-file-system";
import { baseUrlProblem, isPlainRecord, nodeExecutableProblem } from "./settings-field-rules";

/**
 * Save-time validation for the settings section (TIS §5.9). Each section
 * validator is a pure single-responsibility unit returning its own
 * errors/warnings; {@link collectSettingsValidation} concatenates them and the
 * service computes the single `valid` verdict (and emits `settings.validated`)
 * from the merged result. The rules deliberately mirror what the load-time
 * sanitization would have to repair, sharing the same {@link
 * ./settings-field-rules} primitives so the two paths can't drift apart.
 */
export interface SettingsValidationMessage {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Errors + warnings produced by one section validator. The per-section split
 * keeps each validator single-responsibility; the `valid` verdict is computed
 * once, on the merged result.
 */
interface ValidationMessages {
  errors: SettingsValidationMessage[];
  warnings: SettingsValidationMessage[];
}

/** Screens every configured path (and `logging.path`) through PathSafetyPolicy. */
const validatePaths = (
  settings: TestHubSettings,
  pathSafety: PathSafetyPolicy,
): ValidationMessages => {
  const errors: SettingsValidationMessage[] = [];

  for (const [field, value] of Object.entries(settings.paths) as [
    keyof TestHubPathSettings,
    VaultPath,
  ][]) {
    const safe = pathSafety.validate(value);
    if (!safe.ok) {
      errors.push({ field: `paths.${field}`, message: safe.error.message, severity: "error" });
    }
  }

  const loggingPath = pathSafety.validate(settings.logging.path);
  if (!loggingPath.ok) {
    errors.push({
      field: "logging.path",
      message: loggingPath.error.message,
      severity: "error",
    });
  }

  return { errors, warnings: [] };
};

/**
 * Validates the `sut` section: the active environment resolves, and every
 * environment's auth-env keys + baseUrl pass the same screens the load-time
 * sanitization would have to repair.
 */
const validateSut = (settings: TestHubSettings): ValidationMessages => {
  const errors: SettingsValidationMessage[] = [];
  const warnings: SettingsValidationMessage[] = [];

  // Defensive shape guard: validate() is typed, but a caller can hand it a
  // pre-repair shape (raw merged data.json, adversarial tests). A non-record
  // map must validate as "active not defined" rather than crash.
  const environments = isPlainRecord(settings.sut.environments) ? settings.sut.environments : {};

  // Object.hasOwn (not a truthy index) for the same prototype-chain trap
  // the sut repair documents: an active named "toString"/"constructor" with
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
  // so validate() must flag what the load-time sanitization would have to
  // repair — keeping save() from ever persisting such a value.
  for (const [name, environment] of Object.entries(environments)) {
    const messages = validateSutEnvironment(name, environment);
    errors.push(...messages.errors);
    warnings.push(...messages.warnings);
  }

  return { errors, warnings };
};

/**
 * Validates a single SUT environment's auth-env keys and baseUrl (the runner
 * env-injection sink). See {@link validateSut} for the SEC rationale.
 */
const validateSutEnvironment = (name: string, environment: SutEnvironment): ValidationMessages => {
  if (!isPlainRecord(environment)) {
    return {
      errors: [
        {
          field: `sut.environments.${name}`,
          message: `Environment "${name}" is not an environment object.`,
          severity: "error",
        },
      ],
      warnings: [],
    };
  }

  const errors: SettingsValidationMessage[] = [];
  const warnings: SettingsValidationMessage[] = [];

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

  return { errors, warnings };
};

/** Validates `runner.nodeExecutable` against what CommandSafetyPolicy can't see. */
const validateRunner = (settings: TestHubSettings): ValidationMessages => {
  // Bare names ("node") and absolute paths stay allowed — CommandSafetyPolicy
  // governs the basename at spawn time. Settings only reject what that check
  // cannot see: control characters/newlines and `..` traversal segments,
  // which could steer the spawn to a different binary than the basename
  // suggests.
  const nodeProblem = nodeExecutableProblem(settings.runner.nodeExecutable);
  if (!nodeProblem) return { errors: [], warnings: [] };
  return {
    errors: [
      {
        field: "runner.nodeExecutable",
        message: `Node executable ${nodeProblem}.`,
        severity: "error",
      },
    ],
    warnings: [],
  };
};

/** Validates the `ci` section (currently the workflow Node version). */
const validateCi = (settings: TestHubSettings): ValidationMessages => {
  if (settings.ci.nodeVersion.trim()) return { errors: [], warnings: [] };
  return {
    errors: [],
    warnings: [
      {
        field: "ci.nodeVersion",
        message: "CI Node version is empty; the generated workflow may be invalid.",
        severity: "warning",
      },
    ],
  };
};

/**
 * ADR-0015 one-project-per-vault: surface (as a WARNING, never an error so
 * the plugin still loads) any sibling/duplicate Test Hub folder.
 */
const validateVaultLayout = async (
  settings: TestHubSettings,
  vaultFs?: VaultFileSystem,
): Promise<ValidationMessages> => {
  const siblingWarning = await detectSiblingTestHub(settings, vaultFs);
  return { errors: [], warnings: siblingWarning ? [siblingWarning] : [] };
};

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
const detectSiblingTestHub = async (
  settings: TestHubSettings,
  vaultFs?: VaultFileSystem,
): Promise<SettingsValidationMessage | undefined> => {
  if (!vaultFs) return undefined;

  const configured = settings.paths.testHubPath.trim();
  if (configured === "") return undefined;
  const configuredBase = baseName(configured);
  if (configuredBase === "") return undefined;
  const configuredKey = configuredBase.toLowerCase();
  // The parent the canonical Test Hub lives in ("" for a top-level folder,
  // "QA" for a relocated "QA/Test Hub"). Only folders in this same parent are
  // siblings; this is what makes the check work for a relocated testHubPath.
  const configuredParent = parentDir(configured);

  const listed = await vaultFs.listFolders();
  if (!listed.ok) return undefined; // advisory: never fail validation on a listing error

  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const folderPath of listed.value) {
    const trimmed = folderPath.trim();
    if (!isConflictingTestHubSibling(trimmed, configured, configuredParent, configuredKey)) {
      continue;
    }
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
 * True when a listed vault folder is an ADDITIONAL Test Hub colliding with the
 * configured one: it is non-empty, a SIBLING (same parent, so a relocated
 * `QA/Test Hub` is handled), not the canonical Test Hub itself, and a
 * sync/copy-style duplicate by base name ({@link isTestHubSibling}). Pure —
 * see {@link detectSiblingTestHub} for the ADR-0015 rationale this implements.
 */
const isConflictingTestHubSibling = (
  trimmed: string,
  configured: string,
  configuredParent: string,
  configuredKey: string,
): boolean => {
  if (trimmed === "") return false;
  if (parentDir(trimmed) !== configuredParent) return false; // siblings only (same parent)
  if (trimmed === configured) return false; // the canonical Test Hub itself
  return isTestHubSibling(baseName(trimmed), configuredKey);
};

/**
 * Runs every settings section validator and merges their messages, in the
 * order the service published them. The `valid` verdict and the
 * `settings.validated` event stay with the service; this collects the raw
 * errors/warnings it computes them from.
 */
export const collectSettingsValidation = async (
  settings: TestHubSettings,
  deps: { pathSafety: PathSafetyPolicy; vaultFs?: VaultFileSystem },
): Promise<{ errors: SettingsValidationMessage[]; warnings: SettingsValidationMessage[] }> => {
  const errors: SettingsValidationMessage[] = [];
  const warnings: SettingsValidationMessage[] = [];

  const sections: ValidationMessages[] = [
    validatePaths(settings, deps.pathSafety),
    validateSut(settings),
    validateRunner(settings),
    validateCi(settings),
    await validateVaultLayout(settings, deps.vaultFs),
  ];
  for (const section of sections) {
    errors.push(...section.errors);
    warnings.push(...section.warnings);
  }

  return { errors, warnings };
};

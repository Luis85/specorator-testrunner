import type { VaultPath } from "../value-objects/identifiers";
import { unsafeVaultPath } from "../value-objects/vault-path";

/** Plugin configuration (TIS §5). */

export type PackageManager = "npm"; // V1 fixed per AD-2

export type CiProvider = "github-actions" | "azure-devops" | "none";

export interface TestHubPathSettings {
  testHubPath: VaultPath;
  useCasesPath: VaultPath;
  prdsPath: VaultPath;
  domainsPath: VaultPath;
  specificationsPath: VaultPath;
  featureFilesPath: VaultPath;
  testSuitesPath: VaultPath;
  evidencePath: VaultPath;
  documentationPath: VaultPath;
  testRunnerPath: VaultPath;
}

export type BrowserName = "chromium" | "firefox" | "webkit";
export const BROWSER_NAMES: readonly BrowserName[] = ["chromium", "firefox", "webkit"];

export interface RunnerSettings {
  packageManager: PackageManager;
  nodeExecutable: string;
  installCommand: string; // `npm install` for local
  ciInstallCommand: string; // `npm ci` for CI
  browserInstallCommand: string;
  browsers: BrowserName[]; // non-empty; which Playwright projects to run (US-055)
  defaultRunCommand: string;
  smokeRunCommand: string;
  ciRunCommand: string;
}

export interface AutomationSettings {
  autoCreateFolders: boolean;
  autoCreateDocumentation: boolean;
  autoCreateDemoContent: boolean;
  updateUseCaseFrontmatterAfterRun: boolean;
  generateEvidenceMarkdown: boolean;
  openDashboardAfterInitialization: boolean;
  evidenceRetentionDays?: number; // undefined = keep forever (V1 default)
}

export interface CiSettings {
  provider: CiProvider;
  workflowPath: string; // repo-root path; not a VaultPath
  nodeVersion: string;
}

export interface SutAuth {
  // Keys are injected verbatim into the runner subprocess as env vars.
  env: Record<string, string>;
}

export interface SutEnvironment {
  baseUrl: string;
  auth?: SutAuth;
}

export interface SutSettings {
  active: string; // key into environments
  environments: Record<string, SutEnvironment>;
}

export interface LoggingSettings {
  enabled: boolean; // master switch for the persistent file sink
  path: VaultPath; // default "Test Hub/logs"
  level: "debug" | "info" | "warn" | "error";
}

/**
 * Mid-flight progress of one tour step's event-sequence: the index of the rule
 * it is waiting for next, and the values the already-matched rules captured
 * (suiteId / runId / feature path the later rules correlate on). One entry per
 * matched rule, `null` for a rule that captures nothing — kept per rule (not a
 * single slot) so a failed-attempt reset can roll back to an earlier rule
 * without losing ITS correlation value.
 */
export interface OnboardingSequenceProgress {
  index: number;
  captures: (string | null)[];
}

/**
 * Guided Tour progress (spec 2026-06-11). Persisted with the settings so a
 * UC-024 reset clears it together with everything else. Step ids are stored as
 * plain strings here; the GuidedTourService (which owns the step table)
 * ignores ids it does not know.
 */
export interface OnboardingSettings {
  /** Correlation id of the current tour traversal; null until the tour starts. */
  tourId: string | null;
  completedSteps: string[];
  skippedSteps: string[];
  /**
   * Event-sequence progress per step id. Persisted because the events that
   * START a sequence (suite.created, stepdefinition.generated) cannot re-fire
   * once their artifact exists — losing this across a reload would dead-end
   * the tour (PR #31 Codex review).
   */
  sequenceProgress: Record<string, OnboardingSequenceProgress>;
  /** Hides the dashboard CTA only; the Open guided tour command always reopens. */
  dismissed: boolean;
}

export interface TestHubSettings {
  paths: TestHubPathSettings;
  runner: RunnerSettings;
  automation: AutomationSettings;
  ci: CiSettings;
  sut: SutSettings; // per ADR-0013 + ADR-0014
  logging: LoggingSettings; // per ADR-0019
  onboarding: OnboardingSettings;
}

/**
 * Collects every SUT credential VALUE across all environments' `auth.env`
 * (ADR-0019). The Logger redacts these positionally so a value logged under a
 * non-sensitive key (e.g. streamed runner stderr) is still scrubbed (P0-2 /
 * T3). Pure: trivially testable, no I/O.
 */
const MIN_CREDENTIAL_LEN = 4;

export const collectCredentialValues = (settings: TestHubSettings): string[] =>
  Object.values(settings.sut.environments)
    .flatMap((env) => Object.values(env.auth?.env ?? {}))
    .filter((value) => value.length >= MIN_CREDENTIAL_LEN);

/**
 * Identifier shape an `auth.env` KEY must have to be safe in BOTH env-var
 * sinks: the local runner subprocess environment (test-execution-service
 * injects `{ BASE_URL, ...auth.env }` verbatim) and the generated GitHub
 * Actions workflow (rendered as `secrets.<KEY>` / YAML map keys). A key with
 * any other character could smuggle YAML syntax into the workflow or mint a
 * malformed/hostile variable in the child process, so both chokepoints apply
 * one rule.
 *
 * Lives in the domain settings module so every consumer shares the ONE rule:
 * settings-service (load sanitization + validate) and
 * pipeline-generation-service (which layers its CI-only `GITHUB_`-prefix
 * rejection on top — that prefix is NOT part of this rule, because locally a
 * `GITHUB_*` env var is legitimate; it only fails as a GitHub repository
 * SECRET name). Pure: no I/O.
 */
const isValidAuthEnvKey = (key: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);

/**
 * Env-var names that are NOT credentials but control how the runner PROCESS
 * resolves binaries or loads code. They are identifier-shaped, so they pass
 * {@link isValidAuthEnvKey} — yet `auth.env` is spread over the child's
 * `process.env` into the `npm`/`node` spawn (TestExecutionService.runEnv →
 * NodeChildProcessRunner), so a synced/tampered `data.json` could use one to
 * escalate from "set a credential" to "run my code":
 *  - `PATH`/`COMSPEC`/`SHELL` redirect which `npm`/`node`/shell binary runs;
 *  - `NODE_OPTIONS` (`--require ./evil.js`), `NODE_PATH`, `BASH_ENV`/`ENV`
 *    inject code into the spawned Node/shell;
 *  - the `LD_*`/`DYLD_*` loader families inject native libraries;
 *  - `NPM_CONFIG_*` overrides npm itself (e.g. `npm_config_script_shell`).
 * `BASE_URL` is also reserved — not for security but for correctness: the runner
 * injects `{ BASE_URL: active.baseUrl, ...auth.env }`, so an `auth.env.BASE_URL`
 * would silently override the SELECTED environment's URL (and the generated CI
 * workflow already filters it out to avoid exactly this conflict).
 * `TESTRUNNER_BROWSERS` is likewise reserved for correctness: the runner injects
 * it via `runEnv` and the generated CI workflow, so an `auth.env` copy would
 * override the configured browser matrix (US-055).
 * `auth.env` is for SUT credentials only; these are rejected outright.
 */
const RESERVED_ENV_KEYS = new Set([
  "PATH",
  "COMSPEC",
  "SHELL",
  "IFS",
  "ENV",
  "BASH_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_REPL_EXTERNAL_MODULE",
  "BASE_URL",
  "TESTRUNNER_BROWSERS",
]);
const RESERVED_ENV_PREFIXES = ["LD_", "DYLD_", "NPM_CONFIG_"];

/**
 * True when `key` names a process-control / loader-injection variable that must
 * never be settable through `auth.env` (see {@link RESERVED_ENV_KEYS}). Matched
 * case-INSENSITIVELY because Windows environment-variable names are
 * case-insensitive (`Path` === `PATH`), so a lower/mixed-case spelling can't
 * dodge the check. Pure: no I/O.
 */
const isReservedEnvKey = (key: string): boolean => {
  const upper = key.toUpperCase();
  return RESERVED_ENV_KEYS.has(upper) || RESERVED_ENV_PREFIXES.some((p) => upper.startsWith(p));
};

/**
 * The single `auth.env` KEY rule, shared by settings load/validate and CI
 * pipeline generation: a key must be identifier-shaped AND not a reserved
 * process-control variable. Returns a human-readable problem, or `undefined`
 * when the key is an acceptable credential name. Pure: no I/O.
 */
export const authEnvKeyProblem = (key: string): string | undefined => {
  if (!isValidAuthEnvKey(key)) {
    return `is not a valid environment-variable name (letters, digits, and "_" only; must not start with a digit)`;
  }
  if (isReservedEnvKey(key)) {
    return `is a reserved process-control variable and cannot be used as a credential`;
  }
  return undefined;
};

export const DEFAULT_SETTINGS: TestHubSettings = {
  paths: {
    testHubPath: unsafeVaultPath("Test Hub"),
    useCasesPath: unsafeVaultPath("Use Cases"),
    prdsPath: unsafeVaultPath("PRDs"),
    domainsPath: unsafeVaultPath("Domains"),
    specificationsPath: unsafeVaultPath("Specifications"),
    featureFilesPath: unsafeVaultPath("Specifications/features"),
    testSuitesPath: unsafeVaultPath("Test Suites"),
    evidencePath: unsafeVaultPath("Test Evidence"),
    documentationPath: unsafeVaultPath("Test Hub"),
    testRunnerPath: unsafeVaultPath(".testrunner"),
  },
  runner: {
    packageManager: "npm",
    nodeExecutable: "node",
    installCommand: "npm install",
    ciInstallCommand: "npm ci",
    browserInstallCommand: "npx playwright install chromium",
    browsers: ["chromium"],
    defaultRunCommand: "npm run test",
    smokeRunCommand: "npm run test:smoke",
    ciRunCommand: "npm run test:ci",
  },
  automation: {
    autoCreateFolders: true,
    autoCreateDocumentation: true,
    autoCreateDemoContent: true,
    updateUseCaseFrontmatterAfterRun: true,
    generateEvidenceMarkdown: true,
    openDashboardAfterInitialization: true,
  },
  ci: {
    provider: "github-actions",
    workflowPath: ".github/workflows/e2e.yml",
    nodeVersion: "22",
  },
  sut: {
    active: "demo", // bootstraps to the local file:// fixture
    environments: {
      demo: { baseUrl: "file://./.testrunner/src/fixtures/example.html" },
    },
  },
  logging: {
    enabled: true,
    path: unsafeVaultPath("Test Hub/logs"),
    level: "info",
  },
  onboarding: {
    tourId: null,
    completedSteps: [],
    skippedSteps: [],
    sequenceProgress: {},
    dismissed: false,
  },
};

import type { VaultPath } from "../value-objects/identifiers";
import { unsafeVaultPath } from "../value-objects/vault-path";

/** Plugin configuration (TIS §5). */

export type PackageManager = "npm"; // V1 fixed per AD-2

export type CiProvider = "github-actions" | "azure-devops" | "none";

export interface TestHubPathSettings {
  testHubPath: VaultPath;
  useCasesPath: VaultPath;
  specificationsPath: VaultPath;
  featureFilesPath: VaultPath;
  testSuitesPath: VaultPath;
  evidencePath: VaultPath;
  documentationPath: VaultPath;
  testRunnerPath: VaultPath;
}

export interface RunnerSettings {
  packageManager: PackageManager;
  nodeExecutable: string;
  installCommand: string; // `npm install` for local
  ciInstallCommand: string; // `npm ci` for CI
  browserInstallCommand: string;
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

export interface TestHubSettings {
  paths: TestHubPathSettings;
  runner: RunnerSettings;
  automation: AutomationSettings;
  ci: CiSettings;
  sut: SutSettings; // per ADR-0013 + ADR-0014
  logging: LoggingSettings; // per ADR-0019
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

export const DEFAULT_SETTINGS: TestHubSettings = {
  paths: {
    testHubPath: unsafeVaultPath("Test Hub"),
    useCasesPath: unsafeVaultPath("Use Cases"),
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
};

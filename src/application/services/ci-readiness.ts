import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import { VALIDATED_RUNNER_FILES } from "../content/runner-manifest";
import { buildGitHubActionsWorkflow, isNpmCiCommand } from "../content/ci-workflow-content";
import { isSafeCiCommand } from "./ci-pipeline-screening";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { TestHubSettings } from "../../domain/settings/settings";

/**
 * CI-readiness pre-flight (US-041 / UC-020): a pragmatic, I/O-light assessment
 * of whether the repo holds everything a vanilla CI checkout needs to install
 * and run the standalone runner (ADR-0006). Kept apart from the .testrunner
 * environment probe in environment-validation-service so the two concerns read
 * on their own; the service stays the thin orchestrator that emits the event.
 */
export interface CiReadinessResult {
  ready: boolean;
  missingItems: string[];
  warnings: string[];
}

/** The vault/command access the readiness probes need. */
interface CiReadinessDeps {
  absoluteFs: AbsoluteFileSystem;
  commandSafety: CommandSafetyPolicy;
}

/** Extracts `<script>` from a `npm run <script> …` command, else null. */
const npmRunScript = (command: string): string | null => {
  const parts = command.trim().split(/\s+/);
  return parts[0] === "npm" && parts[1] === "run" && parts[2] ? parts[2] : null;
};

/**
 * Assesses CI readiness (US-041 / UC-020): does the repo hold everything a
 * vanilla CI checkout needs to install and run the standalone runner (ADR-0006)?
 * Returns the verdict; the `ci.readiness.checked` event stays with the service.
 */
export const assessCiReadiness = async (
  settings: TestHubSettings,
  deps: CiReadinessDeps,
): Promise<CiReadinessResult> => {
  const { absoluteFs } = deps;
  const base = await absoluteFs.getVaultBasePath();
  const missingItems: string[] = [];
  const warnings: string[] = [];

  // V1 only generates/validates GitHub Actions (PipelineGenerationService
  // refuses other providers). For azure-devops / none, the GitHub workflow
  // checks below are meaningless, so report not-ready rather than passing on a
  // stale `.github/workflows/e2e.yml` (UC-019/020).
  if (settings.ci.provider !== "github-actions") {
    missingItems.push(
      `CI provider "${settings.ci.provider}" is not supported in V1 (only "github-actions").`,
    );
  }

  if (!base.ok) {
    missingItems.push("Vault base path could not be resolved.");
  } else {
    const root = base.value.replace(/[/\\]$/, "");
    // The generated workflow + a CI checkout use POSIX separators, so a
    // Windows-configured `e2e\runner` is checked out at `e2e/runner`.
    // Normalize before probing or the readiness check would report the
    // runner files missing even though the workflow points at the real folder.
    const runnerRel = settings.paths.testRunnerPath.replace(/\\/g, "/");
    const runnerAbs = `${root}/${runnerRel}`;
    await collectCiRunnerItems(settings, runnerRel, runnerAbs, missingItems, warnings, deps);
    await collectCiWorkflowItems(settings, root, missingItems, warnings, absoluteFs);
  }

  // The generated workflow ALWAYS sets BASE_URL from `${{ vars.E2E_BASE_URL }}`
  // (ADR-0011), never from local settings — so CI runs with an empty BASE_URL
  // unless that repository variable exists, regardless of the local active URL.
  // We can't read CI variables, so always warn to set it.
  warnings.push(
    "Ensure repository variable E2E_BASE_URL is set; CI reads BASE_URL from it, not from local settings (ADR-0011).",
  );
  const active = settings.sut.environments[settings.sut.active];
  if (!active?.baseUrl.trim()) {
    warnings.push("Active environment has no local BASE_URL configured.");
  }
  // The workflow injects every auth.env key configured across environments as
  // `${{ secrets.<KEY> }}` (ADR-0014). We can't read CI secrets, so warn that
  // each must exist as a repository secret or authenticated suites run with
  // empty credentials despite a ready report.
  const authKeys = [
    ...new Set(
      Object.values(settings.sut.environments).flatMap((e) => Object.keys(e.auth?.env ?? {})),
    ),
  ].sort();
  if (authKeys.length > 0) {
    warnings.push(
      `Set repository secrets for configured auth credentials: ${authKeys.join(", ")} (ADR-0014).`,
    );
  }
  if (!settings.ci.nodeVersion.trim()) warnings.push("CI Node version is empty.");

  return { ready: missingItems.length === 0, missingItems, warnings };
};

/**
 * Probes the runner project a CI checkout installs and runs (US-041/UC-020):
 * the managed files, package.json + its CI script, and the install lockfile.
 * Pushes onto the shared `missingItems`/`warnings`.
 */
const collectCiRunnerItems = async (
  settings: TestHubSettings,
  runnerRel: string,
  runnerAbs: string,
  missingItems: string[],
  warnings: string[],
  deps: CiReadinessDeps,
): Promise<void> => {
  const { absoluteFs, commandSafety } = deps;
  // The runner project must exist and be committable (US-042 standalone).
  if (!(await absoluteFs.existsAbsolute(runnerAbs))) {
    missingItems.push(`Runner folder is missing at ${runnerRel}.`);
  }
  // The CI `test:ci` script runs `bddgen && playwright test` against the
  // generated config, so a runner missing any managed file (playwright.config.ts,
  // paths, tsconfig) fails CI immediately. Verify the same files
  // the local validator checks (package.json is asserted in detail below).
  for (const file of VALIDATED_RUNNER_FILES) {
    if (file === "package.json") continue;
    if (!(await absoluteFs.existsAbsolute(`${runnerAbs}/${file}`))) {
      missingItems.push(`Runner file ${file} is missing (the CI test:ci script needs it).`);
    }
  }
  // package.json + the npm script the generated CI job invokes (US-041/
  // UC-020). The job runs the configured `runner.ciRunCommand` (default
  // `npm run test:ci`). Only validate a package script when that command
  // actually parses as `npm run <script>`; a custom non-npm command (e.g.
  // `npx playwright test …`) doesn't depend on a package script, so skip it.
  const effectiveCiCommand = settings.runner.ciRunCommand.trim() || "npm run test:ci";
  // Generate CI Workflow refuses commands that aren't a shell-safe npm
  // ci/run shape, so readiness must flag the same ones rather than
  // green-light a config the generator would reject.
  // Generation requires the run command to invoke an npm SCRIPT (not an
  // install), so readiness must flag the same — npmRunScript returns null
  // for a non-`npm run` command, which also leaves the script unverified.
  if (
    !isSafeCiCommand(effectiveCiCommand, commandSafety) ||
    npmRunScript(effectiveCiCommand) === null
  ) {
    missingItems.push(
      `CI run command "${effectiveCiCommand}" is not supported by Generate CI Workflow.`,
    );
  }
  await collectCiPackageScriptItem(
    runnerAbs,
    npmRunScript(effectiveCiCommand),
    effectiveCiCommand,
    missingItems,
    absoluteFs,
  );
  // Lockfile: required only by an install command that needs one. The
  // default `npm ci` fails without it (US-041), but a runner configured to
  // use e.g. `npm install --no-package-lock` doesn't, so don't reject that
  // valid CI config.
  const effectiveCiInstall = settings.runner.ciInstallCommand.trim() || "npm ci";
  if (!isSafeCiCommand(effectiveCiInstall, commandSafety)) {
    missingItems.push(
      `CI install command "${effectiveCiInstall}" is not supported by Generate CI Workflow.`,
    );
  }
  if (
    isNpmCiCommand(effectiveCiInstall) &&
    !(await absoluteFs.existsAbsolute(`${runnerAbs}/package-lock.json`))
  ) {
    missingItems.push("Runner package-lock.json is missing (npm ci needs a lockfile).");
  }
  // node_modules being committed defeats `npm ci`; warn rather than block.
  if (await absoluteFs.existsAbsolute(`${runnerAbs}/node_modules`)) {
    warnings.push("Runner node_modules is present; ensure it is git-ignored, not committed.");
  }
};

/**
 * Verifies the runner package.json exists and (when the CI command is an
 * `npm run <script>`) carries that script. Keeps the JSON parse/IO branching
 * isolated from {@link collectCiRunnerItems}.
 */
const collectCiPackageScriptItem = async (
  runnerAbs: string,
  ciScript: string | null,
  effectiveCiCommand: string,
  missingItems: string[],
  absoluteFs: AbsoluteFileSystem,
): Promise<void> => {
  const pkgPath = `${runnerAbs}/package.json`;
  if (!(await absoluteFs.existsAbsolute(pkgPath))) {
    missingItems.push("Runner package.json is missing.");
    return;
  }
  if (ciScript === null) return;
  const pkg = await absoluteFs.readAbsolute(pkgPath);
  if (!pkg.ok) {
    // Couldn't read it (permissions / transient I/O) — can't confirm the
    // CI script, so don't silently report ready.
    missingItems.push("Runner package.json could not be read to verify the CI script.");
    return;
  }
  try {
    const parsed = JSON.parse(pkg.value) as { scripts?: Record<string, unknown> };
    if (typeof parsed.scripts?.[ciScript] !== "string") {
      missingItems.push(
        `Runner package.json has no "${ciScript}" script (the CI job runs ${effectiveCiCommand}).`,
      );
    }
  } catch {
    missingItems.push("Runner package.json is not valid JSON.");
  }
};

/**
 * Validates the generated GitHub Actions workflow (path shape, existence, and
 * drift) a CI run discovers (UC-019 → UC-020). Pushes onto the shared
 * `missingItems`/`warnings`.
 */
const collectCiWorkflowItems = async (
  settings: TestHubSettings,
  root: string,
  missingItems: string[],
  warnings: string[],
  absoluteFs: AbsoluteFileSystem,
): Promise<void> => {
  // The CI workflow itself must have been generated (UC-019 → UC-020).
  // Generation normalizes `\`→`/` before writing (so a Windows-configured
  // `.github\workflows\e2e.yml` is written to the POSIX path GitHub finds);
  // normalize here too or the readiness probe would miss the generated file.
  const workflowRel = settings.ci.workflowPath.replace(/\\/g, "/");
  // Generation refuses a traversal/absolute workflowPath (it would write
  // outside the repo); reject it here too rather than probing outside the
  // vault and possibly reporting ready for a path Generate CI Workflow won't
  // accept.
  if (
    workflowRel.trim() === "" ||
    workflowRel.startsWith("/") ||
    /^[A-Za-z]:/.test(workflowRel) ||
    workflowRel.split("/").includes("..")
  ) {
    missingItems.push(
      `CI workflow path is invalid (must be repo-relative, no ".."): ${workflowRel}.`,
    );
    return;
  }
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflowRel)) {
    // GitHub Actions only discovers `.yml`/`.yaml` files directly under
    // `.github/workflows/`; anything else never runs even if it exists
    // (matches generation's rule).
    missingItems.push(
      `CI workflow must be a .yml/.yaml file under ".github/workflows/" to be discovered by Actions: ${workflowRel}.`,
    );
    return;
  }
  if (!(await absoluteFs.existsAbsolute(`${root}/${workflowRel}`))) {
    missingItems.push(`CI workflow not generated at ${workflowRel}.`);
    return;
  }
  // The workflow exists, but settings (runner path, CI commands, node
  // version, auth keys) may have changed since it was generated, leaving a
  // stale working-directory/command that fails in Actions. Compare it to
  // what generation would write now and warn (not block) if it drifted.
  const existing = await absoluteFs.readAbsolute(`${root}/${workflowRel}`);
  if (existing.ok && existing.value !== buildGitHubActionsWorkflow(settings)) {
    warnings.push("CI workflow is out of date with current settings; re-run Generate CI Workflow.");
  }
};

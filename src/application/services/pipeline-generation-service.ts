import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import { buildGitHubActionsWorkflow } from "../content/ci-workflow-content";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type {
  CiProvider,
  TestHubSettings,
} from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { err, ok, type Result } from "../../shared/result/result";

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
// free of shell metacharacters (even after a `--` separator) AND an npm ci/run
// shape. Exported so CI-readiness validation can reject exactly the commands
// `generate()` would refuse to write, keeping the two consistent.
const CI_COMMAND_CHARSET = /^[A-Za-z0-9 _:./=@-]+$/;
export const isSafeCiCommand = (command: string): boolean =>
  CI_COMMAND_CHARSET.test(command) && isNpmCiShape(command);

/** CI pipeline generation contract (TIS §8.13, US-040, UC-019). */
export interface PipelineGenerationService {
  generate(request: GeneratePipelineRequest): Promise<Result<GeneratedPipeline>>;
}

export interface GeneratePipelineRequest {
  provider: CiProvider;
  settings: TestHubSettings;
  overwriteExisting?: boolean; // default false (OQ-005 default)
}

export interface GeneratedPipeline {
  provider: CiProvider;
  path: string; // repo-root relative path; not a VaultPath (TIS §8.13)
}

export class DefaultPipelineGenerationService
  implements PipelineGenerationService
{
  constructor(
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly eventBus: EventBus,
    private readonly commandSafety: CommandSafetyPolicy,
  ) {}

  async generate(
    request: GeneratePipelineRequest,
  ): Promise<Result<GeneratedPipeline>> {
    // V1 only emits GitHub Actions output; "azure-devops" is reserved for V2 and
    // "none" is an explicit opt-out (TIS §5.7).
    if (request.provider !== "github-actions") {
      return err(
        appError(
          "VALIDATION_FAILED",
          `CI provider "${request.provider}" does not generate a workflow in V1 (only "github-actions").`,
          { details: { provider: request.provider } },
        ),
      );
    }

    // The configured CI install/run commands are interpolated verbatim into the
    // workflow `run:` steps, which Actions executes through a shell on push. A
    // synced/tampered settings blob could otherwise smuggle arbitrary commands
    // (e.g. a curl pipe) into the committed workflow, so screen them against the
    // same allowlist used for local spawns (ADR-0010) before writing.
    const effectiveInstall = request.settings.runner.ciInstallCommand.trim() || "npm ci";
    const effectiveRun = request.settings.runner.ciRunCommand.trim() || "npm run test:ci";
    const nodeVersion = request.settings.ci.nodeVersion.trim() || "22";
    // The runner path is rendered into several UNQUOTED YAML scalars
    // (working-directory, cache-dependency-path, upload path) using the same
    // POSIX normalization the content builder applies — so it must pass the same
    // safety screen as the commands, otherwise a value like
    // `runner\n      - run: curl evil | sh` breaks out into extra workflow steps.
    const runnerPath = request.settings.paths.testRunnerPath.replace(/\\/g, "/");
    // Auth env keys are rendered as `secrets.<KEY>` (and as YAML map keys); a
    // tampered settings blob could smuggle a newline/metachar through one.
    const authKeys = [
      ...new Set(
        Object.values(request.settings.sut.environments).flatMap((e) =>
          Object.keys(e.auth?.env ?? {}),
        ),
      ),
    ];
    // Reject control characters (newlines especially) in EVERY value rendered
    // into the YAML before anything else — a multiline value would break out of
    // its `run:`/`with:` line and inject arbitrary workflow steps even though the
    // tokenized command check below (which splits on whitespace) wouldn't see it.
    for (const value of [effectiveInstall, effectiveRun, nodeVersion, runnerPath, ...authKeys]) {
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f]/.test(value)) {
        return err(
          appError(
            "VALIDATION_FAILED",
            `Configured CI value contains a control character and can't be written to the workflow: ${JSON.stringify(value)}.`,
            { details: { value } },
          ),
        );
      }
    }
    // The runner path is a relative folder; keep it to plain path characters so
    // it can't carry YAML syntax (`:`, `#`, quotes) or shell metacharacters into
    // the working-directory / upload-path scalars.
    if (
      !/^[A-Za-z0-9 _./-]+$/.test(runnerPath) ||
      runnerPath.startsWith("/") ||
      runnerPath.split("/").includes("..")
    ) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `Configured runner path is not a safe relative path for the workflow: ${JSON.stringify(runnerPath)}.`,
          { details: { runnerPath } },
        ),
      );
    }
    // GitHub secret/env names (and our auth keys) are identifier-shaped; a key
    // with any other character can't be safely rendered as `secrets.<KEY>`.
    // GitHub also forbids the `GITHUB_` prefix for repository secrets, so a key
    // like `GITHUB_PAT` could never be created — reject it instead of emitting a
    // `secrets.GITHUB_PAT` reference that always resolves empty.
    for (const key of authKeys) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.startsWith("GITHUB_")) {
        return err(
          appError(
            "VALIDATION_FAILED",
            `Auth env key is not a valid secret name for the workflow: ${JSON.stringify(key)}.`,
            { details: { key } },
          ),
        );
      }
    }
    // The Node version is interpolated as a YAML scalar; keep it to a plain
    // version/range token so it can't carry spaces or YAML syntax.
    if (!/^[0-9A-Za-z.\-_/>=<^~* |]+$/.test(nodeVersion)) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `CI node version is not a valid version token: "${nodeVersion}".`,
          { details: { nodeVersion } },
        ),
      );
    }
    for (const command of [effectiveInstall, effectiveRun]) {
      // Actions runs `run:` steps through a shell, so unlike the local spawn
      // (shell:false) any shell metacharacter — including ones smuggled in after
      // a `--` separator, which the argv allowlist passes through as literal test
      // args — would execute. Screen the WHOLE command against a shell-safe
      // charset BEFORE the argv allowlist so `npm run test:ci -- $(curl evil)`,
      // `; rm -rf`, backticks, pipes, redirects, etc. are rejected.
      if (!/^[A-Za-z0-9 _:./=@-]+$/.test(command)) {
        return err(
          appError(
            "VALIDATION_FAILED",
            `Configured CI command contains a character unsafe for a shell run-step: "${command}".`,
            { details: { command } },
          ),
        );
      }
      // Unlike the local spawn allowlist (which fixes the script name), CI can
      // legitimately use a custom npm script or install flags (`npm run e2e:ci`,
      // `npm install --no-audit`). The shell-safe charset above already blocks
      // every metacharacter, so here we only require the npm CI shape: an `npm`
      // run/install/ci invocation. That permits configured CI commands while
      // still rejecting arbitrary programs (e.g. a `curl` wrapper).
      if (!isNpmCiShape(command)) {
        return err(
          appError(
            "VALIDATION_FAILED",
            `Configured CI command must be an "npm run/install/ci" invocation: "${command}".`,
            { details: { command } },
          ),
        );
      }
    }
    // The "Run tests" step must actually invoke an npm SCRIPT (`npm run <script>`),
    // not an install/ci — otherwise a `ciRunCommand` of `npm ci` would generate a
    // workflow whose test step only installs dependencies (and readiness would
    // skip the package-script check). Install may still be install/ci/run.
    const runTokens = effectiveRun.split(/\s+/).filter(Boolean);
    if (runTokens[0] !== "npm" || runTokens[1] !== "run" || runTokens[2] === undefined) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `CI run command must be an "npm run <script>": "${effectiveRun}".`,
          { details: { command: effectiveRun } },
        ),
      );
    }

    const base = await this.absoluteFs.getVaultBasePath();
    if (!base.ok) return err(base.error);
    const root = base.value.replace(/[/\\]$/, "");

    // The workflow is repo-root relative (e.g. .github/workflows/e2e.yml), not a
    // VaultPath: it must live where GitHub Actions discovers it (TIS §8.13).
    // `ci.workflowPath` isn't validated by SettingsService, so reject traversal
    // / absolute paths here before writing (or overwrite-checking) outside root.
    // Normalize separators to POSIX so a Windows-configured `a\b.yml` writes the
    // intended `.github/workflows/...` path GitHub discovers, not a literal
    // backslash filename on a POSIX vault.
    const relativePath = request.settings.ci.workflowPath.replace(/\\/g, "/");
    if (
      relativePath.trim() === "" ||
      relativePath.startsWith("/") ||
      /^[A-Za-z]:/.test(relativePath) ||
      relativePath.split(/[/\\]/).includes("..")
    ) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `CI workflow path must be a repo-relative path without "..": "${relativePath}".`,
          { details: { path: relativePath } },
        ),
      );
    }
    // GitHub Actions only discovers workflows that live directly under
    // `.github/workflows/` AND end in `.yml`/`.yaml`. A path elsewhere
    // (`ci/e2e.yml`), a non-YAML file (`.github/workflows/e2e.txt`), or a bare
    // directory would be written/reported ready but never run, so require the
    // full shape for the github-actions provider.
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(relativePath)) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `GitHub Actions workflow path must be a .yml/.yaml file directly under ".github/workflows/": "${relativePath}".`,
          { details: { path: relativePath } },
        ),
      );
    }
    const absolutePath = `${root}/${relativePath}`;

    // OQ-005 default: never clobber an existing workflow without explicit opt-in.
    if (
      request.overwriteExisting !== true &&
      (await this.absoluteFs.existsAbsolute(absolutePath))
    ) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `A CI workflow already exists at ${relativePath}. Re-run with overwrite enabled to replace it.`,
          { details: { path: relativePath } },
        ),
      );
    }

    const content = buildGitHubActionsWorkflow(request.settings);
    const written = await this.absoluteFs.writeAbsolute(absolutePath, content);
    if (!written.ok) return err(written.error);

    const pipeline: GeneratedPipeline = {
      provider: "github-actions",
      path: relativePath,
    };
    await this.eventBus.publish(
      // Event Catalog payload: { provider, path } (UC-019).
      createEvent("ci.pipeline.generated", {
        provider: pipeline.provider,
        path: pipeline.path,
      }),
    );
    return ok(pipeline);
  }
}

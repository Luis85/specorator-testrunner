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
    // Reject control characters (newlines especially) in EVERY value rendered
    // into the YAML before anything else — a multiline value would break out of
    // its `run:`/`with:` line and inject arbitrary workflow steps even though the
    // tokenized command check below (which splits on whitespace) wouldn't see it.
    for (const value of [effectiveInstall, effectiveRun, nodeVersion]) {
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
      const safe = this.commandSafety.assertSafe(command.split(/\s+/).filter(Boolean));
      if (!safe.ok) {
        return err(
          appError(
            "VALIDATION_FAILED",
            `Configured CI command is not allowed in the generated workflow: "${command}".`,
            { details: { command } },
          ),
        );
      }
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

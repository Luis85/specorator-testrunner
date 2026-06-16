import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import { buildGitHubActionsWorkflow } from "../content/ci-workflow-content";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { CiProvider, TestHubSettings } from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { err, ok, type Result } from "../../shared/result/result";
import { screenRequestInputs, screenWorkflowPath } from "./ci-pipeline-screening";

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

export class DefaultPipelineGenerationService implements PipelineGenerationService {
  constructor(
    private readonly absoluteFs: AbsoluteFileSystem,
    private readonly eventBus: EventBus,
    private readonly commandSafety: CommandSafetyPolicy,
  ) {}

  async generate(request: GeneratePipelineRequest): Promise<Result<GeneratedPipeline>> {
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

    // Screen every settings-derived value the workflow interpolates BEFORE any
    // I/O: the configured install/run commands, node version, runner path, and
    // auth-secret keys are rendered into shell `run:` steps and (unquoted) YAML
    // scalars, so a synced/tampered settings blob could otherwise smuggle
    // commands or extra steps into the committed workflow. The screening rules
    // (the ADR-0010 allowlist relaxed to the npm CI shapes, control-char and
    // YAML-charset guards) live in ci-pipeline-screening.ts (TD-009).
    const inputProblem = screenRequestInputs(request.settings, this.commandSafety);
    if (inputProblem) return err(inputProblem);

    const base = await this.absoluteFs.getVaultBasePath();
    if (!base.ok) return err(base.error);
    const root = base.value.replace(/[/\\]$/, "");

    // The workflow is repo-root relative (e.g. .github/workflows/e2e.yml), not a
    // VaultPath: it must live where GitHub Actions discovers it (TIS §8.13).
    // Normalize separators to POSIX so a Windows-configured `a\b.yml` writes the
    // intended path GitHub discovers, then screen it (traversal / absolute /
    // discoverable shape) before writing or overwrite-checking outside root.
    const relativePath = request.settings.ci.workflowPath.replace(/\\/g, "/");
    const pathProblem = screenWorkflowPath(relativePath);
    if (pathProblem) return err(pathProblem);
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
      // Event Catalog payload: { provider, path } (UC-019). V1 only ever writes
      // a GitHub Actions workflow (per SDD §17), so the provider is the literal
      // catalog member regardless of the wider GeneratedPipeline.provider type.
      createEvent("ci.pipeline.generated", {
        provider: "github-actions",
        path: pipeline.path,
      }),
    );
    return ok(pipeline);
  }
}

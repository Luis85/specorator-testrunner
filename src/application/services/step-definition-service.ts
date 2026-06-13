import {
  buildAppendedStubs,
  buildStepDefinitionStubFile,
  findMissingSteps,
  parseStepDefinitions,
} from "../content/step-definitions";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

export interface GenerateStepDefinitionsResult {
  /** Steps a stub was written for (the subset of input still undefined). */
  generatedSteps: string[];
  /** Vault path of the steps file the stubs were written into. */
  stepFile: VaultPath;
  /** True when the stub file already existed and stubs were appended to it. */
  appended: boolean;
}

/**
 * UC-010 / RV-4: generate TypeScript step-definition stubs for the undefined
 * Gherkin steps of a Feature and write them into the runner's `src/steps`
 * folder, then publish `stepdefinition.generated`.
 *
 * The trigger is an explicit user command (NOT auto-on-every-edit): the caller
 * first runs `SpecificationService.detectMissingSteps`, then hands the resulting
 * `missingSteps` (and the detection's event id) here. The `detectionEventId`
 * flows through to the published event's `causationId` (Event Catalog §5), so a
 * future auto-path can reuse the same wiring by passing the id it already holds.
 */
export interface StepDefinitionService {
  generate(
    featurePath: VaultPath,
    missingSteps: string[],
    detectionEventId?: string,
  ): Promise<Result<GenerateStepDefinitionsResult>>;
}

/** `UC-001-happy-path.feature` → `UC-001-happy-path.steps.ts`. */
const stepFileNameFor = (featurePath: VaultPath): string => {
  const base = featurePath.split("/").pop() ?? featurePath;
  const stem = base.replace(/\.feature$/i, "");
  return `${stem}.steps.ts`;
};

export class DefaultStepDefinitionService implements StepDefinitionService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async generate(
    featurePath: VaultPath,
    missingSteps: string[],
    detectionEventId?: string,
  ): Promise<Result<GenerateStepDefinitionsResult>> {
    const settings = await this.settingsService.load();
    // Same port + path convention SpecificationService.detectMissingSteps reads
    // from, so a stub written here is picked up by the next detection pass.
    const stepsDir = joinVaultPath(settings.paths.testRunnerPath, "src/steps");
    const stepFile = joinVaultPath(stepsDir, stepFileNameFor(featurePath));

    // Re-diff against every existing definition (not just the caller's list) so
    // generation is non-destructive: a step that has since been hand-implemented
    // anywhere under src/steps is never re-stubbed (ADR-0012 / RV-8 spirit).
    const definitions = await this.loadStepDefinitions(stepsDir);
    const stillMissing = findMissingSteps(missingSteps, definitions);

    if (stillMissing.length === 0) {
      // Nothing to write — surface an empty, successful result so the command
      // can report "no missing steps" without a spurious event/file write.
      this.logger.info("No undefined steps to stub", { featurePath, stepFile });
      return ok({ generatedSteps: [], stepFile, appended: false });
    }

    const exists = await this.fs.exists(stepFile);

    let written: Result<void>;
    if (exists) {
      // Append to (never overwrite) a hand-edited steps file: read its current
      // content and add the new stubs below it. buildAppendedStubs prepends the
      // `createBdd()` header only when the file does not already have it, so a
      // file the generator previously wrote (or any file already calling
      // createBdd()) does not get a duplicate Given/When/Then binding.
      const read = await this.fs.readFile(stepFile);
      if (!read.ok) return err(read.error);
      const separator = read.value.endsWith("\n") ? "\n" : "\n\n";
      const block = buildAppendedStubs(read.value, stillMissing);
      written = await this.fs.writeFile(stepFile, `${read.value}${separator}${block}`);
    } else {
      written = await this.fs.createFile(stepFile, buildStepDefinitionStubFile(stillMissing));
    }
    if (!written.ok) {
      return err(
        appError("VALIDATION_FAILED", `Could not write step stubs to "${stepFile}".`, {
          cause: written.error,
        }),
      );
    }

    await this.eventBus.publish(
      createEvent(
        "stepdefinition.generated",
        { featurePath, stepFile, generatedSteps: stillMissing },
        // Per Event Catalog §5: causationId references the originating
        // specification.missingSteps.detected event when generation was
        // triggered from a detection.
        detectionEventId ? { causationId: detectionEventId } : {},
      ),
    );
    this.logger.info("Step definition stubs generated", {
      featurePath,
      stepFile,
      generated: stillMissing.length,
      appended: exists,
    });
    return ok({ generatedSteps: stillMissing, stepFile, appended: exists });
  }

  /**
   * Reads every `*.ts` under the steps folder (recursively, matching the
   * runner's `src/steps/**` glob) and scrapes its patterns. Mirrors
   * SpecificationService so detection and generation share one view of what is
   * already defined; a missing folder yields no definitions.
   */
  private async loadStepDefinitions(stepsDir: VaultPath) {
    const listed = await this.fs.listFilesRecursive(stepsDir);
    if (!listed.ok) return [];

    const patterns = [];
    for (const path of listed.value) {
      if (!path.endsWith(".ts")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue;
      patterns.push(...parseStepDefinitions(read.value));
    }
    return patterns;
  }
}

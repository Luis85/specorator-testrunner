import {
  buildStarterFeature,
  featureFileName,
  nextFeatureSlug,
} from "../content/feature-content";
import { collectStepTexts, parseFeature, useCaseIdFromPath } from "../content/gherkin";
import { findMissingSteps, parseStepDefinitions } from "../content/step-definitions";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { UseCaseService } from "./use-case-service";
import type { FeatureSpecification } from "../../domain/entities/specification";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

export interface SpecificationValidationError {
  line?: number;
  message: string;
}

export interface SpecificationValidationResult {
  valid: boolean;
  errors: SpecificationValidationError[];
}

export interface MissingStepResult {
  featurePath: VaultPath;
  missingSteps: string[];
}

/**
 * Feature Specification lifecycle (TIS §8.7; UC-006/UC-007/UC-010).
 *
 * `createFromUseCase` accepts an optional `slug` so a UI prompt can name a
 * second Feature; the interface stays compatible with TIS §8.7 because the
 * extra parameter is optional (the service picks `happy-path` / `feature-<n>`
 * when none is supplied — UC-006 step 3, ADR-0012).
 */
export interface SpecificationService {
  createFromUseCase(
    useCaseId: UseCaseId,
    slug?: string,
  ): Promise<Result<FeatureSpecification>>;
  update(specification: FeatureSpecification): Promise<Result<void>>;
  validate(featurePath: VaultPath): Promise<Result<SpecificationValidationResult>>;
  detectMissingSteps(featurePath: VaultPath): Promise<Result<MissingStepResult>>;
}

/** Serialises a {@link FeatureSpecification} back to plain Gherkin (no YAML). */
const serialiseFeature = (specification: FeatureSpecification): string => {
  const lines: string[] = [];
  if (specification.tags.length > 0) lines.push(specification.tags.join(" "));
  lines.push(`Feature: ${specification.featureName}`);
  for (const scenario of specification.scenarios) {
    lines.push("");
    if (scenario.tags.length > 0) lines.push(`  ${scenario.tags.join(" ")}`);
    lines.push(`  Scenario: ${scenario.name}`);
    for (const step of scenario.steps) {
      lines.push(`    ${step.keyword} ${step.text}`.trimEnd());
    }
  }
  return `${lines.join("\n")}\n`;
};

export class DefaultSpecificationService implements SpecificationService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly useCaseService: UseCaseService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  /** UC-006: non-destructively create a Feature and link it back to its UC. */
  async createFromUseCase(
    useCaseId: UseCaseId,
    slug?: string,
  ): Promise<Result<FeatureSpecification>> {
    const found = await this.useCaseService.findById(useCaseId);
    if (!found.ok) return err(found.error);
    if (found.value === null) {
      return err(
        appError("VALIDATION_FAILED", `Use Case "${useCaseId}" was not found.`),
      );
    }
    const useCase = found.value;

    const settings = await this.settingsService.load();
    const chosenSlug = nextFeatureSlug(useCase, slug);
    const featurePath = joinVaultPath(
      settings.paths.featureFilesPath,
      featureFileName(useCase.id, chosenSlug),
    );

    // ADR-0012: never overwrite an existing Feature.
    if (await this.fs.exists(featurePath)) {
      return err(
        appError("VALIDATION_FAILED", `A Feature already exists at "${featurePath}".`, {
          details: { featurePath },
        }),
      );
    }

    const content = buildStarterFeature(useCase, chosenSlug);
    const created = await this.fs.createFile(featurePath, content);
    if (!created.ok) return err(created.error);

    const specification = parseFeature(content, featurePath);
    if (specification === null) {
      // Unreachable for our own starter content; guards against a future edit
      // to buildStarterFeature that drops the Feature line.
      return err(
        appError("VALIDATION_FAILED", "Generated Feature content did not parse."),
      );
    }

    // The file now exists, so announce creation before the link step — a later
    // failure must not leave a created Feature with no `specification.created`.
    await this.eventBus.publish(
      createEvent("specification.created", { useCaseId: useCase.id, featurePath }),
    );

    // Append the new path to the UC and rewrite its note (forward reference).
    const updated = await this.useCaseService.update({
      ...useCase,
      featureFiles: [...useCase.featureFiles, featurePath],
    });
    if (!updated.ok) return err(updated.error);

    await this.eventBus.publish(
      createEvent("specification.linkedToUseCase", { useCaseId: useCase.id, featurePath }),
    );
    this.logger.info("Feature created", { useCaseId: useCase.id, featurePath });
    return ok(specification);
  }

  /** UC-007: re-serialise and write the Feature, then announce the change. */
  async update(specification: FeatureSpecification): Promise<Result<void>> {
    const written = await this.fs.writeFile(
      specification.path,
      serialiseFeature(specification),
    );
    if (!written.ok) return err(written.error);

    await this.eventBus.publish(
      createEvent("specification.updated", {
        featurePath: specification.path,
        scenarioCount: specification.scenarios.length,
        tags: specification.tags,
      }),
    );
    this.logger.info("Feature updated", { featurePath: specification.path });
    return ok(undefined);
  }

  /** UC-007 / US-020: parse the Feature and report structural errors. */
  async validate(featurePath: VaultPath): Promise<Result<SpecificationValidationResult>> {
    const read = await this.fs.readFile(featurePath);
    if (!read.ok) return err(read.error);

    const errors: SpecificationValidationError[] = [];

    // ADR-0012: a Feature must back-reference exactly one Use Case via filename.
    if (useCaseIdFromPath(featurePath) === null) {
      errors.push({
        message: `Feature "${featurePath}" has no "UC-NNN-" filename prefix (orphan).`,
      });
    }

    const feature = parseFeature(read.value, featurePath);
    if (feature === null) {
      errors.push({ message: "File does not contain a Feature: declaration." });
    } else {
      if (feature.featureName === "") {
        errors.push({ message: "Feature has no name." });
      }
      if (feature.scenarios.length === 0) {
        errors.push({ message: "Feature has no scenarios." });
      }
      for (const scenario of feature.scenarios) {
        if (scenario.steps.length === 0) {
          errors.push({ message: `Scenario "${scenario.name}" has no steps.` });
        }
      }
    }

    const result: SpecificationValidationResult = { valid: errors.length === 0, errors };
    await this.eventBus.publish(
      createEvent("specification.validation.completed", {
        featurePath,
        valid: result.valid,
        errors: errors.map((e) => e.message),
      }),
    );
    return ok(result);
  }

  /** US-021 / UC-010: list feature steps that no step definition matches. */
  async detectMissingSteps(featurePath: VaultPath): Promise<Result<MissingStepResult>> {
    const read = await this.fs.readFile(featurePath);
    if (!read.ok) return err(read.error);

    const feature = parseFeature(read.value, featurePath);
    if (feature === null) {
      return err(
        appError("VALIDATION_FAILED", `"${featurePath}" is not a valid Feature.`),
      );
    }

    const settings = await this.settingsService.load();
    const stepsDir = joinVaultPath(settings.paths.testRunnerPath, "src/steps");
    const definitions = await this.loadStepDefinitions(stepsDir);

    const missingSteps = findMissingSteps(collectStepTexts(feature), definitions);

    await this.eventBus.publish(
      createEvent("specification.missingSteps.detected", { featurePath, missingSteps }),
    );
    this.logger.info("Missing steps detected", {
      featurePath,
      missing: missingSteps.length,
    });
    return ok({ featurePath, missingSteps });
  }

  /**
   * Reads every `*.ts` under the steps folder (recursively, matching the
   * runner's `src/steps/**` glob) and scrapes its patterns. A missing folder
   * yields no definitions, so every step is reported missing.
   */
  private async loadStepDefinitions(stepsDir: VaultPath) {
    const listed = await this.fs.listFilesRecursive(stepsDir);
    if (!listed.ok) return []; // genuine listing failure → treat as no definitions

    const patterns = [];
    for (const path of listed.value) {
      if (!path.endsWith(".ts")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue; // best-effort: skip unreadable files
      patterns.push(...parseStepDefinitions(read.value));
    }
    return patterns;
  }
}

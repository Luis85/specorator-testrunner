import { buildStarterFeature, featureFileName, nextFeatureSlug } from "../content/feature-content";
import { structuralIssues } from "../content/feature-validation";
import {
  collectStepTexts,
  parseFeature,
  serialiseFeature,
  useCaseIdFromPath,
} from "../content/gherkin";
import { parseStepDefinitions, type StepDefinitionPattern } from "../content/step-definitions";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { ChildProcessRunner } from "../ports/child-process-runner";
import type { VaultFileSystem } from "../ports/vault-file-system";
import { resolveRunnerCwd } from "./runner-paths";
import type { SettingsService } from "./settings-service";
import type { UseCaseService } from "./use-case-service";
import {
  createFeatureSpecification,
  type FeatureSpecification,
} from "../../domain/entities/specification";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

// playwright-bdd v9's `bddgen` bin resolves to `dist/cli/index.js` (NOT
// `dist/cli.js`); run it directly with the configured Node executable so the
// invocation is shell-free and cross-platform (the `.bin/bddgen` shim is a
// `.cmd` on Windows). The Node program is `settings.runner.nodeExecutable` —
// the same executable the runner is launched and validated with — so a user
// whose `node` is not on PATH still gets detection.
const BDDGEN_CLI = "node_modules/playwright-bdd/dist/cli/index.js";

export interface SpecificationValidationError {
  line?: number;
  message: string;
}

export interface SpecificationValidationResult {
  valid: boolean;
  errors: SpecificationValidationError[];
}

/** A discovered `.feature` file, shaped for the run-scoping picker (UC-013). */
export interface FeatureFileEntry {
  /** Vault path of the `.feature` file (the run target). */
  path: VaultPath;
  /** Path relative to the feature-files folder (the human-readable label). */
  label: string;
}

export interface MissingStepResult {
  featurePath: VaultPath;
  missingSteps: string[];
  /**
   * Id of the published `specification.missingSteps.detected` event. UC-010
   * threads it into `stepdefinition.generated`'s `causationId` (Event Catalog
   * §5) so the generated stubs are causally linked to the detection that
   * triggered them.
   */
  detectionEventId: string;
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
  createFromUseCase(useCaseId: UseCaseId, slug?: string): Promise<Result<FeatureSpecification>>;
  update(specification: FeatureSpecification): Promise<Result<void>>;
  validate(featurePath: VaultPath): Promise<Result<SpecificationValidationResult>>;
  detectMissingSteps(featurePath: VaultPath): Promise<Result<MissingStepResult>>;
  /**
   * Enumerates every `.feature` file under the configured feature-files folder
   * for run-scoping pickers (US-029, UC-013). Preserves the discovery semantics
   * that previously lived in `main.ts`:
   *
   * - the listing is RECURSIVE (features in nested subfolders are included,
   *   matching the runner's feature glob);
   * - only paths ending in `.feature` are returned;
   * - `label` is the path relative to the feature-files folder — the folder
   *   prefix plus its trailing `/` stripped via `path.slice(folder.length + 1)`
   *   (vault paths are `/`-separated and the port returns descendants of the
   *   folder, so the prefix is always present);
   * - the port's listing order is preserved (no sorting) and no events are
   *   published (discovery is a read-only query).
   */
  listFeatures(): Promise<Result<FeatureFileEntry[]>>;
  /**
   * Publish-only `specification.updated` for a Feature whose file was ALREADY
   * written by the caller (the Feature Editor saves through Obsidian's
   * TextFileView lifecycle, not through `update`). Keeps the event vocabulary
   * in the application layer so dashboards/explorers refresh identically for
   * UI-editor saves and programmatic updates.
   */
  announceUpdated(specification: FeatureSpecification): Promise<void>;
  /**
   * The step-definition patterns scraped from `.testrunner/src/steps/\**\/*.ts`
   * — the SAME source `detectMissingSteps` matches against, so the Feature
   * Editor's autocomplete/missing-step flags and the Detect action agree.
   * A missing steps folder yields an empty list (every step reads missing).
   */
  listStepPatterns(): Promise<Result<StepDefinitionPattern[]>>;
}

/**
 * Parses `bddgen` stdout for undefined step texts.
 *
 * bddgen exits 0 whether or not steps are missing; the presence of the
 * "Missing step definitions:" header line is the sole signal. Each missing
 * step's text is extracted from the first quoted argument of its snippet
 * (`Given('…', …)` → `…`), without the keyword, matching what
 * `collectStepTexts` returns.
 */
/** Header bddgen prints when a run has undefined steps — the sole signal, since bddgen exits 0 regardless. */
const BDDGEN_MISSING_HEADER = "Missing step definitions:";

export const parseBddgenMissingSteps = (stdout: string): string[] => {
  if (!stdout.includes(BDDGEN_MISSING_HEADER)) return [];
  const results: string[] = [];
  // bddgen controls snippet emission and quotes each step text, so the
  // non-greedy capture stops at the snippet's own closing quote — an inner
  // quote inside the step text does not arise in the emitted format.
  const re = /^(?:Given|When|Then|And|But)\(\s*['"](.+?)['"]\s*,/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stdout)) !== null) {
    results.push(match[1]);
  }
  return results;
};

/**
 * The requested feature's step texts that bddgen reported missing, de-duplicated
 * and in feature order. bddgen scans ALL features, so the result is filtered to
 * THIS feature; `collectStepTexts` can repeat a step across scenarios, hence the
 * `seen` guard.
 */
const keepFeatureSteps = (featureTexts: string[], allMissing: ReadonlySet<string>): string[] => {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const text of featureTexts) {
    if (!seen.has(text) && allMissing.has(text)) {
      seen.add(text);
      kept.push(text);
    }
  }
  return kept;
};

export class DefaultSpecificationService implements SpecificationService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly useCaseService: UseCaseService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly childProcess: ChildProcessRunner,
    private readonly absoluteFs: AbsoluteFileSystem,
  ) {}

  /** UC-006: non-destructively create a Feature and link it back to its UC. */
  async createFromUseCase(
    useCaseId: UseCaseId,
    slug?: string,
  ): Promise<Result<FeatureSpecification>> {
    const found = await this.useCaseService.findById(useCaseId);
    if (!found.ok) return err(found.error);
    if (found.value === null) {
      return err(appError("VALIDATION_FAILED", `Use Case "${useCaseId}" was not found.`));
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

    const parsed = parseFeature(content, featurePath);
    if (parsed === null) {
      // Unreachable for our own starter content; guards against a future edit
      // to buildStarterFeature that drops the Feature line.
      return err(appError("VALIDATION_FAILED", "Generated Feature content did not parse."));
    }
    // Route through the invariant-enforcing factory: a Feature created from a UC
    // must carry that UC's id (ADR-0012, no orphans). The factory rejects an
    // empty useCaseId, so a future change to the filename convention that breaks
    // the back-reference fails loudly here instead of writing an orphan.
    const built = createFeatureSpecification({ ...parsed, useCaseId: useCase.id });
    if (!built.ok) return err(built.error);
    const specification = built.value;

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
    const written = await this.fs.writeFile(specification.path, serialiseFeature(specification));
    if (!written.ok) return err(written.error);

    await this.announceUpdated(specification);
    this.logger.info("Feature updated", { featurePath: specification.path });
    return ok(undefined);
  }

  async announceUpdated(specification: FeatureSpecification): Promise<void> {
    await this.eventBus.publish(
      createEvent("specification.updated", {
        featurePath: specification.path,
        scenarioCount: specification.scenarios.length,
        tags: specification.tags,
      }),
    );
  }

  async listStepPatterns(): Promise<Result<StepDefinitionPattern[]>> {
    const settings = await this.settingsService.load();
    const stepsDir = joinVaultPath(settings.paths.testRunnerPath, "src/steps");
    return ok(await this.loadStepDefinitions(stepsDir));
  }

  /** UC-007 / US-020: parse the Feature and report structural errors. */
  async validate(featurePath: VaultPath): Promise<Result<SpecificationValidationResult>> {
    const read = await this.fs.readFile(featurePath);
    if (!read.ok) return err(read.error);

    const errors: SpecificationValidationError[] = [];

    const feature = parseFeature(read.value, featurePath);
    if (feature === null) {
      // structuralIssues needs a parsed spec; cover the two pre-parse facts here.
      if (useCaseIdFromPath(featurePath) === null) {
        errors.push({
          message: 'No "UC-NNN-" filename prefix — this Feature is an orphan (ADR-0012).',
        });
      }
      errors.push({ message: "File does not contain a Feature: declaration." });
    } else {
      errors.push(...structuralIssues(feature).map(({ message }) => ({ message })));
    }

    const result: SpecificationValidationResult = { valid: errors.length === 0, errors };
    await this.eventBus.publish(
      createEvent("specification.validation.completed", {
        featurePath,
        valid: result.valid,
        errors: errors.map((e) => e.message),
        // Tags travel with the result so observers (e.g. the Guided Tour's
        // authoring step) can require a tag without re-reading the file.
        tags: feature?.tags ?? [],
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
      return err(appError("VALIDATION_FAILED", `"${featurePath}" is not a valid Feature.`));
    }

    const settings = await this.settingsService.load();
    const cwd = await resolveRunnerCwd(this.absoluteFs, settings.paths.testRunnerPath);
    if (!cwd.ok || !(await this.absoluteFs.existsAbsolute(cwd.value))) {
      return err(appError("RUNNER_NOT_INSTALLED", "Install the runner to detect missing steps."));
    }

    const ran = await this.childProcess.run({
      args: [settings.runner.nodeExecutable, BDDGEN_CLI],
      cwd: cwd.value,
    });
    // bddgen exits 0 even when steps are missing, so a real failure is a spawn
    // error or a non-zero exit WITHOUT the missing-steps report.
    const bddgenFailed =
      !ran.ok || (ran.value.exitCode !== 0 && !ran.value.stdout.includes(BDDGEN_MISSING_HEADER));
    if (bddgenFailed) {
      return err(appError("RUNNER_NOT_INSTALLED", "Install the runner to detect missing steps."));
    }

    const allMissing = new Set(parseBddgenMissingSteps(ran.value.stdout));
    const missingSteps = keepFeatureSteps(collectStepTexts(feature), allMissing);

    const detectionEvent = createEvent("specification.missingSteps.detected", {
      featurePath,
      missingSteps,
    });
    await this.eventBus.publish(detectionEvent);
    this.logger.info("Missing steps detected", {
      featurePath,
      missing: missingSteps.length,
    });
    return ok({ featurePath, missingSteps, detectionEventId: detectionEvent.id });
  }

  /** UC-013: discover the runnable `.feature` files (see the interface doc). */
  async listFeatures(): Promise<Result<FeatureFileEntry[]>> {
    const settings = await this.settingsService.load();
    const folder = settings.paths.featureFilesPath;
    const listed = await this.fs.listFilesRecursive(folder);
    if (!listed.ok) return err(listed.error);
    return ok(
      listed.value
        .filter((path) => path.endsWith(".feature"))
        .map((path) => ({ path, label: path.slice(folder.length + 1) })),
    );
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

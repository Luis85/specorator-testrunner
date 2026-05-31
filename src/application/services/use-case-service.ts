import { buildUseCaseNote, useCaseFileName } from "../content/use-case-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { TestRunStatus } from "../../domain/entities/test-run";
import type {
  AutomationStatus,
  UseCase,
  UseCaseStatus,
} from "../../domain/entities/use-case";
import type { SuiteId, UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { parseFrontmatter, updateNoteFrontmatter } from "../../shared/utils/frontmatter";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

export interface CreateUseCaseRequest {
  title: string;
  description?: string;
  suites?: SuiteId[];
}

/**
 * Use Case lifecycle (TIS §8.6, UC-004). EPIC-004 delivers `create` (US-015)
 * and `findAll` (US-016); EPIC-005 adds `findById`/`update` so the
 * SpecificationService can back-reference Features into a Use Case (UC-006).
 */
export interface UseCaseService {
  create(request: CreateUseCaseRequest): Promise<Result<UseCase>>;
  findAll(): Promise<Result<UseCase[]>>;
  findById(id: UseCaseId): Promise<Result<UseCase | null>>;
  update(useCase: UseCase): Promise<Result<void>>;
}

const ID_PATTERN = /^UC-(\d+)$/;

/** Next sequential `UC-NNN` id given the existing use cases (US-015). */
export const nextUseCaseId = (existing: UseCase[]): UseCaseId => {
  const max = existing.reduce((highest, useCase) => {
    const match = ID_PATTERN.exec(useCase.id);
    return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
  }, 0);
  return `UC-${String(max + 1).padStart(3, "0")}`;
};

export class DefaultUseCaseService implements UseCaseService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async create(request: CreateUseCaseRequest): Promise<Result<UseCase>> {
    const title = request.title.trim();
    if (title === "") {
      return err(appError("VALIDATION_FAILED", "A Use Case title is required."));
    }

    const settings = await this.settingsService.load();
    const existing = await this.findAll();
    if (!existing.ok) return err(existing.error);

    const id = nextUseCaseId(existing.value);
    const path = joinVaultPath(settings.paths.useCasesPath, useCaseFileName(id, title));
    // Frontmatter `description` is a single-line scalar; collapse any newlines
    // from the textarea so they can't break the YAML or be truncated on read.
    const description = request.description?.replace(/\s+/g, " ").trim() || undefined;
    const useCase: UseCase = {
      id,
      title,
      description,
      status: "draft",
      automationStatus: "not-planned",
      featureFiles: [],
      suites: request.suites ?? [],
      evidence: [],
      path,
    };

    const created = await this.fs.createFile(path, buildUseCaseNote(useCase));
    if (!created.ok) return err(created.error);

    await this.eventBus.publish(createEvent("usecase.created", { useCaseId: id, path }));
    this.logger.info("Use Case created", { id, path });
    return ok(useCase);
  }

  async findAll(): Promise<Result<UseCase[]>> {
    const settings = await this.settingsService.load();
    // Recurse so use cases organised into subfolders are still indexed (and so
    // id allocation in create() can't collide with a nested note).
    const listed = await this.fs.listFilesRecursive(settings.paths.useCasesPath);
    if (!listed.ok) return err(listed.error);

    const useCases: UseCase[] = [];
    for (const path of listed.value) {
      if (!path.endsWith(".md")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue; // index is best-effort; skip unreadable notes
      const useCase = this.parse(read.value, path);
      if (useCase) useCases.push(useCase);
    }
    useCases.sort((a, b) => a.id.localeCompare(b.id));
    return ok(useCases);
  }

  /** Finds a single Use Case by id (UC-006 needs the owning UC). */
  async findById(id: UseCaseId): Promise<Result<UseCase | null>> {
    const all = await this.findAll();
    if (!all.ok) return err(all.error);
    return ok(all.value.find((useCase) => useCase.id === id) ?? null);
  }

  /**
   * Updates a Use Case note's managed frontmatter in place, preserving the
   * note's Markdown body and any unknown frontmatter fields (so linking a
   * Feature doesn't wipe hand-written sections). Falls back to a fresh note when
   * the file does not exist yet (UC-005 / UC-006 supporting).
   */
  async update(useCase: UseCase): Promise<Result<void>> {
    const existing = await this.fs.readFile(useCase.path);
    const content = existing.ok
      ? updateNoteFrontmatter(existing.value, {
          type: "use-case",
          id: useCase.id,
          title: useCase.title,
          status: useCase.status,
          automation_status: useCase.automationStatus,
          description: useCase.description,
          feature_files: useCase.featureFiles.length > 0 ? useCase.featureFiles : undefined,
          // Drop the legacy singular key: parse() reads both, so leaving it
          // would duplicate the feature once it's also in feature_files.
          feature_file: undefined,
          suites: useCase.suites.length > 0 ? useCase.suites : undefined,
          evidence: useCase.evidence.length > 0 ? useCase.evidence : undefined,
          // lastTestRun (TestRunSummary) flattened — the frontmatter serialiser
          // only handles scalars/arrays, not nested objects (US-031).
          last_run_id: useCase.lastTestRun?.runId,
          last_run_status: useCase.lastTestRun?.status,
          last_run_date: useCase.lastTestRun?.date,
          last_run_evidence: useCase.lastTestRun?.evidencePath,
        })
      : buildUseCaseNote(useCase);

    const written = await this.fs.writeFile(useCase.path, content);
    if (!written.ok) return err(written.error);

    const changedFields = [
      ...(useCase.featureFiles.length > 0 ? ["featureFiles"] : []),
      ...(useCase.evidence.length > 0 ? ["evidence"] : []),
      ...(useCase.lastTestRun ? ["lastTestRun"] : []),
    ];
    await this.eventBus.publish(
      createEvent("usecase.updated", {
        useCaseId: useCase.id,
        path: useCase.path,
        changedFields,
      }),
    );
    this.logger.info("Use Case updated", { id: useCase.id, path: useCase.path });
    return ok(undefined);
  }

  /** Maps a note's frontmatter to a {@link UseCase}; returns null if it is not one. */
  private parse(content: string, path: VaultPath): UseCase | null {
    const fm = parseFrontmatter(content);
    if (fm.type !== "use-case" || typeof fm.id !== "string") return null;

    const toArray = (value: string | string[] | undefined): string[] =>
      Array.isArray(value) ? value : typeof value === "string" && value !== "" ? [value] : [];

    return {
      id: fm.id,
      title: typeof fm.title === "string" ? fm.title : fm.id,
      description: typeof fm.description === "string" ? fm.description : undefined,
      status: (typeof fm.status === "string" ? fm.status : "draft") as UseCaseStatus,
      automationStatus: (typeof fm.automation_status === "string"
        ? fm.automation_status
        : "not-planned") as AutomationStatus,
      featureFiles: [...toArray(fm.feature_files), ...toArray(fm.feature_file)],
      suites: toArray(fm.suites),
      evidence: toArray(fm.evidence),
      lastTestRun:
        typeof fm.last_run_id === "string"
          ? {
              runId: fm.last_run_id,
              status: (typeof fm.last_run_status === "string"
                ? fm.last_run_status
                : "passed") as TestRunStatus,
              date: typeof fm.last_run_date === "string" ? fm.last_run_date : "",
              evidencePath:
                typeof fm.last_run_evidence === "string" ? fm.last_run_evidence : undefined,
            }
          : undefined,
      path,
    };
  }
}

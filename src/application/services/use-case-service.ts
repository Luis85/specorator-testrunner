import { buildUseCaseNote, useCaseFileName } from "../content/use-case-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { ExecutionScope, TestRunStatus } from "../../domain/entities/test-run";
import {
  USE_CASE_STATUSES,
  type AutomationStatus,
  type UseCase,
  type UseCaseStatus,
} from "../../domain/entities/use-case";
import type { SuiteId, UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import { vaultPath } from "../../domain/value-objects/vault-path";
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
 * The user-editable Use Case metadata (Wave G §3, UC-005). Deliberately ONLY
 * the title and the business status: the id is immutable identity, and
 * `automationStatus` is owned by the UseCaseAutomationPolicy (ADR-0017) —
 * derived from the UC's Features + last run — so a hand-set value would be
 * silently overwritten on the next roll-up and is not offered for editing.
 */
export interface UseCaseMetadataChanges {
  title?: string;
  status?: UseCaseStatus;
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
  /** Quick edit of title/status from the UI (Wave G §3, UC-005). */
  updateMetadata(id: UseCaseId, changes: UseCaseMetadataChanges): Promise<Result<UseCase>>;
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

    await this.eventBus.publish(
      // Event Catalog §4 payload { useCaseId, title, path }; §19 sets
      // correlationId = useCaseId for the use-case creation flow.
      createEvent("usecase.created", { useCaseId: id, title, path }, { correlationId: id }),
    );
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
          last_run_scope: useCase.lastTestRun?.scope,
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

  /**
   * Quick edit of a Use Case's title and/or business status from the UI
   * (Wave G §3, UC-005), so a Product Owner never has to hand-edit YAML.
   *
   * Scope is deliberately {@link UseCaseMetadataChanges} only: the id is
   * immutable identity, and `automationStatus` is owned by the
   * UseCaseAutomationPolicy (ADR-0017) so it is NOT editable here. The note is
   * not renamed (the path stays stable so links keep resolving); only the
   * frontmatter — and the `# UC-NNN Title` H1 that create() writes, when the
   * title changed — is rewritten, preserving the body and unknown fields.
   *
   * A no-op (nothing actually changed) returns the entity WITHOUT writing or
   * publishing. Otherwise publishes `usecase.updated` (Event Catalog §4) and,
   * when the status moved, `usecase.status.changed`, both with
   * correlationId = useCaseId (§19).
   */
  async updateMetadata(id: UseCaseId, changes: UseCaseMetadataChanges): Promise<Result<UseCase>> {
    const title = changes.title?.trim();
    if (title !== undefined && title === "") {
      return err(appError("VALIDATION_FAILED", "A Use Case title is required."));
    }
    // The status arrives from UI input; TypeScript can't protect a cast value,
    // so reject anything outside the UseCaseStatus union at runtime too.
    if (changes.status !== undefined && !USE_CASE_STATUSES.includes(changes.status)) {
      return err(
        appError("VALIDATION_FAILED", `Invalid Use Case status: ${String(changes.status)}.`),
      );
    }

    const found = await this.findById(id);
    if (!found.ok) return err(found.error);
    if (found.value === null) {
      return err(appError("VALIDATION_FAILED", `Unknown Use Case: ${id}`));
    }
    const existing = found.value;

    const nextTitle = title ?? existing.title;
    const nextStatus = changes.status ?? existing.status;
    const changedFields = [
      ...(nextTitle !== existing.title ? ["title"] : []),
      ...(nextStatus !== existing.status ? ["status"] : []),
    ];
    // No-op: nothing changed, so neither write nor publish (subscribers would
    // otherwise re-render for a phantom edit).
    if (changedFields.length === 0) return ok(existing);

    const read = await this.fs.readFile(existing.path);
    if (!read.ok) return err(read.error);
    let content = updateNoteFrontmatter(read.value, { title: nextTitle, status: nextStatus });
    if (nextTitle !== existing.title) {
      // create() writes the body H1 as `# <id> <title>`; mirror that exact
      // format on retitle so heading and frontmatter don't drift. Only the
      // FIRST matching H1 is touched (no /g): hand-written headings stay.
      // The replacement is a FUNCTION so a title containing `$&`/`$$`/`$1`
      // is inserted literally instead of being interpreted as a
      // String.replace substitution pattern (review: data corruption).
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      content = content.replace(
        new RegExp(`^# ${escapedId} .*$`, "m"),
        () => `# ${id} ${nextTitle}`,
      );
    }
    const written = await this.fs.writeFile(existing.path, content);
    if (!written.ok) return err(written.error);

    await this.eventBus.publish(
      createEvent(
        "usecase.updated",
        { useCaseId: id, path: existing.path, changedFields },
        { correlationId: id },
      ),
    );
    if (nextStatus !== existing.status) {
      await this.eventBus.publish(
        createEvent(
          "usecase.status.changed",
          { useCaseId: id, previousStatus: existing.status, nextStatus },
          { correlationId: id },
        ),
      );
    }
    this.logger.info("Use Case metadata updated", { id, changedFields });
    return ok({ ...existing, title: nextTitle, status: nextStatus });
  }

  /** Maps a note's frontmatter to a {@link UseCase}; returns null if it is not one. */
  private parse(content: string, path: VaultPath): UseCase | null {
    const fm = parseFrontmatter(content);
    if (fm.type !== "use-case" || typeof fm.id !== "string") return null;

    const toArray = (value: string | string[] | undefined): string[] =>
      Array.isArray(value) ? value : typeof value === "string" && value !== "" ? [value] : [];
    // Use Case frontmatter is hand-editable (and Sync-able), so even though the
    // plugin writes it, a read-back path is UNTRUSTED input — validate it through
    // the vaultPath() chokepoint (PathSafetyPolicy) and DROP any unsafe one rather
    // than brand it as valid. A dropped path simply isn't surfaced as a link
    // (best-effort read model); it can never reach an fs sink masquerading as
    // policy-validated (review P2, ADR-0008/P0-1).
    const toVaultPaths = (value: string | string[] | undefined): VaultPath[] =>
      toArray(value).flatMap((raw) => {
        const safe = vaultPath(raw);
        return safe.ok ? [safe.value] : [];
      });
    const toVaultPath = (raw: string): VaultPath | undefined => {
      const safe = vaultPath(raw);
      return safe.ok ? safe.value : undefined;
    };

    return {
      id: fm.id,
      title: typeof fm.title === "string" ? fm.title : fm.id,
      description: typeof fm.description === "string" ? fm.description : undefined,
      status: (typeof fm.status === "string" ? fm.status : "draft") as UseCaseStatus,
      automationStatus: (typeof fm.automation_status === "string"
        ? fm.automation_status
        : "not-planned") as AutomationStatus,
      featureFiles: [...toVaultPaths(fm.feature_files), ...toVaultPaths(fm.feature_file)],
      suites: toArray(fm.suites),
      evidence: toVaultPaths(fm.evidence),
      lastTestRun:
        typeof fm.last_run_id === "string"
          ? {
              runId: fm.last_run_id,
              status: (typeof fm.last_run_status === "string"
                ? fm.last_run_status
                : "passed") as TestRunStatus,
              date: typeof fm.last_run_date === "string" ? fm.last_run_date : "",
              evidencePath:
                typeof fm.last_run_evidence === "string"
                  ? toVaultPath(fm.last_run_evidence)
                  : undefined,
              scope:
                typeof fm.last_run_scope === "string"
                  ? (fm.last_run_scope as ExecutionScope)
                  : undefined,
            }
          : undefined,
      path,
    };
  }
}

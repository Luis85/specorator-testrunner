import { buildUseCaseNote, useCaseFileName } from "../content/use-case-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import { collectReadableMarkdown } from "./markdown-notes";
import type { SettingsService } from "./settings-service";
import { EXECUTION_SCOPES, USE_CASE_RUN_OUTCOMES } from "../../domain/entities/test-run";
import {
  AUTOMATION_STATUSES,
  USE_CASE_STATUSES,
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
import { KeyedSerialQueue } from "../../shared/async/serial-queue";

export interface CreateUseCaseRequest {
  title: string;
  description?: string;
  suites?: SuiteId[];
}

/**
 * The narrow PRD existence check {@link UseCaseService.assignToPrd} needs to keep
 * a Use Case from linking to a nonexistent PRD (the single-parent hierarchy
 * invariant, ADR-0026). Satisfied structurally by `PrdService.findById`; injected
 * as a minimal contract rather than the whole service to avoid coupling the two
 * services together.
 */
export interface PrdLookup {
  findById(id: string): Promise<Result<{ id: string } | null>>;
  /**
   * Runs `operation` inside the PRD mutation critical section so `assignToPrd`
   * serializes with PRD create/delete — preventing a delete from racing the
   * link. Satisfied by `PrdService.withMutationLock`.
   */
  withMutationLock<T>(operation: () => Promise<T>): Promise<T>;
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
  /**
   * Links a Use Case to a PRD by writing its `prd-id` frontmatter. Owned here
   * (not by PrdService) so it shares the same per-note write queue as every
   * other Use Case mutation — preventing a lost-update race with evidence/
   * feature/metadata writes to the same note.
   */
  assignToPrd(id: UseCaseId, prdId: string): Promise<Result<UseCase>>;
  /** List unique domains from all use cases with their counts. */
  listDomains(): Promise<Result<{ domain: string; count: number }[]>>;
  /** Count use cases grouped by their assigned PRD id (`prd-id` frontmatter). */
  countUseCasesByPrd(): Promise<Result<Map<string, number>>>;
}

const ID_PATTERN = /^UC-(\d+)$/;

/** A trimmed non-empty frontmatter string, or undefined for blanks/non-strings. */
const readTrimmed = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** Next sequential `UC-NNN` id given the existing use cases (US-015). */
export const nextUseCaseId = (existing: UseCase[]): UseCaseId => {
  const max = existing.reduce((highest, useCase) => {
    const match = ID_PATTERN.exec(useCase.id);
    return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
  }, 0);
  return `UC-${String(max + 1).padStart(3, "0")}`;
};

/**
 * What {@link DefaultUseCaseService.mutateNote} does once it has re-read a Use
 * Case under the per-path write lock: `render` the new note content from the
 * current file content, the `changedFields` for the `usecase.updated` event, the
 * `result` entity to return, the log line, and any `publishFollowUps` events to
 * emit after `usecase.updated`. Returning `null` from the planner is a no-op.
 */
interface NoteMutation {
  render: (content: string) => string;
  changedFields: string[];
  result: UseCase;
  logMessage: string;
  logFields: Record<string, unknown>;
  publishFollowUps?: () => Promise<void>;
}

export class DefaultUseCaseService implements UseCaseService {
  // UC notes have three read-modify-write writers (post-run evidence linking,
  // edit modal, feature linking) that can interleave across awaits (review §4);
  // serialize all note I/O per path. V2 adds more writers (history rollups,
  // evidence stamps, sign-off links) on top of this same mutex. The keyed map
  // is bounded by the vault's UC note count (one lightweight queue per path)
  // and entries are never dropped — fine at vault scale.
  private readonly noteWrites = new KeyedSerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly prdLookup: PrdLookup,
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
    // `||` (not `??`) is deliberate: a whitespace-only textarea collapses to ""
    // and must become undefined so no empty `description:` scalar is emitted.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
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

    const created = await this.noteWrites.run(path, () =>
      this.fs.createFile(path, buildUseCaseNote(useCase)),
    );
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

    const useCases = await collectReadableMarkdown(
      this.fs,
      listed.value,
      (path, content) => this.parse(content, path) ?? undefined,
    );
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
    return this.noteWrites.run(useCase.path, async () => {
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
      // Subscribers are read-only today (render schedulers / tour service's own
      // queue); a subscriber that re-entered noteWrites.run for the same path
      // would deadlock (see SerialQueue docs).
      await this.eventBus.publish(
        createEvent("usecase.updated", {
          useCaseId: useCase.id,
          path: useCase.path,
          changedFields,
        }),
      );
      this.logger.info("Use Case updated", { id: useCase.id, path: useCase.path });
      return ok(undefined);
    });
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
      return err(appError("VALIDATION_FAILED", `Invalid Use Case status: ${changes.status}.`));
    }

    return this.mutateNote(id, (existing) => {
      const nextTitle = title ?? existing.title;
      const nextStatus = changes.status ?? existing.status;
      const changedFields = [
        ...(nextTitle !== existing.title ? ["title"] : []),
        ...(nextStatus !== existing.status ? ["status"] : []),
      ];
      // No-op: nothing changed.
      if (changedFields.length === 0) return null;

      return {
        render: (content) => {
          let next = updateNoteFrontmatter(content, { title: nextTitle, status: nextStatus });
          if (nextTitle !== existing.title) {
            // create() writes the body H1 as `# <id> <title>`; mirror that exact
            // format on retitle so heading and frontmatter don't drift. Only the
            // FIRST matching H1 is touched (no /g): hand-written headings stay.
            // The replacement is a FUNCTION so a title containing `$&`/`$$`/`$1`
            // is inserted literally instead of being interpreted as a
            // String.replace substitution pattern (review: data corruption).
            const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            next = next.replace(
              new RegExp(`^# ${escapedId} .*$`, "m"),
              () => `# ${id} ${nextTitle}`,
            );
          }
          return next;
        },
        changedFields,
        result: { ...existing, title: nextTitle, status: nextStatus },
        logMessage: "Use Case metadata updated",
        logFields: { id, changedFields },
        publishFollowUps:
          nextStatus !== existing.status
            ? async () => {
                await this.eventBus.publish(
                  createEvent(
                    "usecase.status.changed",
                    { useCaseId: id, previousStatus: existing.status, nextStatus },
                    { correlationId: id },
                  ),
                );
              }
            : undefined,
      };
    });
  }

  async assignToPrd(id: UseCaseId, prdId: string): Promise<Result<UseCase>> {
    const target = prdId.trim();
    if (target === "") {
      return err(appError("VALIDATION_FAILED", "A PRD id is required."));
    }

    // Serialize the whole validate-then-write inside the shared PRD mutation lock
    // so a concurrent deletePrd() can't remove the PRD between the existence check
    // and the link write (or vice versa), which would leave this Use Case pointing
    // at a deleted PRD (ADR-0026 single-parent invariant).
    return this.prdLookup.withMutationLock(async () => {
      // The target PRD must exist before persisting the link — guards a stale
      // editor dropdown (PRD deleted after the modal loaded) or a typo.
      const prd = await this.prdLookup.findById(target);
      if (!prd.ok) return err(prd.error);
      if (prd.value === null) {
        return err(appError("VALIDATION_FAILED", `Unknown PRD: ${target}`));
      }

      return this.mutateNote(id, (existing) => {
        // No-op when already linked to the same PRD (avoids a phantom event).
        if (existing.prdId === target) return null;
        return {
          render: (content) => updateNoteFrontmatter(content, { "prd-id": target }),
          changedFields: ["prd-id"],
          result: { ...existing, prdId: target },
          logMessage: "Use Case linked to PRD",
          logFields: { id, prdId: target },
        };
      });
    });
  }

  /**
   * The locked read-modify-write flow shared by {@link updateMetadata} and
   * {@link assignToPrd}. The pre-lock lookup resolves the note path (stable per
   * id — no file move is ever performed); then under the per-path note-write lock
   * it RE-READS the Use Case so the no-op guard and changedFields are computed
   * against the latest on-disk state, never a stale pre-lock snapshot, and hands
   * the fresh entity to `plan`. A `null` plan is a no-op: the entity is returned
   * WITHOUT writing or publishing. Otherwise the rendered content is written and
   * `usecase.updated` (correlationId = id, §19) is published, then any
   * `publishFollowUps` and the log line.
   */
  private async mutateNote(
    id: UseCaseId,
    plan: (existing: UseCase) => NoteMutation | null,
  ): Promise<Result<UseCase>> {
    const preLock = await this.findById(id);
    if (!preLock.ok) return err(preLock.error);
    if (preLock.value === null) {
      return err(appError("VALIDATION_FAILED", `Unknown Use Case: ${id}`));
    }

    return this.noteWrites.run(preLock.value.path, async () => {
      // Re-read inside the lock so two concurrent calls sending the same change
      // can't both pass the no-op guard and each produce a phantom write + event.
      const fresh = await this.findById(id);
      if (!fresh.ok) return err(fresh.error);
      if (fresh.value === null) {
        // Another writer cannot delete the note today, but keep the guard for
        // forward-compatibility (matches the pre-lock not-found shape above).
        return err(appError("VALIDATION_FAILED", `Unknown Use Case: ${id}`));
      }
      const existing = fresh.value;

      const mutation = plan(existing);
      if (mutation === null) return ok(existing); // no-op: no write, no publish

      const read = await this.fs.readFile(existing.path);
      if (!read.ok) return err(read.error);
      const written = await this.fs.writeFile(existing.path, mutation.render(read.value));
      if (!written.ok) return err(written.error);

      // Subscribers are read-only today (render schedulers / tour service's own
      // queue); a subscriber that re-entered noteWrites.run for the same path
      // would deadlock (see SerialQueue docs).
      await this.eventBus.publish(
        createEvent(
          "usecase.updated",
          { useCaseId: id, path: existing.path, changedFields: mutation.changedFields },
          { correlationId: id },
        ),
      );
      if (mutation.publishFollowUps) await mutation.publishFollowUps();
      this.logger.info(mutation.logMessage, mutation.logFields);
      return ok(mutation.result);
    });
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
    // Frontmatter enum fields are hand-editable too, so they can hold anything
    // (`status: banana`) — validate membership against the domain's runtime
    // lists rather than casting blindly into the unions.
    const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
      typeof value === "string" && (values as readonly string[]).includes(value);

    // The last-run summary feeds the ADR-0017 KPI roll-up, so it is parsed
    // strictly: an invalid/missing last_run_status or last_run_scope drops the
    // whole lastTestRun projection rather than defaulting — a fallback like
    // "passed" would let a hand-edited note inflate the Passing KPI.
    const lastTestRun =
      typeof fm.last_run_id === "string" &&
      isOneOf(USE_CASE_RUN_OUTCOMES, fm.last_run_status) &&
      (fm.last_run_scope === undefined || isOneOf(EXECUTION_SCOPES, fm.last_run_scope))
        ? {
            runId: fm.last_run_id,
            status: fm.last_run_status,
            date: typeof fm.last_run_date === "string" ? fm.last_run_date : "",
            evidencePath:
              typeof fm.last_run_evidence === "string"
                ? toVaultPath(fm.last_run_evidence)
                : undefined,
            scope: fm.last_run_scope,
          }
        : undefined;

    return {
      id: fm.id,
      title: typeof fm.title === "string" ? fm.title : fm.id,
      description: typeof fm.description === "string" ? fm.description : undefined,
      status: isOneOf(USE_CASE_STATUSES, fm.status) ? fm.status : "draft",
      automationStatus: isOneOf(AUTOMATION_STATUSES, fm.automation_status)
        ? fm.automation_status
        : "not-planned",
      featureFiles: [...toVaultPaths(fm.feature_files), ...toVaultPaths(fm.feature_file)],
      suites: toArray(fm.suites),
      evidence: toVaultPaths(fm.evidence),
      lastTestRun,
      domain: readTrimmed(fm.domain),
      prdId: readTrimmed(fm["prd-id"]),
      path,
    };
  }

  async listDomains(): Promise<Result<{ domain: string; count: number }[]>> {
    const all = await this.findAll();
    if (!all.ok) return all;
    const counts = new Map<string, number>();
    for (const uc of all.value) {
      if (!uc.domain) continue;
      counts.set(uc.domain, (counts.get(uc.domain) ?? 0) + 1);
    }
    const list = [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
    return ok(list);
  }

  async countUseCasesByPrd(): Promise<Result<Map<string, number>>> {
    const all = await this.findAll();
    if (!all.ok) return all;
    const counts = new Map<string, number>();
    for (const uc of all.value) {
      if (!uc.prdId) continue;
      counts.set(uc.prdId, (counts.get(uc.prdId) ?? 0) + 1);
    }
    return ok(counts);
  }
}

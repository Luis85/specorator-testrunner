import { buildPrdNote, prdFolderName } from "../content/prd-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { Prd, PrdId } from "../../domain/entities/prd";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { parseNote, updateNoteFrontmatter } from "../../shared/utils/frontmatter";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";
import { KeyedSerialQueue } from "../../shared/async/serial-queue";
import { isPrdStatus } from "../../domain/entities/prd";

export interface CreatePrdRequest {
  title: string;
  parentPrdId?: PrdId;
  domains: string[];
  vision: string;
  scopeIn: string[];
  scopeOut: string[];
  /** Optional free-text research synthesis; seeds the note's Research Summary. */
  research?: string;
}

/** Outcome of a successful {@link PrdService.deletePrd}. */
export interface DeletePrdResult {
  /** Non-PRD files left untouched in the PRD's folder (e.g. diagrams). */
  preservedFiles: number;
}

export interface PrdService {
  create(request: CreatePrdRequest): Promise<Result<Prd>>;
  findAll(): Promise<Result<Prd[]>>;
  findById(id: PrdId): Promise<Result<Prd | null>>;
  assignUseCaseToPrd(useCasePath: VaultPath, prdId: PrdId): Promise<Result<void>>;
  /**
   * Deletes a PRD note, preserving sibling attachments in its folder. Refuses
   * the root PRD, a PRD with child PRDs, or a PRD with linked Use Cases.
   */
  deletePrd(id: PrdId): Promise<Result<DeletePrdResult>>;
}

const PRD_ID_RE = /^PRD-(\d{3,})$/;

/** Drop blanks and collapse newlines so each item is a single parser-safe line. */
const normalizeLines = (values: string[] | undefined): string[] =>
  (values ?? []).filter((s) => s.trim() !== "").map((s) => s.replace(/\n+/g, " ").trim());

/** The folder containing a note path, e.g. `PRDs/PRD-001-x/PRD-001-x.md` → `PRDs/PRD-001-x`. */
const parentFolder = (path: VaultPath): VaultPath => {
  const s = String(path);
  const idx = s.lastIndexOf("/");
  return (idx === -1 ? s : s.slice(0, idx)) as VaultPath;
};

export class DefaultPrdService implements PrdService {
  private readonly noteWrites = new KeyedSerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async create(request: CreatePrdRequest): Promise<Result<Prd>> {
    const validated = this.validateAndNormalize(request);
    if (!validated.ok) return validated;
    const { title, vision, scopeIn, scopeOut, domains } = validated.value;

    const settings = await this.settingsService.load();

    // Allocate ID inside write queue to serialize against concurrent creates (race prevention).
    // Returns the created PRD directly from queue callback to avoid null-checking.
    const queueKey = `prd:create:${title}`; // Serialize all PRD creates together
    return this.noteWrites.run(queueKey, async () => {
      const existing = await this.findAll();
      if (!existing.ok) return existing;

      const id = this.nextId(existing.value.map((p) => p.id));
      const folder = prdFolderName(id, title);
      const path = joinVaultPath(settings.paths.prdsPath, folder, `${folder}.md`);

      const prd: Prd = {
        id,
        title,
        status: "draft",
        parentPrdId: request.parentPrdId,
        domains,
        vision,
        scopeIn,
        scopeOut,
        displayOrder: existing.value.length,
        path,
      };

      const folderPath = joinVaultPath(settings.paths.prdsPath, folder);
      const folderResult = await this.fs.createFolder(folderPath);
      if (!folderResult.ok) return folderResult;

      const createResult = await this.fs.createFile(path, buildPrdNote(prd, request.research));
      if (!createResult.ok) return createResult;

      await this.eventBus.publish(
        createEvent(
          "prd.created",
          { prdId: prd.id, title, path: String(prd.path), parentPrdId: request.parentPrdId },
          { correlationId: prd.id },
        ),
      );
      this.logger.info("PRD created", { id: prd.id, path: prd.path });
      return ok(prd);
    });
  }

  /**
   * Validates required fields and normalizes scope/domain lists. Multiline scope
   * items are collapsed to single lines to stay within the frontmatter parser's
   * scalar/block-sequence support. Returns the cleaned inputs or the first error.
   */
  private validateAndNormalize(request: CreatePrdRequest): Result<{
    title: string;
    vision: string;
    scopeIn: string[];
    scopeOut: string[];
    domains: string[];
  }> {
    const title = request.title.trim();
    if (title === "") {
      return err(appError("VALIDATION_FAILED", "A PRD title is required."));
    }

    const vision = request.vision.trim();
    if (vision === "") {
      return err(appError("VALIDATION_FAILED", "PRD vision statement is required."));
    }

    const scopeIn = normalizeLines(request.scopeIn);
    if (scopeIn.length === 0) {
      return err(appError("VALIDATION_FAILED", "At least one item must be in scope."));
    }

    const scopeOut = normalizeLines(request.scopeOut);
    if (scopeOut.length === 0) {
      return err(appError("VALIDATION_FAILED", "At least one item must be out of scope."));
    }

    const domains = (request.domains || []).filter((d) => d.trim() !== "");
    if (request.parentPrdId && domains.length === 0) {
      return err(appError("VALIDATION_FAILED", "Sub-PRDs must be linked to at least one domain."));
    }

    return ok({ title, vision, scopeIn, scopeOut, domains });
  }

  async findAll(): Promise<Result<Prd[]>> {
    const settings = await this.settingsService.load();
    const listed = await this.fs.listFilesRecursive(settings.paths.prdsPath);
    // Distinguish folder-not-found (ok, return empty) from real I/O errors (propagate)
    if (!listed.ok) {
      const messageLC = listed.error.message.toLowerCase();
      if (messageLC.includes("enoent") || messageLC.includes("not found")) {
        return ok([]); // folder doesn't exist yet; treat as empty
      }
      return listed; // real I/O error; propagate to caller
    }
    const prds: Prd[] = [];
    for (const path of listed.value) {
      if (!String(path).endsWith(".md")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue;
      const parsed = this.parse(read.value, path);
      if (parsed) prds.push(parsed);
    }
    prds.sort((a, b) => a.id.localeCompare(b.id));
    return ok(prds);
  }

  async findById(id: PrdId): Promise<Result<Prd | null>> {
    const all = await this.findAll();
    if (!all.ok) return all;
    return ok(all.value.find((p) => p.id === id) ?? null);
  }

  async assignUseCaseToPrd(useCasePath: VaultPath, prdId: PrdId): Promise<Result<void>> {
    // Note: This queue is independent of DefaultUseCaseService's per-path queue.
    // Concurrent UC updates (edit, post-run evidence, feature links) may race here;
    // future refactor should route through UseCaseService or use a shared note-level mutex.
    return this.noteWrites.run(useCasePath, async () => {
      const read = await this.fs.readFile(useCasePath);
      if (!read.ok) return read;
      const next = updateNoteFrontmatter(read.value, { "prd-id": prdId });
      const write = await this.fs.writeFile(useCasePath, next);
      if (!write.ok) return write;

      // Emit usecase.updated so Explorer live-refresh recomputes counts & breadcrumbs
      // Extract useCaseId from the frontmatter to emit a properly-typed event
      const readForId = await this.fs.readFile(useCasePath);
      if (readForId.ok) {
        const { frontmatter: fm } = parseNote(readForId.value);
        if (typeof fm.id === "string") {
          await this.eventBus.publish(
            createEvent("usecase.updated", {
              useCaseId: fm.id,
              path: String(useCasePath),
              changedFields: ["prd-id"],
            }),
          );
        }
      }
      return ok(undefined);
    });
  }

  async deletePrd(id: PrdId): Promise<Result<DeletePrdResult>> {
    const all = await this.findAll();
    if (!all.ok) return all;
    const target = all.value.find((p) => p.id === id);
    if (!target) {
      return err(appError("VALIDATION_FAILED", `PRD ${id} was not found.`));
    }
    // The root PRD anchors the Explorer/Dashboard; it is never deletable.
    if (id === "PRD-000" || target.parentPrdId === undefined) {
      return err(appError("VALIDATION_FAILED", "The root PRD (PRD-000) cannot be deleted."));
    }
    if (all.value.some((p) => p.parentPrdId === id)) {
      return err(
        appError("VALIDATION_FAILED", `PRD ${id} has child PRDs; delete or reassign them first.`),
      );
    }
    const linkedUcs = await this.countLinkedUseCases(id);
    if (!linkedUcs.ok) return linkedUcs;
    if (linkedUcs.value > 0) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `PRD ${id} still has ${linkedUcs.value} linked Use Case(s); reassign them first.`,
        ),
      );
    }

    // Delete only the PRD note; leave any sibling attachments (diagrams, etc.).
    const folder = parentFolder(target.path);
    return this.noteWrites.run(target.path, async () => {
      const deleted = await this.fs.deleteFile(target.path);
      if (!deleted.ok) return deleted;

      let preservedFiles = 0;
      const listed = await this.fs.listFilesRecursive(folder);
      if (listed.ok) {
        preservedFiles = listed.value.filter((p) => p !== target.path).length;
      }

      await this.eventBus.publish(
        createEvent(
          "prd.deleted",
          { prdId: id, path: String(target.path), preservedFiles },
          { correlationId: id },
        ),
      );
      this.logger.info("PRD deleted", { id, preservedFiles });
      return ok({ preservedFiles });
    });
  }

  /** Counts Use Case notes whose `prd-id` frontmatter points at `prdId`. */
  private async countLinkedUseCases(prdId: PrdId): Promise<Result<number>> {
    const settings = await this.settingsService.load();
    const listed = await this.fs.listFilesRecursive(settings.paths.useCasesPath);
    if (!listed.ok) {
      const messageLC = listed.error.message.toLowerCase();
      if (messageLC.includes("enoent") || messageLC.includes("not found")) return ok(0);
      return listed;
    }
    let count = 0;
    for (const path of listed.value) {
      if (!String(path).endsWith(".md")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue;
      const { frontmatter: fm } = parseNote(read.value);
      if (typeof fm["prd-id"] === "string" && fm["prd-id"].trim() === prdId) count++;
    }
    return ok(count);
  }

  private nextId(ids: PrdId[]): PrdId {
    let max = 0; // PRD-000 reserved; new PRDs start at 001
    for (const id of ids) {
      const m = PRD_ID_RE.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `PRD-${String(max + 1).padStart(3, "0")}`;
  }

  private parse(content: string, path: VaultPath): Prd | null {
    const { frontmatter: fm } = parseNote(content);
    if (fm.type !== "prd" || typeof fm.id !== "string") return null;
    const asArray = (v: string | string[] | undefined): string[] =>
      Array.isArray(v) ? v : v && v !== "" ? [v] : [];
    const parent = typeof fm["parent-prd"] === "string" ? fm["parent-prd"].trim() : "";
    const status = isPrdStatus(fm.status) ? fm.status : "draft";
    return {
      id: fm.id,
      title: typeof fm.title === "string" ? fm.title : fm.id,
      status,
      parentPrdId: parent === "" ? undefined : parent,
      domains: asArray(fm.domains),
      vision: typeof fm.vision === "string" ? fm.vision : "",
      scopeIn: asArray(fm.scope_in),
      scopeOut: asArray(fm.scope_out),
      displayOrder:
        Number.parseInt(typeof fm.display_order === "string" ? fm.display_order : "0", 10) || 0,
      path,
    };
  }
}

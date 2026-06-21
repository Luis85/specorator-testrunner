import { buildPrdNote, prdFolderName } from "../content/prd-content";
import { parseStoryMapNote } from "../content/story-map-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import { resolveParentPrdId } from "./prd-builder";
import type { Prd, PrdId } from "../../domain/entities/prd";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { parseNote } from "../../shared/utils/frontmatter";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath, parentVaultPath } from "../../shared/utils/vault-path";
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
  /**
   * Deletes a PRD note, preserving sibling attachments in its folder. Refuses
   * the root PRD, a PRD with child PRDs, or a PRD with linked Use Cases.
   */
  deletePrd(id: PrdId): Promise<Result<DeletePrdResult>>;
  /**
   * Runs `operation` inside the PRD mutation critical section (the same one
   * create/delete use), so an external PRD-relationship writer —
   * UseCaseService.assignToPrd — serializes against create()/deletePrd() and a
   * Use Case can't be linked to a PRD that a concurrent delete is removing
   * (ADR-0026 single-parent invariant).
   */
  withMutationLock<T>(operation: () => Promise<T>): Promise<T>;
}

const PRD_ID_RE = /^PRD-(\d{3,})$/;

/** Single queue key so all PRD hierarchy mutations (create + delete) serialize. */
const PRD_MUTATE_KEY = "prd:mutate";

/** Drop blanks and collapse newlines so each item is a single parser-safe line. */
const normalizeLines = (values: string[] | undefined): string[] =>
  (values ?? []).filter((s) => s.trim() !== "").map((s) => s.replace(/\n+/g, " ").trim());

export class DefaultPrdService implements PrdService {
  private readonly noteWrites = new KeyedSerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  /**
   * The PRD-wide critical section (PRD_MUTATE_KEY) used by create()/deletePrd();
   * exposed so UseCaseService.assignToPrd can serialize a Use Case→PRD link
   * against PRD deletion through the same lock.
   */
  withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.noteWrites.run(PRD_MUTATE_KEY, operation);
  }

  async create(request: CreatePrdRequest): Promise<Result<Prd>> {
    const validated = this.validateAndNormalize(request);
    if (!validated.ok) return validated;
    const { title, vision, scopeIn, scopeOut, domains } = validated.value;

    const settings = await this.settingsService.load();

    // Allocate the ID inside the shared mutation queue key so concurrent creates
    // AND deletes serialize — two creates must never read the same id set and
    // both pick the same next id, and a delete must not interleave with a create
    // (see deletePrd). Returns the PRD directly from the callback.
    return this.noteWrites.run(PRD_MUTATE_KEY, async () => {
      const existing = await this.findAll();
      if (!existing.ok) return existing;

      // An explicit parent must reference an existing PRD; a dangling parent would
      // render as an orphan root and break the single-root tree (ADR-0026).
      if (
        request.parentPrdId !== undefined &&
        !existing.value.some((p) => p.id === request.parentPrdId)
      ) {
        return err(appError("VALIDATION_FAILED", `Unknown parent PRD: ${request.parentPrdId}.`));
      }

      // Resolve the effective parent (the same rule the builder UI uses): an
      // omitted parent defaults under the root once one exists, so a second root
      // can never be created by accident. It stays undefined only for the very
      // first PRD in an empty vault.
      const parentPrdId = resolveParentPrdId(request.parentPrdId, existing.value);

      // Any non-root PRD must name at least one domain (invariant from ADR-0026).
      // Checked here, not in validateAndNormalize, because whether this PRD is a
      // sub-PRD depends on the resolved parent above.
      if (parentPrdId !== undefined && domains.length === 0) {
        return err(
          appError("VALIDATION_FAILED", "Sub-PRDs must be linked to at least one domain."),
        );
      }

      // The first PRD (no parent, empty vault) claims the reserved PRD-000 (the
      // product vision); every other PRD takes the next sequential id.
      const id =
        parentPrdId === undefined ? "PRD-000" : this.nextId(existing.value.map((p) => p.id));
      const folder = prdFolderName(id, title);
      const path = joinVaultPath(settings.paths.prdsPath, folder, `${folder}.md`);

      const prd: Prd = {
        id,
        title,
        status: "draft",
        parentPrdId,
        domains,
        vision,
        scopeIn,
        scopeOut,
        // Allocation order only (V1 has no reparent/reorder); siblings are
        // sorted by `displayOrder || id.localeCompare`, so a value reused after
        // a delete still resolves deterministically by the immutable id.
        displayOrder: existing.value.length,
        path,
      };

      const folderPath = joinVaultPath(settings.paths.prdsPath, folder);
      // Whether the folder already existed: cleanup below must only remove a
      // folder THIS call created, never a pre-existing one (which could hold
      // user content — diagrams, a stale draft), since createFolder is a no-op
      // success on an existing path.
      const folderPreexisted = await this.fs.exists(folderPath);
      const folderResult = await this.fs.createFolder(folderPath);
      if (!folderResult.ok) return folderResult;

      const createResult = await this.fs.createFile(path, buildPrdNote(prd, request.research));
      if (!createResult.ok) {
        // Don't leave an orphaned empty PRD folder behind on a note-write
        // failure; best-effort, and only for the folder we just created (the
        // original error is what we return).
        if (!folderPreexisted) await this.fs.deleteFolder(folderPath);
        return createResult;
      }

      await this.eventBus.publish(
        createEvent(
          "prd.created",
          { prdId: prd.id, title, path: String(prd.path), parentPrdId },
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

    // Vision is a single-line frontmatter scalar; collapse newlines/whitespace
    // runs so a multiline textarea value can't break the YAML or be truncated on
    // read (mirrors how UseCaseService normalizes `description`).
    const vision = request.vision.replace(/\s+/g, " ").trim();
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

    // The sub-PRD "≥1 domain" rule depends on the resolved parent, so it lives in
    // create() (after parent resolution); here we only normalize the list.
    const domains = (request.domains || []).filter((d) => d.trim() !== "");

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
      if (!read.ok) continue; // index is best-effort; skip unreadable notes (matches UseCaseService)
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

  async deletePrd(id: PrdId): Promise<Result<DeletePrdResult>> {
    // Run the guard checks AND the delete inside the SAME critical section as
    // create() (PRD_MUTATE_KEY) so a concurrent create(parent=id) can't slip a
    // new sub-PRD past the child scan and then be orphaned by this delete:
    // either the create lands first and the child scan refuses, or the delete
    // lands first and the create rejects the now-missing parent.
    return this.noteWrites.run(PRD_MUTATE_KEY, async () => {
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

      // A Story Map anchors to a PRD via its `product` field; deleting that PRD
      // would dangle the map's product link (ADR-0027/0028). Refuse, mirroring
      // the linked-Use-Case guard above, so the anchor can never go missing.
      const linkedMaps = await this.countLinkedStoryMaps(id);
      if (!linkedMaps.ok) return linkedMaps;
      if (linkedMaps.value > 0) {
        return err(
          appError(
            "VALIDATION_FAILED",
            `PRD ${id} is the product anchor of ${linkedMaps.value} Story Map(s); reassign them first.`,
          ),
        );
      }

      // Delete only the PRD note; leave any sibling attachments (diagrams, etc.).
      const folder = parentVaultPath(target.path);
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

  /**
   * Counts the `.md` notes under `dir` that `counts` accepts. Fail-closed for a
   * DESTRUCTIVE delete: unlike findAll's best-effort indexing, an unreadable note
   * could still carry the anchor being checked, so a read error propagates (and
   * deletePrd aborts); a missing folder counts as 0. `skip` excludes whole subtrees
   * (e.g. generated card notes that can't carry the anchor).
   */
  private async countNotesUnder(
    dir: VaultPath,
    counts: (content: string, path: VaultPath) => boolean,
    skip?: (path: VaultPath) => boolean,
  ): Promise<Result<number>> {
    const listed = await this.fs.listFilesRecursive(dir);
    if (!listed.ok) {
      const messageLC = listed.error.message.toLowerCase();
      if (messageLC.includes("enoent") || messageLC.includes("not found")) return ok(0);
      return listed;
    }
    let count = 0;
    for (const path of listed.value) {
      if (!String(path).endsWith(".md")) continue;
      if (skip?.(path)) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) return read;
      if (counts(read.value, path)) count++;
    }
    return ok(count);
  }

  /** Counts Use Case notes whose `prd-id` frontmatter points at `prdId`. */
  private async countLinkedUseCases(prdId: PrdId): Promise<Result<number>> {
    const settings = await this.settingsService.load();
    return this.countNotesUnder(settings.paths.useCasesPath, (content) => {
      const { frontmatter: fm } = parseNote(content);
      return typeof fm["prd-id"] === "string" && fm["prd-id"].trim() === prdId;
    });
  }

  /** Counts Story Map notes whose `product` frontmatter anchors to `prdId`. */
  private async countLinkedStoryMaps(prdId: PrdId): Promise<Result<number>> {
    const settings = await this.settingsService.load();
    const root = String(settings.paths.storyMapsPath);
    // Reuse parseStoryMapNote so the guard can't drift from StoryMapService.findAll:
    // it filters non-map notes AND applies the ADR-0027 default (a blank `product`
    // resolves to PRD-000). Skip per-card notes (ADR-0030) WITHOUT reading them (so
    // an unreadable card note can't fail-close the delete), but only at their exact
    // generated location — `<map>/cards/<file>` relative to the maps root — so a map
    // note under a differently-structured or top-level `cards` folder is still scanned.
    return this.countNotesUnder(
      settings.paths.storyMapsPath,
      (content, path) => parseStoryMapNote(content, path)?.product === prdId,
      (path) => {
        const rel = String(path).slice(root.length).replace(/^\/+/, "").split("/");
        return rel.length === 3 && rel[1] === "cards";
      },
    );
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

import {
  buildStoryMapNote,
  renderStoryMapGridTable,
  replaceGridBlock,
  storyMapFolderName,
} from "../content/story-map-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import {
  isStoryMapStatus,
  parseCard,
  type StoryMap,
  type StoryMapCard,
  type StoryMapId,
} from "../../domain/entities/story-map";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { parseNote } from "../../shared/utils/frontmatter";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";
import { KeyedSerialQueue } from "../../shared/async/serial-queue";

export interface CreateStoryMapRequest {
  title: string;
  /** The product (PRD id) this map anchors to; defaults to "PRD-000". */
  product?: string;
  /** Backbone activity labels (ordered). At least one is required. */
  activities: string[];
  /** Release slice labels (ordered). At least one is required. */
  slices: string[];
  /** Optional initial Use Case placements (usually added later via the note). */
  cards?: StoryMapCard[];
}

/** Outcome of a successful {@link StoryMapService.deleteStoryMap}. */
export interface DeleteStoryMapResult {
  /** Non-note files left untouched in the map's folder (e.g. diagrams). */
  preservedFiles: number;
}

/**
 * The narrow lookup the service needs to resolve a `UC-NNN`/`PRD-NNN` id to its
 * real note path, so the grid's Use Case links and the body's product link
 * resolve in Obsidian instead of dangling. Satisfied structurally by both
 * UseCaseService.findById and PrdService.findById.
 */
export interface NoteResolver {
  findById(id: string): Promise<Result<{ path: VaultPath } | null>>;
}

export interface StoryMapService {
  create(request: CreateStoryMapRequest): Promise<Result<StoryMap>>;
  findAll(): Promise<Result<StoryMap[]>>;
  findById(id: StoryMapId): Promise<Result<StoryMap | null>>;
  deleteStoryMap(id: StoryMapId): Promise<Result<DeleteStoryMapResult>>;
  /**
   * Regenerates the note's managed grid block from its (authoritative) `cards`
   * frontmatter, resolving each `UC-NNN` to its real note name. Use after
   * hand-editing the `cards` list so the rendered table matches the data.
   */
  rebuildGrid(id: StoryMapId): Promise<Result<void>>;
}

const STORY_MAP_ID_RE = /^SM-(\d{3,})$/;

/** Single queue key so all Story Map id-allocating mutations serialize. */
const STORY_MAP_MUTATE_KEY = "story-map:mutate";

const DEFAULT_PRODUCT = "PRD-000";

/** Drop blanks, collapse newlines, reject the `|` card delimiter, and dedupe. */
const normalizeLabels = (values: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.replace(/[\s|]+/g, " ").trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

/** The folder containing a note path, e.g. `Story Maps/SM-001-x/SM-001-x.md` → `Story Maps/SM-001-x`. */
const parentFolder = (path: VaultPath): VaultPath => {
  const s = String(path);
  const idx = s.lastIndexOf("/");
  return (idx === -1 ? s : s.slice(0, idx)) as VaultPath;
};

export class DefaultStoryMapService implements StoryMapService {
  private readonly noteWrites = new KeyedSerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly useCases: NoteResolver,
    private readonly prds: NoteResolver,
  ) {}

  async create(request: CreateStoryMapRequest): Promise<Result<StoryMap>> {
    const title = request.title.trim();
    if (title === "") {
      return err(appError("VALIDATION_FAILED", "A Story Map title is required."));
    }
    const activities = normalizeLabels(request.activities);
    if (activities.length === 0) {
      return err(appError("VALIDATION_FAILED", "A Story Map needs at least one activity."));
    }
    const slices = normalizeLabels(request.slices);
    if (slices.length === 0) {
      return err(appError("VALIDATION_FAILED", "A Story Map needs at least one release slice."));
    }
    const trimmedProduct = request.product?.trim();
    const product =
      trimmedProduct !== undefined && trimmedProduct !== "" ? trimmedProduct : DEFAULT_PRODUCT;

    const settings = await this.settingsService.load();

    // Allocate the id inside the shared mutation key so two concurrent creates
    // can't read the same id set and both pick the same next id.
    return this.noteWrites.run(STORY_MAP_MUTATE_KEY, async () => {
      const existing = await this.findAll();
      if (!existing.ok) return existing;

      const id = this.nextId(existing.value.map((m) => m.id));
      const folder = storyMapFolderName(id, title);
      const path = joinVaultPath(settings.paths.storyMapsPath, folder, `${folder}.md`);

      const map: StoryMap = {
        id,
        title,
        status: "draft",
        product,
        activities,
        slices,
        cards: request.cards ?? [],
        displayOrder: existing.value.length,
        path,
      };

      const folderPath = joinVaultPath(settings.paths.storyMapsPath, folder);
      const folderPreexisted = await this.fs.exists(folderPath);
      const folderResult = await this.fs.createFolder(folderPath);
      if (!folderResult.ok) return folderResult;

      const noteNames = await this.resolveNoteNames(map);
      const createResult = await this.fs.createFile(path, buildStoryMapNote(map, noteNames));
      if (!createResult.ok) {
        // Don't leave an orphaned empty folder behind on a note-write failure;
        // only for the folder this call created.
        if (!folderPreexisted) await this.fs.deleteFolder(folderPath);
        return createResult;
      }

      await this.eventBus.publish(
        createEvent(
          "storymap.created",
          { storyMapId: map.id, title, path: String(map.path), product },
          { correlationId: map.id },
        ),
      );
      this.logger.info("Story Map created", { id: map.id, path: map.path });
      return ok(map);
    });
  }

  async findAll(): Promise<Result<StoryMap[]>> {
    const settings = await this.settingsService.load();
    const listed = await this.fs.listFilesRecursive(settings.paths.storyMapsPath);
    if (!listed.ok) {
      const messageLC = listed.error.message.toLowerCase();
      if (messageLC.includes("enoent") || messageLC.includes("not found")) return ok([]);
      return listed;
    }
    const maps: StoryMap[] = [];
    for (const path of listed.value) {
      if (!String(path).endsWith(".md")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue; // index is best-effort; skip unreadable notes
      const parsed = this.parse(read.value, path);
      if (parsed) maps.push(parsed);
    }
    maps.sort((a, b) => a.id.localeCompare(b.id));
    return ok(maps);
  }

  async findById(id: StoryMapId): Promise<Result<StoryMap | null>> {
    const all = await this.findAll();
    if (!all.ok) return all;
    return ok(all.value.find((m) => m.id === id) ?? null);
  }

  async deleteStoryMap(id: StoryMapId): Promise<Result<DeleteStoryMapResult>> {
    return this.noteWrites.run(STORY_MAP_MUTATE_KEY, async () => {
      const target = await this.findById(id);
      if (!target.ok) return target;
      if (!target.value) {
        return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
      }

      // Delete only the map note; leave any sibling attachments (diagrams, etc.).
      const folder = parentFolder(target.value.path);
      const deleted = await this.fs.deleteFile(target.value.path);
      if (!deleted.ok) return deleted;

      let preservedFiles = 0;
      const listed = await this.fs.listFilesRecursive(folder);
      if (listed.ok) {
        preservedFiles = listed.value.filter((p) => p !== target.value?.path).length;
      }

      await this.eventBus.publish(
        createEvent(
          "storymap.deleted",
          { storyMapId: id, path: String(target.value.path), preservedFiles },
          { correlationId: id },
        ),
      );
      this.logger.info("Story Map deleted", { id, preservedFiles });
      return ok({ preservedFiles });
    });
  }

  async rebuildGrid(id: StoryMapId): Promise<Result<void>> {
    // Serialize through the SAME mutation key as create/delete: a concurrent
    // deleteStoryMap must not interleave, or this write could recreate a note
    // the delete just removed (writeFile recreates missing files). The note is
    // re-read inside the lock, so a delete that won the lock leaves findById
    // returning null here and we abort rather than resurrect it.
    return this.noteWrites.run(STORY_MAP_MUTATE_KEY, async () => {
      const found = await this.findById(id);
      if (!found.ok) return found;
      if (!found.value) {
        return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
      }
      const map = found.value;
      const read = await this.fs.readFile(map.path);
      if (!read.ok) return read;
      const ucNoteNames = await this.resolveUseCaseNoteNames(map.cards.map((c) => c.ucId));
      // Normalize CRLF→LF on the raw content BEFORE parsing/slicing: parseNote
      // returns an LF-normalized body, so subtracting its length from a raw CRLF
      // string would slice mid-body and corrupt the note. Normalizing first keeps
      // the frontmatter boundary aligned with the body parseNote returns.
      const normalized = read.value.replace(/\r\n/g, "\n");
      const { body } = parseNote(normalized);
      const nextBody = replaceGridBlock(body, renderStoryMapGridTable(map, ucNoteNames));
      const frontmatter = normalized.slice(0, normalized.length - body.length);
      return this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
    });
  }

  /** Resolves an id to its note basename via the given lookup, or undefined. */
  private async noteNameOf(resolver: NoteResolver, id: string): Promise<string | undefined> {
    const found = await resolver.findById(id);
    if (found.ok && found.value) {
      return (String(found.value.path).split("/").pop() ?? id).replace(/\.md$/, "");
    }
    return undefined;
  }

  /** Resolves each Use Case id to its note basename so grid links never dangle. */
  private async resolveUseCaseNoteNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of new Set(ids)) {
      const name = await this.noteNameOf(this.useCases, id);
      if (name !== undefined) names.set(id, name);
    }
    return names;
  }

  /**
   * Note names for everything a freshly built note links: the product PRD (body
   * link) and every card's Use Case (grid cells). Both render as resolved,
   * aliased wikilinks so neither dangles for titled notes.
   */
  private async resolveNoteNames(map: StoryMap): Promise<Map<string, string>> {
    const names = await this.resolveUseCaseNoteNames(map.cards.map((c) => c.ucId));
    const productName = await this.noteNameOf(this.prds, map.product);
    if (productName !== undefined) names.set(map.product, productName);
    return names;
  }

  private nextId(ids: StoryMapId[]): StoryMapId {
    let max = 0;
    for (const id of ids) {
      const m = STORY_MAP_ID_RE.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `SM-${String(max + 1).padStart(3, "0")}`;
  }

  private parse(content: string, path: VaultPath): StoryMap | null {
    const { frontmatter: fm } = parseNote(content);
    if (fm.type !== "story-map" || typeof fm.id !== "string") return null;
    const asArray = (v: string | string[] | undefined): string[] =>
      Array.isArray(v) ? v : v && v !== "" ? [v] : [];
    const cards = asArray(fm.cards)
      .map(parseCard)
      .filter((card): card is StoryMapCard => card !== null);
    return {
      id: fm.id,
      title: typeof fm.title === "string" ? fm.title : fm.id,
      status: isStoryMapStatus(fm.status) ? fm.status : "draft",
      product: typeof fm.product === "string" && fm.product !== "" ? fm.product : DEFAULT_PRODUCT,
      activities: asArray(fm.activities),
      slices: asArray(fm.slices),
      cards,
      displayOrder:
        Number.parseInt(typeof fm.display_order === "string" ? fm.display_order : "0", 10) || 0,
      path,
    };
  }
}

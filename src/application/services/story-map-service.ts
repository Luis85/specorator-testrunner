import {
  buildStoryMapNote,
  parseStoryMapNote,
  renderProductParagraph,
  renderStoryMapGridTable,
  replaceGridBlock,
  replaceProductBlock,
  storyMapFolderName,
} from "../content/story-map-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import {
  encodeCard,
  normalizeLabels,
  normalizeSteps,
  STORY_MAP_DEFAULT_PRODUCT,
  type StoryMap,
  type StoryMapCard,
  type StoryMapId,
  type StoryMapStep,
} from "../../domain/entities/story-map";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import {
  addCardToList,
  removeCardFromList,
  updateCardInList,
  validateCardPlacement,
} from "./story-map-cards";
import { parseNote, updateNoteFrontmatter } from "../../shared/utils/frontmatter";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath, parentVaultPath } from "../../shared/utils/vault-path";
import { KeyedSerialQueue } from "../../shared/async/serial-queue";

export interface CreateStoryMapRequest {
  title: string;
  /** The product (PRD id) this map anchors to; defaults to "PRD-000". */
  product?: string;
  /** Audience/persona labels (ordered). Optional. */
  users?: string[];
  /** Backbone activity labels (ordered). At least one is required. */
  activities: string[];
  /** Task-level steps, each `"activity | step"`-encoded. Optional. */
  steps?: StoryMapStep[];
  /** Release slice labels (ordered). At least one is required. */
  slices: string[];
  /** Optional initial rich card placements (usually added later via the note). */
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

/**
 * The PRD dependency for {@link DefaultStoryMapService.create}: resolves a PRD's
 * note path (for the product link) AND exposes the PRD mutation lock so map
 * creation serializes with `PrdService.deletePrd` — a map can never be anchored
 * to a PRD that a concurrent delete is removing. Satisfied by PrdService.
 */
export interface PrdGuard extends NoteResolver {
  withMutationLock<T>(operation: () => Promise<T>): Promise<T>;
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
  /**
   * Authoring without hand-editing frontmatter: add a rich card to the map,
   * validating its placement, rewriting the `cards` frontmatter, and
   * regenerating the managed grid block. Returns the updated map.
   */
  addCard(id: StoryMapId, card: StoryMapCard): Promise<Result<StoryMap>>;
  /** Replaces the card at `index` (out-of-range → VALIDATION_FAILED). */
  updateCard(id: StoryMapId, index: number, card: StoryMapCard): Promise<Result<StoryMap>>;
  /** Removes the card at `index` (out-of-range → VALIDATION_FAILED). */
  removeCard(id: StoryMapId, index: number): Promise<Result<StoryMap>>;
}

const STORY_MAP_ID_RE = /^SM-(\d{3,})$/;

/** Single queue key so all Story Map id-allocating mutations serialize. */
const STORY_MAP_MUTATE_KEY = "story-map:mutate";

/** The defined `UC-NNN` refs of a card set (reference-less cards contribute none). */
const cardRefs = (cards: readonly StoryMapCard[]): string[] =>
  cards.map((c) => c.ref).filter((ref): ref is string => ref !== undefined);

/**
 * Regenerates BOTH managed body blocks from the authoritative map: the grid
 * (cards) and the product paragraph (so a reassigned `product` link is refreshed
 * in the visible body, not just the frontmatter). Hand-written sections are left
 * untouched. Shared by {@link DefaultStoryMapService.rebuildGrid} and the
 * card-write path. Pure: no I/O.
 */
const refreshManagedBlocks = (
  body: string,
  map: StoryMap,
  noteNames: Map<string, string>,
): string => {
  const gridded = replaceGridBlock(body, renderStoryMapGridTable(map, noteNames));
  return replaceProductBlock(gridded, renderProductParagraph(map.product, noteNames));
};

/**
 * The reason a card mutation must be rejected (out-of-range index or invalid
 * placement), or null when it may proceed. Pure: keeps {@link mutateCards} thin.
 */
const cardMutationError = (
  map: StoryMap,
  options: { validate?: (map: StoryMap) => string | null; requireIndex?: number },
): string | null => {
  const index = options.requireIndex;
  if (index !== undefined && (index < 0 || index >= map.cards.length)) {
    return `Card index ${index} is out of range for ${map.id}.`;
  }
  return options.validate?.(map) ?? null;
};

export class DefaultStoryMapService implements StoryMapService {
  private readonly noteWrites = new KeyedSerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly useCases: NoteResolver,
    private readonly prds: PrdGuard,
  ) {}

  async create(request: CreateStoryMapRequest): Promise<Result<StoryMap>> {
    // Collapse whitespace/newlines so the title is a single parser-safe line (a
    // pasted multi-line title would otherwise break the frontmatter scalar).
    const title = request.title.replace(/\s+/g, " ").trim();
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
      trimmedProduct !== undefined && trimmedProduct !== ""
        ? trimmedProduct
        : STORY_MAP_DEFAULT_PRODUCT;
    const users = normalizeLabels(request.users);
    const steps = normalizeSteps(request.steps, activities);
    // Initial cards (the interface supports bulk/import create) must pass the
    // SAME placement validation as addCard/updateCard, against the normalized
    // axes — otherwise an off-map or unsafe card (`|`/newline fields, non-integer
    // points) would persist and break the encoded frontmatter/roll-up.
    const cards = request.cards ?? [];
    for (const card of cards) {
      const reason = validateCardPlacement({ activities, slices, steps }, card);
      if (reason !== null) return err(appError("VALIDATION_FAILED", reason));
    }

    const settings = await this.settingsService.load();

    // Run under the PRD mutation lock (the same one PrdService.deletePrd holds) so
    // creation serializes with PRD deletion: a map can't anchor to a PRD a
    // concurrent delete is removing. Inside, serialize on the Story Map key too so
    // two concurrent creates can't pick the same next id.
    return this.prds.withMutationLock(() =>
      this.noteWrites.run(STORY_MAP_MUTATE_KEY, async () => {
        // The product anchor must resolve to a real PRD note — including the root
        // PRD-000 — so the map's product link never dangles (a bare `[[PRD-000]]`
        // rendered before the root exists would stay dangling forever, since no
        // path rewrites the product paragraph later). Checked under the PRD lock,
        // so it can't pass and then be deleted before the write lands.
        const found = await this.prds.findById(product);
        if (!found.ok) return found;
        if (!found.value) {
          return err(
            appError("VALIDATION_FAILED", `Unknown product PRD: ${product}. Create it first.`),
          );
        }

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
          users,
          activities,
          steps,
          slices,
          cards,
          // max+1 (not count) so a value freed by a delete can't collide with a
          // surviving sibling's order.
          displayOrder: existing.value.reduce((m, x) => Math.max(m, x.displayOrder), -1) + 1,
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
      }),
    );
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
      const parsed = parseStoryMapNote(read.value, path);
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
      const folder = parentVaultPath(target.value.path);
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
      // The product anchor must still resolve before we write: a hand-edit to the
      // `product` frontmatter (the supported reassignment path) could point at a
      // non-existent PRD, which we'd otherwise write back as a bare link while the
      // old PRD — no longer referenced — becomes deletable, anchoring the map to
      // nothing. Mirrors the create-time product check.
      const resolvable = await this.requireResolvableProduct(map.product);
      if (!resolvable.ok) return resolvable;
      const read = await this.fs.readFile(map.path);
      if (!read.ok) return read;
      // Resolve BOTH the card Use Cases (grid cells) and the product PRD (body
      // paragraph) so a reassigned product link is refreshed, not just the grid.
      const noteNames = await this.resolveNoteNames(map);
      // Normalize CRLF→LF on the raw content BEFORE parsing/slicing: parseNote
      // returns an LF-normalized body, so subtracting its length from a raw CRLF
      // string would slice mid-body and corrupt the note. Normalizing first keeps
      // the frontmatter boundary aligned with the body parseNote returns.
      const normalized = read.value.replace(/\r\n/g, "\n");
      const { body } = parseNote(normalized);
      const nextBody = refreshManagedBlocks(body, map, noteNames);
      const frontmatter = normalized.slice(0, normalized.length - body.length);
      const written = await this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
      if (!written.ok) return written;
      // Live views refresh on this (the explorer's row count + captured map go
      // stale otherwise after a hand-edit + rebuild).
      await this.publishUpdated(map);
      return ok(undefined);
    });
  }

  /** Publishes `storymap.updated` so live views re-render after a write. */
  private async publishUpdated(map: Pick<StoryMap, "id" | "path">): Promise<void> {
    await this.eventBus.publish(
      createEvent(
        "storymap.updated",
        { storyMapId: map.id, path: String(map.path) },
        { correlationId: map.id },
      ),
    );
  }

  async addCard(id: StoryMapId, card: StoryMapCard): Promise<Result<StoryMap>> {
    return this.mutateCards(id, (cards) => addCardToList(cards, card), {
      validate: (map) => validateCardPlacement(map, card),
    });
  }

  async updateCard(id: StoryMapId, index: number, card: StoryMapCard): Promise<Result<StoryMap>> {
    return this.mutateCards(id, (cards) => updateCardInList(cards, index, card), {
      validate: (map) => validateCardPlacement(map, card),
      requireIndex: index,
    });
  }

  async removeCard(id: StoryMapId, index: number): Promise<Result<StoryMap>> {
    return this.mutateCards(id, (cards) => removeCardFromList(cards, index), {
      requireIndex: index,
    });
  }

  /**
   * The shared card-mutation pipeline: serialize through the SAME mutation key
   * as create/delete/rebuild (so a concurrent delete cannot interleave and
   * resurrect the note), re-read the map under the lock (abort if it was
   * deleted), validate the index/placement, then rewrite ONLY the `cards`
   * frontmatter and the managed grid block — never the hand-written body.
   * CRLF-safe exactly like {@link rebuildGrid}.
   */
  private mutateCards(
    id: StoryMapId,
    transform: (cards: readonly StoryMapCard[]) => StoryMapCard[],
    options: {
      validate?: (map: StoryMap) => string | null;
      requireIndex?: number;
    },
  ): Promise<Result<StoryMap>> {
    return this.noteWrites.run(STORY_MAP_MUTATE_KEY, async () => {
      const found = await this.findById(id);
      if (!found.ok) return found;
      if (!found.value) {
        return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
      }
      const map = found.value;
      const reason = cardMutationError(map, options);
      if (reason !== null) return err(appError("VALIDATION_FAILED", reason));
      // A card write also refreshes the product paragraph, so the anchor must
      // resolve here too (see rebuildGrid) — don't persist a dangling product.
      const resolvable = await this.requireResolvableProduct(map.product);
      if (!resolvable.ok) return resolvable;
      return this.writeCards({ ...map, cards: transform(map.cards) });
    });
  }

  /**
   * Persists the map's new card list: rewrites only the `cards` frontmatter
   * field and regenerates the managed grid block, leaving every other
   * frontmatter field and hand-written body section untouched. CRLF-safe.
   */
  private async writeCards(map: StoryMap): Promise<Result<StoryMap>> {
    const read = await this.fs.readFile(map.path);
    if (!read.ok) return read;
    const noteNames = await this.resolveNoteNames(map);
    // Normalize CRLF→LF before parsing/slicing (see rebuildGrid): parseNote
    // returns an LF body, so the frontmatter/body boundary must be aligned.
    const normalized = read.value.replace(/\r\n/g, "\n");
    const withCards = updateNoteFrontmatter(normalized, {
      cards: map.cards.length > 0 ? map.cards.map(encodeCard) : undefined,
    });
    const { body } = parseNote(withCards);
    const nextBody = refreshManagedBlocks(body, map, noteNames);
    const frontmatter = withCards.slice(0, withCards.length - body.length);
    const written = await this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
    if (!written.ok) return written;
    // Notify live views (the explorer's row counts + captured map go stale
    // otherwise) that this map's cards changed.
    await this.publishUpdated(map);
    return ok(map);
  }

  /**
   * Confirms the map's product PRD still resolves to a real note before a write.
   * The supported reassignment path is a hand-edit to the `product` frontmatter +
   * rebuild; a typo (e.g. `PRD-999`) would otherwise be written back as a bare
   * product link while the old PRD becomes deletable, leaving the map anchored to
   * nothing. Same rule the create path enforces up front.
   */
  private async requireResolvableProduct(product: string): Promise<Result<void>> {
    const found = await this.prds.findById(product);
    if (!found.ok) return found;
    if (!found.value) {
      return err(
        appError("VALIDATION_FAILED", `Unknown product PRD: ${product}. Create it first.`),
      );
    }
    return ok(undefined);
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
    const names = await this.resolveUseCaseNoteNames(cardRefs(map.cards));
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
}

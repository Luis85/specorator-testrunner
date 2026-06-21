import {
  buildStoryMapNote,
  parseStoryMapNote,
  renderProductParagraph,
  renderStoryMapGridTable,
  replaceGridBlock,
  replaceProductBlock,
  replaceStoryMapHeading,
  storyMapFolderName,
} from "../content/story-map-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import {
  cardSignature,
  encodeStep,
  isStoryMapStatus,
  normalizeLabels,
  normalizeSteps,
  STORY_MAP_DEFAULT_PRODUCT,
  storyMapSignature,
  type StoryMap,
  type StoryMapCard,
  type StoryMapId,
  type StoryMapStatus,
  type StoryMapStep,
} from "../../domain/entities/story-map";
import { loadCards, reconcileCards, reloadCards } from "./story-map-cards-store";
import type { PersonaService } from "./persona-service";
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
   * Regenerates the note's managed grid block from its (authoritative) cards —
   * composed from the per-card notes under `cards/` — resolving each `UC-NNN` to
   * its real note name. Use after hand-editing a card note so the rendered table
   * matches the data.
   */
  rebuildGrid(id: StoryMapId): Promise<Result<void>>;
  /**
   * Authoring without hand-editing: add a rich card to the map, validating its
   * placement, persisting it as its own note under `cards/`, and regenerating the
   * managed grid block. Returns the updated map.
   */
  addCard(id: StoryMapId, card: StoryMapCard): Promise<Result<StoryMap>>;
  /**
   * Replaces the card at `index` (out-of-range → VALIDATION_FAILED). `expected`
   * is the {@link cardSignature} of the card the caller believes is at `index`;
   * when given, the update is rejected if the on-disk card there has since changed
   * (so a stale row can't overwrite a different card).
   */
  updateCard(
    id: StoryMapId,
    index: number,
    card: StoryMapCard,
    expected?: string,
  ): Promise<Result<StoryMap>>;
  /** Removes the card at `index` (out-of-range → VALIDATION_FAILED). `expected` guards a stale row (see {@link updateCard}). */
  removeCard(id: StoryMapId, index: number, expected?: string): Promise<Result<StoryMap>>;
  /**
   * Persists an externally-mutated model (the board's working copy): rewrites the
   * structure (users/activities/steps/slices) frontmatter, reconciles the cards
   * into their per-card notes under `cards/`, and regenerates the managed blocks
   * under the mutation lock, after normalizing and validating every card against
   * the new axes and the product anchor. Publishes
   * `storymap.updated` carrying `origin` so the caller can skip the reload it
   * caused. `expected` is the {@link storyMapSignature} the board loaded; when
   * given, the save is rejected if the on-disk structure has since changed
   * (optimistic concurrency), so a stale board can't overwrite edits another
   * surface made. Returns the persisted map.
   */
  saveMap(
    id: StoryMapId,
    model: StoryMap,
    origin?: string,
    expected?: string,
  ): Promise<Result<StoryMap>>;
  /**
   * Edits a map's metadata — title, lifecycle status, and/or product anchor —
   * without touching its structure (users/activities/steps/slices) or cards. Each
   * field is optional; an omitted field is left as-is. The title is collapsed to
   * a single line and must be non-blank; the status must be a valid lifecycle
   * value; the resolved product must resolve to a real PRD (same rule as create),
   * checked under the PRD lock. Rewrites the title/status/product frontmatter and
   * refreshes the visible product link + heading. The on-disk folder path stays
   * stable (a map's identity is its id, not its slug). Returns the updated map.
   */
  updateMapMeta(
    id: StoryMapId,
    changes: { title?: string; status?: StoryMapStatus; product?: string },
  ): Promise<Result<StoryMap>>;
}

const STORY_MAP_ID_RE = /^SM-(\d{3,})$/;

/** Single queue key so all Story Map id-allocating mutations serialize. */
const STORY_MAP_MUTATE_KEY = "story-map:mutate";

/**
 * The error when a board's save baseline no longer matches the on-disk map's
 * structure (another surface changed it since the board loaded), or null when the
 * save may proceed. `expected` is the {@link storyMapSignature} the board loaded;
 * undefined opts out (non-board callers). Pure.
 */
const staleSignatureError = (current: StoryMap, expected: string | undefined): string | null => {
  if (expected === undefined) return null;
  return storyMapSignature(current) === expected
    ? null
    : "The Story Map changed elsewhere — reload the board and retry.";
};

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
 * The first reason a card in `cards` is invalid against `axes`, or null when
 * every card is on-map. The shared all-cards placement guard for every write
 * path (create / saveMap / rebuildGrid / card mutations), so a hand-edited
 * off-map card can never ride a "successful" write and then block the board's
 * own saveMap (which validates the whole set). Pure: no I/O.
 */
const invalidCardReason = (
  axes: Pick<StoryMap, "activities" | "slices" | "steps">,
  cards: readonly StoryMapCard[],
): string | null => {
  for (const card of cards) {
    const reason = validateCardPlacement(axes, card);
    if (reason !== null) return reason;
  }
  return null;
};

/**
 * The reason a card mutation must be rejected (out-of-range index or invalid
 * placement), or null when it may proceed. Pure: keeps {@link mutateCards} thin.
 */
const cardMutationError = (
  map: StoryMap,
  options: {
    validate?: (map: StoryMap) => string | null;
    requireIndex?: number;
    expectedCard?: string;
  },
): string | null => {
  const index = options.requireIndex;
  if (index !== undefined && (index < 0 || index >= map.cards.length)) {
    return `Card index ${index} is out of range for ${map.id}.`;
  }
  // Index-level optimistic concurrency: if the caller (e.g. the Cards modal) acts
  // on a row whose card has since changed/moved on disk, the stored index now
  // points at a DIFFERENT card — reject rather than edit/delete the wrong one.
  if (options.expectedCard !== undefined && index !== undefined) {
    if (cardSignature(map.cards[index]) !== options.expectedCard) {
      return "That card changed elsewhere — reopen the cards list and retry.";
    }
  }
  return options.validate?.(map) ?? null;
};

/**
 * Validates + normalizes a metadata change against the on-disk map: returns the
 * first rejection reason, or the resolved {title,status,product} to persist plus
 * whether the title (and thus the heading) changed. Pure: no I/O.
 */
const resolveMetaChange = (
  map: StoryMap,
  changes: { title?: string; status?: StoryMapStatus; product?: string },
):
  | { error: string }
  | { title: string; status: StoryMapStatus; product: string; titleChanged: boolean } => {
  const title = changes.title !== undefined ? changes.title.replace(/\s+/g, " ").trim() : map.title;
  if (title === "") return { error: "A Story Map title is required." };
  const status = changes.status ?? map.status;
  if (!isStoryMapStatus(status)) return { error: `Unknown Story Map status: ${String(status)}.` };
  const trimmedProduct = changes.product?.trim();
  const product =
    trimmedProduct !== undefined && trimmedProduct !== "" ? trimmedProduct : map.product;
  return { title, status, product, titleChanged: title !== map.title };
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
    private readonly personaService: Pick<PersonaService, "findOrCreateByName">,
  ) {}

  /**
   * Best-effort: ensure a shared persona note exists for each user name (ADR-0030).
   * A persona write failure is logged, not fatal — the map is the primary artifact.
   */
  private async ensurePersonas(users: readonly string[]): Promise<void> {
    for (const name of users) {
      const r = await this.personaService.findOrCreateByName(name);
      if (!r.ok)
        this.logger.warn("Could not materialize persona", { name, error: r.error.message });
    }
  }

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
    const cardReason = invalidCardReason({ activities, slices, steps }, cards);
    if (cardReason !== null) return err(appError("VALIDATION_FAILED", cardReason));

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

        // Persist any initial cards as their own notes under `cards/` (ADR-0030),
        // then compose them back so the returned map carries their allocated ids.
        if (cards.length > 0) {
          const cardsDir = this.cardsDirOf(map);
          // Capture whether cards/ pre-existed BEFORE reconcile may create it, so a
          // rollback only removes the folder this attempt made (never a pre-existing
          // cards/ holding unrelated notes).
          const cardsDirPreexisted = await this.fs.exists(cardsDir);
          const reconciled = await reconcileCards(
            this.fs,
            this.noteWrites,
            cardsDir,
            id,
            cards,
            [],
          );
          if (!reconciled.ok) {
            await this.rollbackFailedCreate(
              path,
              folderPath,
              cardsDir,
              id,
              folderPreexisted,
              cardsDirPreexisted,
            );
            return reconciled;
          }
          map.cards = await loadCards(this.fs, cardsDir, id);
        }

        // Materialize a shared persona note per user name (best-effort; ADR-0030).
        await this.ensurePersonas(users);

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
      if (!parsed) continue;
      // Cards live as their own notes under the map's `cards/` folder (ADR-0030):
      // compose them into the read model (best-effort — a missing folder is []).
      parsed.cards = await loadCards(this.fs, this.cardsDirOf(parsed), parsed.id);
      maps.push(parsed);
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

      // Delete the map note; the per-card notes under cards/ are generated, not
      // user attachments, so remove them too — otherwise orphaned card notes linger
      // and a future map reusing this id/path would silently re-adopt them via
      // loadCards. Any OTHER sibling attachments (diagrams, etc.) are preserved.
      const mapNote = target.value;
      const folder = parentVaultPath(mapNote.path);
      const deleted = await this.fs.deleteFile(mapNote.path);
      if (!deleted.ok) return deleted;
      const cleaned = await this.cleanupCardNotes(folder, mapNote.path, this.cardsDirOf(mapNote));
      if (!cleaned.ok) return cleaned;
      const preservedFiles = cleaned.value;

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

  /**
   * After the map note is deleted, removes the generated per-card notes under
   * `cards/` and returns the count of OTHER siblings left (user attachments like
   * diagrams). A missing/unreadable folder reports zero preserved. The card notes
   * are generated, so deleting them stops a future map that reuses this path from
   * silently re-adopting them via {@link loadCards}.
   */
  private async cleanupCardNotes(
    folder: VaultPath,
    mapNotePath: VaultPath,
    cardsDir: VaultPath,
  ): Promise<Result<number>> {
    const cardsPrefix = `${String(cardsDir)}/`;
    const listed = await this.fs.listFilesRecursive(folder);
    if (!listed.ok) {
      // A missing folder means nothing to clean (report zero preserved); a real
      // I/O error must fail CLOSED — reporting success here would leave generated
      // card notes behind for a future map reusing this id/path to re-adopt.
      const msg = listed.error.message.toLowerCase();
      if (msg.includes("enoent") || msg.includes("not found")) return ok(0);
      return listed;
    }
    let preserved = 0;
    for (const sibling of listed.value) {
      if (sibling === mapNotePath) continue;
      if (!String(sibling).startsWith(cardsPrefix)) {
        preserved++;
        continue;
      }
      const removed = await this.fs.deleteFile(sibling);
      if (!removed.ok) return removed;
    }
    return ok(preserved);
  }

  /**
   * Undoes a partially-created map after an initial-card write fails: the map note
   * was already written, so leaving it would index a Story Map the caller was told
   * failed to create. When THIS call created the map folder, dropping the folder
   * removes the note and any partial card notes at once; otherwise (a pre-existing
   * folder, e.g. attachments left by a prior map that reused this path) remove just
   * the note and the card notes this call wrote, preserving the rest.
   *
   * `cardsDirPreexisted` guards the cards/ subfolder: when this attempt created it,
   * dropping it whole is safe; when it was already there (unrelated card notes or
   * user files), recursively deleting it would destroy data this attempt never
   * wrote — so instead delete only the notes THIS attempt wrote. Those carry
   * `map: <mapId>` with the freshly-minted id no pre-existing note can hold, so
   * `loadCards(…, mapId)` selects exactly them (and yields each note's actual
   * path, even if reconcile wrote it before a later card failed).
   */
  private async rollbackFailedCreate(
    notePath: VaultPath,
    folderPath: VaultPath,
    cardsDir: VaultPath,
    mapId: string,
    folderPreexisted: boolean,
    cardsDirPreexisted: boolean,
  ): Promise<void> {
    if (!folderPreexisted) {
      await this.fs.deleteFolder(folderPath);
      return;
    }
    await this.fs.deleteFile(notePath);
    if (!cardsDirPreexisted) {
      // This attempt created cards/: drop it whole.
      if (await this.fs.exists(cardsDir)) await this.fs.deleteFolder(cardsDir);
      return;
    }
    // Pre-existing cards/: delete only this attempt's notes, leaving the rest.
    const ours = await loadCards(this.fs, cardsDir, mapId);
    for (const card of ours) {
      if (card.notePath !== undefined) await this.fs.deleteFile(card.notePath);
    }
  }

  async rebuildGrid(id: StoryMapId): Promise<Result<void>> {
    // Serialize through the SAME locks as create/delete: a concurrent
    // deleteStoryMap must not interleave, or this write could recreate a note
    // the delete just removed (writeFile recreates missing files). The note is
    // re-read inside the lock, so a delete that won the lock leaves findById
    // returning null here and we abort rather than resurrect it. The PRD lock
    // (via withProductSafeWrite) also serializes the product re-check + write
    // against deletePrd so the rebuilt note can't anchor to a deleted PRD.
    return this.withProductSafeWrite(async () => {
      const found = await this.findById(id);
      if (!found.ok) return found;
      if (!found.value) {
        return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
      }
      const map = found.value;
      // A hand-edit to the `cards` frontmatter could place a card off the map's
      // axes; buildStoryMapGrid would silently drop it from the grid while it
      // lingers in `cards`, and the next board saveMap (which validates every
      // card) would then reject ALL edits over that invisible bad row. Validate
      // here so the rebuild reports the offending card now, keeping stored cards
      // consistent with what create/saveMap accept.
      const cardReason = invalidCardReason(map, map.cards);
      if (cardReason !== null) return err(appError("VALIDATION_FAILED", cardReason));
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
  private async publishUpdated(map: Pick<StoryMap, "id" | "path">, origin?: string): Promise<void> {
    await this.eventBus.publish(
      createEvent(
        "storymap.updated",
        { storyMapId: map.id, path: String(map.path), ...(origin !== undefined ? { origin } : {}) },
        { correlationId: map.id },
      ),
    );
  }

  /**
   * Runs a product-rewriting write under BOTH the PRD mutation lock (OUTER) and
   * the Story Map mutation key (INNER) — the SAME nesting `create()` uses. The
   * PRD lock serializes the in-callback `requireResolvableProduct` check + write
   * against `PrdService.deletePrd` (which holds that lock and refuses to delete a
   * PRD with linked maps), so a reassigned/rebuilt map can't be written back with
   * a product anchor that a concurrent delete is removing. The lock order is fixed
   * (PRD outer, Story Map inner) everywhere both are held, so there is no inversion;
   * `prds.findById` is lock-free (create calls it inside this same lock), so the
   * nested `requireResolvableProduct` cannot re-enter the PRD queue.
   */
  private withProductSafeWrite<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    return this.prds.withMutationLock(() => this.noteWrites.run(STORY_MAP_MUTATE_KEY, operation));
  }

  async addCard(id: StoryMapId, card: StoryMapCard): Promise<Result<StoryMap>> {
    return this.mutateCards(id, (cards) => addCardToList(cards, card), {
      validate: (map) => validateCardPlacement(map, card),
    });
  }

  async updateCard(
    id: StoryMapId,
    index: number,
    card: StoryMapCard,
    expected?: string,
  ): Promise<Result<StoryMap>> {
    return this.mutateCards(
      id,
      (cards) => {
        // Update is identity-preserving: keep the on-disk card's id (and cell
        // order) so a caller passing only editable fields (e.g. the edit modal,
        // whose form omits them) can't make reconcileCards orphan the original
        // note — allocating a new SMC id and dropping its hand-written body.
        const current = cards[index];
        const merged = current ? { ...card, id: current.id, order: current.order } : card;
        return updateCardInList(cards, index, merged);
      },
      {
        validate: (map) => validateCardPlacement(map, card),
        requireIndex: index,
        expectedCard: expected,
      },
    );
  }

  async removeCard(id: StoryMapId, index: number, expected?: string): Promise<Result<StoryMap>> {
    return this.mutateCards(id, (cards) => removeCardFromList(cards, index), {
      requireIndex: index,
      expectedCard: expected,
    });
  }

  /**
   * The shared card-mutation pipeline: serialize through the SAME mutation key
   * as create/delete/rebuild (so a concurrent delete cannot interleave and
   * resurrect the note), re-read the map (with its composed cards) under the
   * lock (abort if it was deleted), validate the index/placement, reconcile the
   * per-card notes under `cards/`, then regenerate the managed grid block —
   * never the hand-written body. CRLF-safe exactly like {@link rebuildGrid}.
   */
  private mutateCards(
    id: StoryMapId,
    transform: (cards: readonly StoryMapCard[]) => StoryMapCard[],
    options: {
      validate?: (map: StoryMap) => string | null;
      requireIndex?: number;
      expectedCard?: string;
    },
  ): Promise<Result<StoryMap>> {
    return this.withProductSafeWrite(async () => {
      const found = await this.findById(id);
      if (!found.ok) return found;
      if (!found.value) {
        return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
      }
      const map = found.value;
      const reason = cardMutationError(map, options);
      if (reason !== null) return err(appError("VALIDATION_FAILED", reason));
      // Validate the FULL post-transform list, not just the card being added/
      // updated: a pre-existing hand-edited off-map card would otherwise ride this
      // "successful" write and then block every later board saveMap. Validating
      // the RESULT means removing the offending card (which drops it from the
      // list) is still allowed — only writes that leave a bad card are rejected.
      const nextCards = transform(map.cards);
      const cardReason = invalidCardReason(map, nextCards);
      if (cardReason !== null) return err(appError("VALIDATION_FAILED", cardReason));
      // A card write also refreshes the product paragraph, so the anchor must
      // resolve here too (see rebuildGrid) — don't persist a dangling product.
      const resolvable = await this.requireResolvableProduct(map.product);
      if (!resolvable.ok) return resolvable;
      return this.writeCards(map, nextCards);
    });
  }

  /**
   * Persists the map's new card list: reconciles the per-card notes under
   * `cards/` (writing/deleting card notes, preserving bodies) and regenerates
   * the managed grid block from the new cards, leaving the map note's
   * frontmatter and hand-written body otherwise untouched. CRLF-safe. Returns
   * the map with its cards re-composed (so allocated ids are reflected).
   */
  private async writeCards(
    map: StoryMap,
    nextCards: StoryMapCard[],
    origin?: string,
  ): Promise<Result<StoryMap>> {
    const cardsDir = this.cardsDirOf(map);
    const reconciled = await reconcileCards(
      this.fs,
      this.noteWrites,
      cardsDir,
      map.id,
      nextCards,
      map.cards,
    );
    if (!reconciled.ok) return reconciled;
    // Fail closed: the notes are on disk now, so a transient reload failure must
    // abort rather than regenerate the grid (and republish the board) without them.
    const reloaded = await reloadCards(this.fs, cardsDir, map.id);
    if (!reloaded.ok) return reloaded;
    const composed = { ...map, cards: reloaded.value };
    const read = await this.fs.readFile(map.path);
    if (!read.ok) return read;
    const noteNames = await this.resolveNoteNames(composed);
    // Normalize CRLF→LF before parsing/slicing (see rebuildGrid): parseNote
    // returns an LF body, so the frontmatter/body boundary must be aligned.
    const normalized = read.value.replace(/\r\n/g, "\n");
    const { body } = parseNote(normalized);
    const nextBody = refreshManagedBlocks(body, composed, noteNames);
    const frontmatter = normalized.slice(0, normalized.length - body.length);
    const written = await this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
    if (!written.ok) return written;
    // Notify live views (the explorer's row counts + captured map go stale
    // otherwise) that this map's cards changed.
    await this.publishUpdated(composed, origin);
    return ok(composed);
  }

  async saveMap(
    id: StoryMapId,
    model: StoryMap,
    origin?: string,
    expected?: string,
  ): Promise<Result<StoryMap>> {
    return this.withProductSafeWrite(async () => {
      const found = await this.findById(id);
      if (!found.ok) return found;
      if (!found.value) {
        return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
      }
      const onDisk = found.value;
      // Optimistic concurrency: reject if the on-disk structure changed since the
      // board loaded, rather than overwrite those edits with the board's stale copy.
      const stale = staleSignatureError(onDisk, expected);
      if (stale !== null) return err(appError("VALIDATION_FAILED", stale));

      // Normalize the board's structure exactly like create(), so a board (or
      // hand) edit can't persist duplicate/blank axes, then validate every card
      // against the NEW axes (the board may have reordered them).
      const activities = normalizeLabels(model.activities);
      if (activities.length === 0) {
        return err(appError("VALIDATION_FAILED", "A Story Map needs at least one activity."));
      }
      const slices = normalizeLabels(model.slices);
      if (slices.length === 0) {
        return err(appError("VALIDATION_FAILED", "A Story Map needs at least one release slice."));
      }
      const users = normalizeLabels(model.users);
      const steps = normalizeSteps(model.steps, activities);
      const cardReason = invalidCardReason({ activities, slices, steps }, model.cards);
      if (cardReason !== null) return err(appError("VALIDATION_FAILED", cardReason));
      const resolvable = await this.requireResolvableProduct(onDisk.product);
      if (!resolvable.ok) return resolvable;

      // Reconcile the board's cards into the per-card notes under `cards/`
      // (ADR-0030) before writing the map note: the map note carries no cards
      // frontmatter, only the grid rendered from the composed cards.
      const cardsDir = this.cardsDirOf(onDisk);
      const reconciled = await reconcileCards(
        this.fs,
        this.noteWrites,
        cardsDir,
        id,
        model.cards,
        onDisk.cards,
      );
      if (!reconciled.ok) return reconciled;
      // Fail closed (see writeCards): a transient reload failure after the notes
      // are on disk must abort, not persist a grid that silently drops cards.
      const reloaded = await reloadCards(this.fs, cardsDir, id);
      if (!reloaded.ok) return reloaded;
      const cards = reloaded.value;

      // Materialize a shared persona note per (normalized) user name (best-effort;
      // ADR-0030) so a user added via the board becomes its own note too.
      await this.ensurePersonas(users);

      // Persist the on-disk identity (id/path/product/displayOrder) with the
      // board's normalized structure and the re-composed cards.
      return this.writeMap({ ...onDisk, users, activities, steps, slices, cards }, origin);
    });
  }

  async updateMapMeta(
    id: StoryMapId,
    changes: { title?: string; status?: StoryMapStatus; product?: string },
  ): Promise<Result<StoryMap>> {
    return this.withProductSafeWrite(async () => {
      const found = await this.findById(id);
      if (!found.ok) return found;
      if (!found.value) {
        return err(appError("VALIDATION_FAILED", `Story Map ${id} was not found.`));
      }
      const map = found.value;
      const resolved = resolveMetaChange(map, changes);
      if ("error" in resolved) return err(appError("VALIDATION_FAILED", resolved.error));
      // The product anchor must resolve before we write (mirrors create/rebuildGrid):
      // never persist a map pointing at a non-existent PRD. Checked under the PRD lock.
      const resolvable = await this.requireResolvableProduct(resolved.product);
      if (!resolvable.ok) return resolvable;
      return this.writeMeta(
        { ...map, title: resolved.title, status: resolved.status, product: resolved.product },
        resolved.titleChanged,
      );
    });
  }

  /**
   * Persists the structural axes (users/activities/steps/slices) frontmatter and
   * regenerates the managed blocks (the grid from the composed cards), leaving
   * id/product/hand-written body untouched. Cards are NOT in the frontmatter —
   * they live as their own notes (reconciled by the caller). CRLF-safe. Publishes
   * `storymap.updated` with `origin`.
   */
  private async writeMap(map: StoryMap, origin?: string): Promise<Result<StoryMap>> {
    const read = await this.fs.readFile(map.path);
    if (!read.ok) return read;
    const noteNames = await this.resolveNoteNames(map);
    const normalized = read.value.replace(/\r\n/g, "\n");
    const updated = updateNoteFrontmatter(normalized, {
      users: map.users.length > 0 ? map.users : undefined,
      activities: map.activities.length > 0 ? map.activities : undefined,
      steps: map.steps.length > 0 ? map.steps.map(encodeStep) : undefined,
      slices: map.slices.length > 0 ? map.slices : undefined,
    });
    const { body } = parseNote(updated);
    const nextBody = refreshManagedBlocks(body, map, noteNames);
    const frontmatter = updated.slice(0, updated.length - body.length);
    const written = await this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
    if (!written.ok) return written;
    await this.publishUpdated(map, origin);
    return ok(map);
  }

  /**
   * Persists the title/status/product frontmatter and refreshes the managed
   * blocks (so a reassigned product link updates in the body) plus the title
   * heading when the title changed, leaving structure/hand-written body untouched.
   * CRLF-safe, mirrors {@link writeMap}. Publishes `storymap.updated`.
   */
  private async writeMeta(map: StoryMap, titleChanged: boolean): Promise<Result<StoryMap>> {
    // Mirror the rebuild/board/card writes: never regenerate the managed grid from
    // an off-map card. A hand-edited card that still parses but points at an unknown
    // activity/step/slice would be dropped from the visible grid yet left in the
    // `cards` frontmatter, so the next board edit keeps failing on the now-hidden
    // bad card. Reject the metadata save before refreshing the managed blocks.
    const cardReason = invalidCardReason(map, map.cards);
    if (cardReason !== null) return err(appError("VALIDATION_FAILED", cardReason));
    const read = await this.fs.readFile(map.path);
    if (!read.ok) return read;
    const noteNames = await this.resolveNoteNames(map);
    const normalized = read.value.replace(/\r\n/g, "\n");
    const updated = updateNoteFrontmatter(normalized, {
      title: map.title,
      status: map.status,
      product: map.product,
    });
    const { body } = parseNote(updated);
    const refreshed = refreshManagedBlocks(body, map, noteNames);
    const nextBody = titleChanged
      ? replaceStoryMapHeading(refreshed, map.id, map.title)
      : refreshed;
    const frontmatter = updated.slice(0, updated.length - body.length);
    const written = await this.fs.writeFile(map.path, `${frontmatter}${nextBody}`);
    if (!written.ok) return written;
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

  /** The `cards/` folder for a map: a sibling of the map note (ADR-0030). */
  private cardsDirOf(map: Pick<StoryMap, "path">): VaultPath {
    return joinVaultPath(parentVaultPath(map.path), "cards");
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

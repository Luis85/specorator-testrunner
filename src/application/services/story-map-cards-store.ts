import { buildCardNote, cardFileName, parseCardNote } from "../content/story-map-card-content";
import { collectReadableMarkdown } from "./markdown-notes";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { StoryMapCard } from "../../domain/entities/story-map";
import {
  isStoryMapCardId,
  nextStoryMapCardId,
  type StoryMapCardId,
  type StoryMapCardNote,
} from "../../domain/entities/story-map-card";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";
import { KeyedSerialQueue } from "../../shared/async/serial-queue";
import { joinVaultPath } from "../../shared/utils/vault-path";

/**
 * Per-card store backing a Story Map's `cards/` folder (ADR-0030). Each card is
 * its own note so its hand-written body survives a board save (which carries no
 * body). `loadCards` reads the folder into the board's in-memory model;
 * `reconcileCards` writes that model back, preserving every note's body.
 */

/** The cell a card sits in — its `activity` + `step` + `slice` triple. */
const cellKey = (card: Pick<StoryMapCard, "activity" | "step" | "slice">): string =>
  `${card.activity}\u0000${card.step ?? ""}\u0000${card.slice}`;

/**
 * Stable global ordering: by cell, then ascending `order` within the cell, ties
 * broken by id. Sorting on `(activity, step, slice, order, id)` realizes the
 * per-cell ascending-order contract over a flat list.
 */
const byCellThenOrder = (a: StoryMapCard, b: StoryMapCard): number =>
  a.activity.localeCompare(b.activity) ||
  (a.step ?? "").localeCompare(b.step ?? "") ||
  a.slice.localeCompare(b.slice) ||
  (a.order ?? 0) - (b.order ?? 0) ||
  (a.id ?? "").localeCompare(b.id ?? "");

/**
 * Projects a persisted card-note to the board's placement model (drops body/map).
 * Retains `notePath` so reconcile can delete/migrate the note at its actual path —
 * a user may have renamed it away from the canonical `cards/<id>.md`.
 */
const noteToCard = (note: StoryMapCardNote): StoryMapCard => ({
  id: note.id,
  cardType: note.cardType,
  order: note.order,
  ref: note.ref,
  status: note.status,
  points: note.points,
  tags: note.tags,
  color: note.color,
  activity: note.activity,
  step: note.step,
  slice: note.slice,
  title: note.title,
  notePath: note.path,
});

/**
 * Reads every card-note under `cardsDir` belonging to `mapId` into the board's
 * placement model, sorted so each cell's cards are in ascending `order`.
 *
 * Best-effort, mirroring `StoryMapService.findAll`: a missing `cards/` folder
 * (or any list/read failure) yields `[]` rather than an error.
 */
export const loadCards = async (
  fs: VaultFileSystem,
  cardsDir: VaultPath,
  mapId: string,
): Promise<StoryMapCard[]> => {
  const listed = await fs.listFilesRecursive(cardsDir);
  if (!listed.ok) return []; // no cards folder yet, or unreadable — best-effort read
  const notes = await collectReadableMarkdown(
    fs,
    listed.value,
    (path, content) => parseCardNote(content, path) ?? undefined,
  );
  return notes
    .filter((note) => note.map === mapId) // defensive against stray notes
    .map(noteToCard)
    .sort(byCellThenOrder);
};

/**
 * Reloads the cards under `cardsDir` for a WRITE path — fails closed. Unlike
 * {@link loadCards} (best-effort, for reads), a list or per-note read failure is
 * an error here, not an empty/partial list: after a successful `reconcileCards`
 * the notes are safely on disk, so a transient vault I/O or indexing failure must
 * abort the write rather than regenerate the managed grid (and republish the live
 * board) from a model that silently drops cards. A genuinely-missing `cards/`
 * folder is the one benign case (the map legitimately has no cards) → ok([]).
 */
export const reloadCards = async (
  fs: VaultFileSystem,
  cardsDir: VaultPath,
  mapId: string,
): Promise<Result<StoryMapCard[]>> => {
  const listed = await fs.listFilesRecursive(cardsDir);
  if (!listed.ok) {
    return listed.error.code === "RUNNER_MISSING_FILE" ? ok([]) : err(listed.error);
  }
  const cards: StoryMapCard[] = [];
  for (const path of listed.value) {
    if (!path.endsWith(".md")) continue;
    const read = await fs.readFile(path);
    if (!read.ok) return err(read.error);
    const note = parseCardNote(read.value, path);
    if (note?.map === mapId) cards.push(noteToCard(note));
  }
  return ok(cards.sort(byCellThenOrder));
};

/** A model card resolved to a concrete id + its 0-based index within its cell. */
interface DesiredCard {
  card: StoryMapCard;
  id: StoryMapCardId;
  order: number;
}

/**
 * The `SMC-NNN` ids occupied by files already under `cards/`, keyed by FILENAME
 * (not parsed content) so a file that doesn't load as one of THIS map's cards — a
 * hand-edited `id` typo, or a note from a prior map that reused the folder — still
 * reserves its name and can't be silently overwritten by a freshly-allocated id.
 */
const occupiedCardIds = (paths: readonly VaultPath[]): StoryMapCardId[] => {
  const ids: StoryMapCardId[] = [];
  for (const p of paths) {
    const base = String(p).split("/").pop()?.replace(/\.md$/, "");
    if (base !== undefined && isStoryMapCardId(base)) ids.push(base);
  }
  return ids;
};

/**
 * Assigns an id to every model card lacking a well-formed `SMC-NNN` one,
 * advancing the allocation seed as it goes so two new cards in a single call get
 * distinct ids. Seeded with the `existing` (on-disk) ids, every valid id the model
 * already carries, AND `reserved` (ids occupied by files on disk), so a
 * freshly-minted id can never collide with a preassigned one OR overwrite an
 * existing — possibly unparsable — file.
 *
 * A card's id becomes its note's file name (`cards/<id>.md`). A caller-supplied
 * id is therefore validated here — the filesystem boundary — not trusted: a
 * malformed id (a `/` would write a nested orphan that fails to parse back; a
 * `..` would throw out of `joinVaultPath` across the Result-returning service
 * boundary) is discarded and a fresh id allocated, mirroring how the parser drops
 * a disk note with a malformed id rather than crashing. A DUPLICATE valid id (two
 * model cards claiming the same `SMC-NNN`) is likewise reallocated for the later
 * card so the two never write to — and clobber — the same note.
 */
const allocateIds = (
  model: StoryMapCard[],
  existing: StoryMapCard[],
  reserved: readonly StoryMapCardId[] = [],
): { card: StoryMapCard; id: StoryMapCardId }[] => {
  const validIds = (cards: StoryMapCard[]): StoryMapCardId[] =>
    cards.map((c) => c.id).filter((id): id is StoryMapCardId => isStoryMapCardId(id));
  const seed: { id: StoryMapCardId }[] = [
    ...validIds(existing),
    ...validIds(model),
    ...reserved,
  ].map((id) => ({ id }));
  const used = new Set<StoryMapCardId>();
  return model.map((card) => {
    // Claim a valid, not-yet-taken preassigned id; otherwise mint a fresh one
    // (covers id-less, malformed-id, and duplicate-preassigned-id cards).
    if (isStoryMapCardId(card.id) && !used.has(card.id)) {
      used.add(card.id);
      return { card, id: card.id };
    }
    const id = nextStoryMapCardId(seed);
    seed.push({ id }); // advance the seed so the next minted id differs
    used.add(id);
    return { card, id };
  });
};

/**
 * Computes each desired card's 0-based `order` within its cell, preserving the
 * model's array order as the in-cell sequence.
 */
const withCellOrder = (allocated: { card: StoryMapCard; id: StoryMapCardId }[]): DesiredCard[] => {
  const cursor = new Map<string, number>();
  return allocated.map(({ card, id }) => {
    const key = cellKey(card);
    const order = cursor.get(key) ?? 0;
    cursor.set(key, order + 1);
    return { card, id, order };
  });
};

/**
 * The body to carry onto the note about to be written at `path`. Fails closed —
 * so `upsertCard` aborts instead of silently destroying data — when an EXISTING
 * file is (a) unreadable (transient I/O), or (b) NOT one of THIS map's card notes
 * (an unparsable file, or a note from another map occupying the path): blanking
 * its body and overwriting would erase a file this card has no claim to. The
 * benign cases — no file yet, or a genuine update of this map's own note — return
 * `ok("")` / the preserved body.
 */
const readBody = async (
  fs: VaultFileSystem,
  existed: boolean,
  mapId: string,
  path: VaultPath,
): Promise<Result<string>> => {
  if (!existed) return ok("");
  const read = await fs.readFile(path);
  if (!read.ok) return err(read.error);
  const note = parseCardNote(read.value, path);
  if (note?.map !== mapId) {
    return err(
      appError("VALIDATION_FAILED", `Refusing to overwrite ${path}: not a ${mapId} card note.`),
    );
  }
  return ok(note.body);
};

/**
 * Writes one desired card-note, preserving any hand-written body already on
 * disk. Returns the write `Result` (the first failure is propagated by the
 * caller).
 */
const upsertCard = async (
  fs: VaultFileSystem,
  mapId: string,
  desired: DesiredCard,
  path: VaultPath,
): Promise<Result<void>> => {
  const { card, id, order } = desired;
  const existed = await fs.exists(path);
  const body = await readBody(fs, existed, mapId, path);
  if (!body.ok) return body;
  const content = buildCardNote({
    id,
    map: mapId,
    cardType: card.cardType ?? "task",
    ref: card.ref,
    status: card.status,
    points: card.points,
    tags: card.tags,
    color: card.color,
    activity: card.activity,
    step: card.step,
    slice: card.slice,
    order,
    title: card.title,
    body: body.value,
    path,
  });
  return existed ? fs.writeFile(path, content) : fs.createFile(path, content);
};

/**
 * Indexes existing cards by id → the actual path each note was loaded from. That
 * path is NOT the canonical cards/<id>.md when the user renamed the note in
 * Obsidian (loadCards keys by the note's id/map frontmatter, not its filename).
 */
const existingPaths = (existing: StoryMapCard[]): Map<StoryMapCardId, VaultPath> => {
  const byId = new Map<StoryMapCardId, VaultPath>();
  for (const card of existing) {
    if (card.id !== undefined && card.notePath !== undefined) byId.set(card.id, card.notePath);
  }
  return byId;
};

/**
 * A card's write/delete target: its loaded note path when known (so a renamed
 * note is migrated/removed in place, never duplicated or leaked), else the
 * canonical cards/<id>.md.
 */
const cardPath = (
  id: StoryMapCardId,
  paths: Map<StoryMapCardId, VaultPath>,
  cardsDir: VaultPath,
): VaultPath => paths.get(id) ?? joinVaultPath(cardsDir, cardFileName(id));

/** Upserts every desired note (body-preserving), serialized per path. Returns the
 *  set of paths actually written, so the delete pass can spare exactly them. */
const writeDesiredCards = async (
  fs: VaultFileSystem,
  queue: KeyedSerialQueue,
  mapId: string,
  desired: DesiredCard[],
  paths: Map<StoryMapCardId, VaultPath>,
  cardsDir: VaultPath,
): Promise<Result<Set<string>>> => {
  const writtenPaths = new Set<string>();
  for (const card of desired) {
    const path = cardPath(card.id, paths, cardsDir);
    const written = await queue.run(String(path), () => upsertCard(fs, mapId, card, path));
    if (!written.ok) return written;
    writtenPaths.add(String(path));
  }
  return ok(writtenPaths);
};

/**
 * Deletes every existing note whose path was NOT (re)written this reconcile,
 * keyed by each note's OWN path — not the id→path map, which collapses two files
 * that share an `SMC-*` id (a user-duplicated or hand-edited note) to one entry.
 * Going per-occurrence means dropping one of two same-id cards from the board
 * deletes that file instead of skipping both (which left the duplicate to
 * reappear on the next reload).
 */
const deleteRemovedCards = async (
  fs: VaultFileSystem,
  queue: KeyedSerialQueue,
  existing: StoryMapCard[],
  writtenPaths: Set<string>,
  cardsDir: VaultPath,
): Promise<Result<void>> => {
  for (const card of existing) {
    if (card.id === undefined) continue;
    const path = card.notePath ?? joinVaultPath(cardsDir, cardFileName(card.id));
    if (writtenPaths.has(String(path))) continue; // this path was just (re)written — keep it
    const deleted = await queue.run(String(path), () => fs.deleteFile(path));
    if (!deleted.ok) return deleted;
  }
  return ok(undefined);
};

/**
 * Reconciles the on-disk card-notes under `cardsDir` to match `model`: allocates
 * ids, recomputes per-cell `order`, upserts each desired note (preserving its
 * body), and deletes the notes of `existing` cards no longer in the model. All
 * per-note IO is serialized per path through `queue`. The first IO error is
 * returned.
 */
export const reconcileCards = async (
  fs: VaultFileSystem,
  queue: KeyedSerialQueue,
  cardsDir: VaultPath,
  mapId: string,
  model: StoryMapCard[],
  existing: StoryMapCard[],
): Promise<Result<void>> => {
  // Reserve every id whose file already occupies cards/ so a newly-minted id can
  // never overwrite a pre-existing (possibly unparsable / foreign) note. Fail closed
  // on a real list error BEFORE allocating/writing — otherwise we'd write partial
  // card notes and only fail later at reloadCards, leaving side effects from an
  // operation reported as failed. A genuinely-missing folder is benign (none yet).
  const listed = await fs.listFilesRecursive(cardsDir);
  if (!listed.ok && listed.error.code !== "RUNNER_MISSING_FILE") return listed;
  const reserved = listed.ok ? occupiedCardIds(listed.value) : [];
  const desired = withCellOrder(allocateIds(model, existing, reserved));

  if (desired.length > 0 && !(await fs.exists(cardsDir))) {
    const created = await fs.createFolder(cardsDir);
    if (!created.ok) return created;
  }

  const paths = existingPaths(existing);
  const written = await writeDesiredCards(fs, queue, mapId, desired, paths, cardsDir);
  if (!written.ok) return written;

  return deleteRemovedCards(fs, queue, existing, written.value, cardsDir);
};

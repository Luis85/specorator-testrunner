import { buildNote, parseNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import {
  isCardType,
  isStoryMapCardId,
  type StoryMapCardNote,
} from "../../domain/entities/story-map-card";
import { isCardStatus, isValidUseCaseRef } from "../../domain/entities/story-map";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** Stable id-only file name (cards rename often via the board; keep the path/queue key stable). */
export const cardFileName = (id: string): string => `${id}.md`;

/**
 * The card's display title: its own title, else its UC `ref`, else the note id.
 * Shared by the note's `# ` heading (write) and the parsed `title` (read) so the
 * two can never disagree — and so a card with no title (allowed when it carries a
 * ref) still gets a meaningful heading instead of a bare `# ` (which the heading
 * strip below would otherwise have to special-case).
 */
const displayTitle = (title: string, ref: string | undefined, id: string): string =>
  title.trim() || (ref ?? id);

/**
 * Recovers the user's body by removing the EXACT `# <title>` heading
 * {@link buildCardNote} prepends (and its single blank-line separator). The
 * explicit, line-based inverse of that prepend: it drops the heading line only
 * when it matches `generatedHeading` byte-for-byte — so a user-authored H1 that
 * isn't the generated heading is preserved — plus one blank line, keeping every
 * remaining byte intact (NO trim) so meaningful whitespace survives a board save.
 */
const stripCardHeading = (body: string, generatedHeading: string): string => {
  const lines = body.split("\n");
  if (lines[0] === generatedHeading) {
    lines.shift(); // the generated heading line
    if (lines[0] === "") lines.shift(); // its single blank-line separator, when present
  }
  return lines.join("\n");
};

export const buildCardNote = (c: StoryMapCardNote): string => {
  const ref = c.ref && isValidUseCaseRef(c.ref) ? c.ref : undefined;
  const fields: Record<string, FrontmatterValue> = {
    type: "story-map-card",
    id: c.id,
    map: c.map,
    card_type: c.cardType,
    status: c.status,
    points: c.points,
    tags: c.tags.length > 0 ? c.tags : undefined,
    ref,
    color: c.color && c.color.trim() !== "" ? c.color.trim() : undefined,
    activity: c.activity,
    step: c.step && c.step !== "" ? c.step : undefined,
    slice: c.slice,
    order: c.order,
    title: c.title,
  };
  const heading = displayTitle(c.title, ref, c.id);
  // Body bytes are preserved verbatim (no trim, no appended newline) — the inverse
  // of stripCardHeading — so a hand-written body's meaningful whitespace survives a
  // board save unchanged. An empty body collapses to a heading-only note.
  const body = c.body === "" ? `# ${heading}\n` : `# ${heading}\n\n${c.body}`;
  return buildNote(fields, body);
};

const intOrUndef = (v: unknown): number | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

export const parseCardNote = (content: string, path: VaultPath): StoryMapCardNote | null => {
  const { frontmatter: fm, body } = parseNote(content);
  // Reject a malformed id here: it becomes the card's file name / queue key, so a
  // hand-edited `id` with `/` or `..` would otherwise escape cards/ or make
  // joinVaultPath throw on the next save. An unparsable note is simply ignored.
  if (fm.type !== "story-map-card" || !isStoryMapCardId(fm.id)) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const arr = (v: string | string[] | undefined): string[] =>
    Array.isArray(v) ? v : typeof v === "string" && v !== "" ? [v] : [];
  const step = typeof fm.step === "string" && fm.step !== "" ? fm.step : undefined;
  const ref = typeof fm.ref === "string" && isValidUseCaseRef(fm.ref) ? fm.ref : undefined;
  // A referenced card may carry a blank title (only reference-less cards require one
  // — validateCardPlacement); displayTitle falls it back to the ref (never the
  // generated note id), matching the heading buildCardNote wrote. Strip only that
  // exact generated heading, so a user-authored H1 is preserved.
  const title = displayTitle(str(fm.title), ref, fm.id);
  return {
    id: fm.id,
    map: str(fm.map),
    cardType: isCardType(fm.card_type) ? fm.card_type : "task",
    ref,
    status: isCardStatus(fm.status) ? fm.status : undefined,
    points: intOrUndef(fm.points),
    tags: arr(fm.tags),
    color: typeof fm.color === "string" && fm.color !== "" ? fm.color : undefined,
    activity: str(fm.activity),
    step,
    slice: str(fm.slice),
    order: intOrUndef(fm.order) ?? 0,
    title,
    body: stripCardHeading(body, `# ${title}`),
    path,
  };
};

import { buildNote, parseNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import { isCardType, type StoryMapCardNote } from "../../domain/entities/story-map-card";
import { isCardStatus, isValidUseCaseRef } from "../../domain/entities/story-map";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** Stable id-only file name (cards rename often via the board; keep the path/queue key stable). */
export const cardFileName = (id: string): string => `${id}.md`;

export const buildCardNote = (c: StoryMapCardNote): string => {
  const fields: Record<string, FrontmatterValue> = {
    type: "story-map-card",
    id: c.id,
    map: c.map,
    card_type: c.cardType,
    status: c.status,
    points: c.points,
    tags: c.tags.length > 0 ? c.tags : undefined,
    ref: c.ref && isValidUseCaseRef(c.ref) ? c.ref : undefined,
    color: c.color && c.color.trim() !== "" ? c.color.trim() : undefined,
    activity: c.activity,
    step: c.step && c.step !== "" ? c.step : undefined,
    slice: c.slice,
    order: c.order,
    title: c.title,
  };
  const body = c.body.trim() === "" ? `# ${c.title}\n` : `# ${c.title}\n\n${c.body.trim()}\n`;
  return buildNote(fields, body);
};

const intOrUndef = (v: unknown): number | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

export const parseCardNote = (content: string, path: VaultPath): StoryMapCardNote | null => {
  const { frontmatter: fm, body } = parseNote(content);
  if (fm.type !== "story-map-card" || typeof fm.id !== "string") return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const arr = (v: string | string[]): string[] =>
    Array.isArray(v) ? v : v !== "" ? [v] : [];
  const step = typeof fm.step === "string" && fm.step !== "" ? fm.step : undefined;
  return {
    id: fm.id,
    map: str(fm.map),
    cardType: isCardType(fm.card_type) ? fm.card_type : "task",
    ref: typeof fm.ref === "string" && isValidUseCaseRef(fm.ref) ? fm.ref : undefined,
    status: isCardStatus(fm.status) ? fm.status : undefined,
    points: intOrUndef(fm.points),
    tags: arr(fm.tags),
    color: typeof fm.color === "string" && fm.color !== "" ? fm.color : undefined,
    activity: str(fm.activity),
    step,
    slice: str(fm.slice),
    order: intOrUndef(fm.order) ?? 0,
    title: str(fm.title) || fm.id,
    body: body.replace(/^#\s+.*\n?/, "").trim(),
    path,
  };
};

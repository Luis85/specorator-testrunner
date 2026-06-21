import type { VaultPath } from "../value-objects/identifiers";
import type { CardStatus } from "./story-map";

export const CARD_TYPES = ["task", "note", "question", "edge-case", "design"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const isCardType = (v: unknown): v is CardType =>
  typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);

/** Legend colours (storymaps.io parity). CSS resolves these via var() fallbacks. */
export const CARD_TYPE_COLORS: Record<CardType, string> = {
  task: "var(--sm-card-task, #f6e58d)",
  note: "var(--sm-card-note, #7ed6df)",
  question: "var(--sm-card-question, #b8e994)",
  "edge-case": "var(--sm-card-edge, #f8a5c2)",
  design: "var(--sm-card-design, #cf9bff)",
};

export type StoryMapCardId = string; // "SMC-NNN"
export const STORY_MAP_CARD_ID_RE = /^SMC-(\d{3,})$/;

/**
 * True when `value` is a well-formed `SMC-NNN` card id. Card ids become file
 * names (`cardFileName`) and queue keys, so an id carrying `/` or `..` would
 * escape the cards/ folder or make `joinVaultPath` throw — reject such ids at
 * the parse boundary before they reach the store.
 */
export const isStoryMapCardId = (value: unknown): value is StoryMapCardId =>
  typeof value === "string" && STORY_MAP_CARD_ID_RE.test(value);

/** Persisted card-note: placement + planning attributes + body (ADR-0030). */
export interface StoryMapCardNote {
  id: StoryMapCardId;
  map: string; // owning SM-NNN
  cardType: CardType;
  ref?: string; // UC-NNN
  status?: CardStatus;
  points?: number;
  tags: string[];
  color?: string; // optional override
  activity: string;
  step?: string;
  slice: string;
  order: number; // index within its cell
  title: string;
  body: string;
  path: VaultPath;
}

export const nextStoryMapCardId = (
  existing: readonly { id?: StoryMapCardId }[],
): StoryMapCardId => {
  const max = existing.reduce((hi, c) => {
    const m = c.id ? STORY_MAP_CARD_ID_RE.exec(c.id) : null;
    return m ? Math.max(hi, Number.parseInt(m[1], 10)) : hi;
  }, 0);
  return `SMC-${String(max + 1).padStart(3, "0")}`;
};

/** Colour for a card: explicit non-blank override, else its type colour. */
export const cardColor = (card: { cardType: CardType; color?: string }): string =>
  card.color && card.color.trim() !== "" ? card.color.trim() : CARD_TYPE_COLORS[card.cardType];

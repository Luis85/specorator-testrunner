import { buildNote, parseNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import {
  buildStoryMapGrid,
  CARD_STATUSES,
  encodeCard,
  encodeStep,
  isStoryMapStatus,
  normalizeLabels,
  normalizeSteps,
  parseCard,
  parseStep,
  STORY_MAP_DEFAULT_PRODUCT,
  type StoryMap,
  type StoryMapCard,
  type StoryMapGridColumn,
  type StoryMapStep,
} from "../../domain/entities/story-map";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** Kebab-case folder/file name shared by a Story Map's folder and its note. */
export const storyMapFolderName = (id: string, title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${id}-${slug}` : id;
};

/**
 * Markers delimiting the managed grid block in a Story Map note body, so
 * {@link replaceGridBlock} can regenerate just the grid (from the authoritative
 * frontmatter) without clobbering hand-written body sections.
 */
export const GRID_BLOCK_START = "<!-- story-map-grid:start -->";
export const GRID_BLOCK_END = "<!-- story-map-grid:end -->";

/**
 * Markers delimiting the managed product paragraph (the visible `Story map for
 * [[product]]` line), so it can be refreshed from the authoritative `product`
 * frontmatter when a map is reassigned — without disturbing hand-written prose.
 */
export const PRODUCT_BLOCK_START = "<!-- story-map-product:start -->";
export const PRODUCT_BLOCK_END = "<!-- story-map-product:end -->";

/** A single Use Case cell link: resolved, aliased wikilink so it never dangles. */
const cellLink = (ref: string, ucNoteNames: Map<string, string>): string => {
  const noteName = ucNoteNames.get(ref);
  // Generated Use Case notes are titled `UC-NNN <Title>.md`, so a bare
  // `[[UC-NNN]]` does NOT resolve in Obsidian — alias the resolved note name
  // while still showing the id (mirrors the evidence renderer).
  return noteName ? `[[${noteName}\\|${ref}]]` : `[[${ref}]]`;
};

/** Escapes a value for a Markdown table cell (pipes break the column layout). */
const tableSafe = (value: string): string => value.replace(/\|/g, "\\|");

/**
 * The compact attribute suffix shown after a card's title/link: status, points,
 * and tags, each prefixed with `·`. Empty when the card carries no attributes.
 * Pure: no I/O.
 */
export const cardAttributeSuffix = (card: StoryMapCard): string => {
  const parts: string[] = [];
  if (card.status) parts.push(card.status);
  if (card.points !== undefined) parts.push(`${card.points}pts`);
  for (const tag of card.tags) parts.push(`#${tag}`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
};

/** Renders one card in a grid cell: title (or aliased UC link) plus attributes. */
const renderCard = (card: StoryMapCard, ucNoteNames: Map<string, string>): string => {
  const head = card.ref
    ? `${tableSafe(card.title)} ${cellLink(card.ref, ucNoteNames)}`
    : tableSafe(card.title);
  return `${head}${tableSafe(cardAttributeSuffix(card))}`;
};

/** A leaf column's table header label: the step, or the activity for a no-step column. */
const columnHeader = (column: StoryMapGridColumn): string => tableSafe(column.step ?? "(no step)");

/**
 * Renders one activity's sub-table: a slices × step-columns Markdown table, each
 * cell listing its cards. An activity with no declared steps renders a single
 * column. Pure: no I/O.
 */
export const renderActivityTable = (
  map: StoryMap,
  activity: string,
  ucNoteNames: Map<string, string>,
): string => {
  const grid = buildStoryMapGrid(map);
  const columns = grid.columns.filter((c) => c.activity === activity);
  const header = `| Slice ↓ / Step → | ${columns.map(columnHeader).join(" | ")} |`;
  const divider = `| --- | ${columns.map(() => "---").join(" | ")} |`;
  const rows = grid.rows.map((row) => {
    const cells = columns.map((column) => {
      const cell = row.cells.find(
        (c) => c.column.activity === activity && c.column.step === column.step,
      );
      const cards = cell?.cards ?? [];
      return cards.map((card) => renderCard(card, ucNoteNames)).join("<br>");
    });
    return `| **${tableSafe(row.slice)}** | ${cells.join(" | ")} |`;
  });
  return [`### ${activity}`, "", header, divider, ...rows].join("\n");
};

/** The per-slice points roll-up table (sum of every card's points in a slice). */
export const renderPointsRollup = (map: StoryMap): string => {
  const grid = buildStoryMapGrid(map);
  const header = "| Slice | Points |";
  const divider = "| --- | --- |";
  const rows = grid.rows.map((row) => `| ${tableSafe(row.slice)} | ${row.points} |`);
  const total = grid.rows.reduce((sum, row) => sum + row.points, 0);
  return ["#### Points roll-up", "", header, divider, ...rows, `| **Total** | **${total}** |`].join(
    "\n",
  );
};

/** The planning-status legend (the four hand-set statuses). */
export const renderLegend = (): string =>
  ["#### Legend", "", `Planning status: ${CARD_STATUSES.join(" · ")}`].join("\n");

/**
 * The audience lane: the personas the journey serves — storymaps.io's top
 * "users" row (ADR-0028 §Rendering). Empty string when no users are set.
 */
export const renderUsersLane = (map: StoryMap): string =>
  map.users.length > 0 ? `**Users:** ${map.users.join(" · ")}` : "";

/**
 * Renders the managed grid: an audience (users) lane, then per-activity
 * sub-tables, a per-slice points roll-up, and a status legend. A map with no
 * activities renders a guidance line instead. Pure: no I/O.
 */
export const renderStoryMapGridTable = (
  map: StoryMap,
  ucNoteNames: Map<string, string>,
): string => {
  if (map.activities.length === 0) {
    return "_No activities yet — add a backbone to render the map._";
  }
  const lane = renderUsersLane(map);
  const sections = map.activities.map((activity) =>
    renderActivityTable(map, activity, ucNoteNames),
  );
  return [
    ...(lane !== "" ? [lane] : []),
    ...sections,
    renderPointsRollup(map),
    renderLegend(),
  ].join("\n\n");
};

/** Wraps the grid table in its managed-block markers. */
const gridBlock = (table: string): string => `${GRID_BLOCK_START}\n${table}\n${GRID_BLOCK_END}`;

/**
 * An inline (non-table) resolved wikilink to a note. Unlike grid cells, the body
 * paragraph is not a Markdown table, so the alias pipe is NOT escaped. Falls back
 * to a bare link when the note name is unresolved.
 */
const inlineLink = (id: string, noteNames: Map<string, string>): string => {
  const noteName = noteNames.get(id);
  return noteName ? `[[${noteName}|${id}]]` : `[[${id}]]`;
};

/**
 * The body paragraph naming the product a map shapes — a resolved inline link to
 * the PRD. The single source for both the freshly built note and the rebuild
 * refresh, so the visible link always tracks the `product` frontmatter. Pure.
 */
export const renderProductParagraph = (product: string, noteNames: Map<string, string>): string =>
  `Story map for ${inlineLink(product, noteNames)} — users, backbone (activities), steps, and release slices.`;

/** Wraps the product paragraph in its managed-block markers. */
const productBlock = (paragraph: string): string =>
  `${PRODUCT_BLOCK_START}\n${paragraph}\n${PRODUCT_BLOCK_END}`;

/**
 * Refreshes the managed product paragraph so the visible product link tracks the
 * `product` frontmatter (e.g. after a reassignment + rebuild). Replaces the
 * marked block when present; otherwise upgrades a legacy unmarked `Story map for
 * …` line in place (wrapping it in markers so later rebuilds stay clean). Leaves
 * the body untouched when neither is found. Pure: no I/O.
 */
export const replaceProductBlock = (body: string, paragraph: string): string => {
  const block = productBlock(paragraph);
  const marked = new RegExp(
    `${escapeRegExp(PRODUCT_BLOCK_START)}[\\s\\S]*?${escapeRegExp(PRODUCT_BLOCK_END)}`,
  );
  if (marked.test(body)) return body.replace(marked, block);
  const legacy = /^Story map for .*$/m;
  return legacy.test(body) ? body.replace(legacy, block) : body;
};

/**
 * Replaces the managed grid block in an existing note body, preserving every
 * other (hand-written) section. Appends a fresh block when the markers are
 * absent (e.g. a note created before the markers existed). Pure: no I/O.
 */
export const replaceGridBlock = (body: string, table: string): string => {
  const block = gridBlock(table);
  const pattern = new RegExp(
    `${escapeRegExp(GRID_BLOCK_START)}[\\s\\S]*?${escapeRegExp(GRID_BLOCK_END)}`,
  );
  return pattern.test(body) ? body.replace(pattern, block) : `${body.trimEnd()}\n\n${block}\n`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Serialize a Story Map to a frontmatter+markdown note. Parser-safe forms only:
 * users/activities/slices are block sequences of label strings, steps are
 * `"activity | step"` scalars, and cards are nine-field positional scalars
 * (ADR-0026/0028 parser rules). The body carries a managed grid block.
 */
export const buildStoryMapNote = (map: StoryMap, noteNames: Map<string, string>): string => {
  const fields: Record<string, FrontmatterValue> = {
    id: map.id,
    type: "story-map",
    title: map.title,
    status: map.status,
    product: map.product,
    users: map.users.length > 0 ? map.users : undefined,
    activities: map.activities.length > 0 ? map.activities : undefined,
    steps: map.steps.length > 0 ? map.steps.map(encodeStep) : undefined,
    slices: map.slices.length > 0 ? map.slices : undefined,
    cards: map.cards.length > 0 ? map.cards.map(encodeCard) : undefined,
    display_order: map.displayOrder,
  };

  const body = [
    `# ${map.id}: ${map.title}`,
    "",
    productBlock(renderProductParagraph(map.product, noteNames)),
    "",
    "> Source of truth is the frontmatter (`users`, `activities`, `steps`,",
    "> `slices`, `cards`). Each card is a `ref | activity | step | slice | status",
    "> | points | tags | color | title` scalar; edit the `cards` list, then run",
    '> "Rebuild grid" to regenerate the tables below.',
    "",
    "## Map",
    "",
    gridBlock(renderStoryMapGridTable(map, noteNames)),
    "",
    "## Notes",
    "",
  ].join("\n");

  return buildNote(fields, body);
};

/**
 * Read model for a Story Map note: the inverse of {@link buildStoryMapNote}.
 * Returns null when the note is not a `story-map` (so the indexer skips it).
 * Decodes steps and rich cards, dropping malformed lines. Pure: no I/O.
 */
export const parseStoryMapNote = (content: string, path: VaultPath): StoryMap | null => {
  const { frontmatter: fm } = parseNote(content);
  if (fm.type !== "story-map" || typeof fm.id !== "string") return null;
  const asArray = (v: string | string[] | undefined): string[] =>
    Array.isArray(v) ? v : v && v !== "" ? [v] : [];
  const cards = asArray(fm.cards)
    .map(parseCard)
    .filter((card): card is StoryMapCard => card !== null);
  // Normalize axes on read (mirrors the create path) so hand-edited frontmatter
  // can't render duplicate activity sub-tables / slice rows or double-count the
  // points roll-up. Steps are filtered against the normalized backbone.
  const activities = normalizeLabels(asArray(fm.activities));
  const steps = normalizeSteps(
    asArray(fm.steps)
      .map(parseStep)
      .filter((step): step is StoryMapStep => step !== null),
    activities,
  );
  return {
    id: fm.id,
    title: typeof fm.title === "string" ? fm.title : fm.id,
    status: isStoryMapStatus(fm.status) ? fm.status : "draft",
    product:
      typeof fm.product === "string" && fm.product !== "" ? fm.product : STORY_MAP_DEFAULT_PRODUCT,
    users: normalizeLabels(asArray(fm.users)),
    activities,
    steps,
    slices: normalizeLabels(asArray(fm.slices)),
    cards,
    displayOrder:
      Number.parseInt(typeof fm.display_order === "string" ? fm.display_order : "0", 10) || 0,
    path,
  };
};

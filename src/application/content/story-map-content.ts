import { buildNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import { buildStoryMapGrid, encodeCard, type StoryMap } from "../../domain/entities/story-map";

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

/** A single Use Case cell link: resolved, aliased wikilink so it never dangles. */
const cellLink = (ucId: string, ucNoteNames: Map<string, string>): string => {
  const noteName = ucNoteNames.get(ucId);
  // Generated Use Case notes are titled `UC-NNN <Title>.md`, so a bare
  // `[[UC-NNN]]` does NOT resolve in Obsidian — alias the resolved note name
  // while still showing the id (mirrors the evidence renderer).
  return noteName ? `[[${noteName}\\|${ucId}]]` : `[[${ucId}]]`;
};

/**
 * Renders the activity × slice grid as a Markdown table. Columns are activities
 * (the backbone), rows are slices (release bands), and each cell lists the Use
 * Cases placed there as resolved, aliased wikilinks. A map with no activities
 * renders a guidance line instead of an empty table.
 */
export const renderStoryMapGridTable = (
  map: StoryMap,
  ucNoteNames: Map<string, string>,
): string => {
  if (map.activities.length === 0) {
    return "_No activities yet — add a backbone to render the map._";
  }
  const grid = buildStoryMapGrid(map);
  const header = `| Slice ↓ / Activity → | ${map.activities.join(" | ")} |`;
  const divider = `| --- | ${map.activities.map(() => "---").join(" | ")} |`;
  const rows = grid.rows.map((row) => {
    const cells = row.cells.map((cell) =>
      cell.ucIds.length > 0 ? cell.ucIds.map((id) => cellLink(id, ucNoteNames)).join("<br>") : "",
    );
    return `| **${row.slice}** | ${cells.join(" | ")} |`;
  });
  return [header, divider, ...rows].join("\n");
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
 * activities/slices are block sequences of label strings, and cards are block
 * sequences of `"UC | activity | slice"` string scalars (ADR-0026 parser rules).
 * The body carries a managed grid block rendered from the cards.
 */
export const buildStoryMapNote = (map: StoryMap, noteNames: Map<string, string>): string => {
  const fields: Record<string, FrontmatterValue> = {
    id: map.id,
    type: "story-map",
    title: map.title,
    status: map.status,
    product: map.product,
    activities: map.activities.length > 0 ? map.activities : undefined,
    slices: map.slices.length > 0 ? map.slices : undefined,
    cards: map.cards.length > 0 ? map.cards.map(encodeCard) : undefined,
    display_order: map.displayOrder,
  };

  const body = [
    `# ${map.id}: ${map.title}`,
    "",
    `Story map for ${inlineLink(map.product, noteNames)} — backbone (activities) × release slices.`,
    "",
    "> Source of truth is the frontmatter (`activities`, `slices`, `cards`). Each",
    "> card references a Use Case by id (`UC-NNN | activity | slice`); edit the",
    '> `cards` list, then run "Rebuild grid" to regenerate the table below.',
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

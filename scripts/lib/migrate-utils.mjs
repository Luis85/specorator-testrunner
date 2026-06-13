/**
 * Shared helpers for the one-time PRD migration scripts. Kept here (rather than
 * inline in each CLI) so the pure logic is unit-tested and not duplicated across
 * `migrate-prd-0.mjs` and `create-sub-prds.mjs`.
 */

/**
 * Generic CLI flag parser. `spec` maps a flag (e.g. `"--prds-path"`) to
 * `{ key, default, boolean? }`. Value flags consume the next argv token; boolean
 * flags set `true`. Unknown flags and missing values throw.
 *
 * @param {string[]} argv
 * @param {Record<string, { key: string, default: unknown, boolean?: boolean }>} spec
 * @returns {Record<string, unknown>}
 */
export const parseFlags = (argv, spec) => {
  const options = {};
  for (const def of Object.values(spec)) options[def.key] = def.default;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const def = spec[arg];
    if (!def) throw new Error(`Unknown argument: ${arg}`);
    if (def.boolean) {
      options[def.key] = true;
    } else {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      options[def.key] = value;
    }
  }
  return options;
};

const isHeading = (line) => /^#{1,6}\s/.test(line);
const isDivider = (row) => /^\|[\s|:-]+\|$/.test(row);

/** Collects the pipe-rows of the first table under a heading matching the pattern. */
const firstTableRows = (body, headingPattern) => {
  const rows = [];
  let inSection = false;
  for (const line of body.split("\n")) {
    if (isHeading(line)) {
      if (rows.length > 0) break; // the table under this section already ended
      inSection = headingPattern.test(line);
      continue;
    }
    const row = line.trim();
    if (inSection && row.startsWith("|")) rows.push(row);
    else if (rows.length > 0) break; // blank/prose after the table closes it
  }
  return rows;
};

/** The trimmed last cell of a `| a | b |` Markdown row. */
const lastCell = (row) => {
  const cells = row
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  return cells[cells.length - 1];
};

/**
 * Best-effort extraction of the descriptive (last) column of the first Markdown
 * table under a heading matching `headingPattern`, skipping the header and
 * divider rows. Used to derive scope_in/scope_out from a vision note's
 * Goals/Non-Goals tables.
 *
 * @param {string} body
 * @param {RegExp} headingPattern
 * @returns {string[]}
 */
export const extractTableColumn = (body, headingPattern) =>
  firstTableRows(body, headingPattern)
    .filter((row) => !isDivider(row))
    .slice(1) // drop the header row
    .map(lastCell)
    .filter((value) => Boolean(value));

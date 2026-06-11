/**
 * Minimal YAML frontmatter serialiser for the small, well-typed objects the
 * plugin generates (Use Case, Suite, Evidence, Dashboard — TIS §10). It is not
 * a general YAML emitter: it supports strings, numbers, booleans, and arrays of
 * those. Field order is preserved from the input object.
 */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | (string | number | boolean)[];

const needsQuoting = (value: string): boolean =>
  value === "" ||
  /^\s|\s$/.test(value) || // leading/trailing whitespace
  /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || // ambiguous leading indicator
  /:\s/.test(value) || // looks like a nested mapping
  value.endsWith(":") ||
  /\s#/.test(value) || // looks like a trailing comment
  /^(true|false|null|yes|no|on|off)$/i.test(value) || // reserved words
  /^[+-]?(\d+\.?\d*|\.\d+)$/.test(value); // numeric-looking

const scalar = (value: string | number | boolean): string => {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return needsQuoting(value) ? JSON.stringify(value) : value;
};

const renderField = (key: string, value: FrontmatterValue): string | null => {
  if (value === undefined) return null;
  if (value === null) return `${key}:`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return [`${key}:`, ...value.map((item) => `  - ${scalar(item)}`)].join("\n");
  }
  return `${key}: ${scalar(value)}`;
};

/** Serialises an object as a `---`-delimited YAML frontmatter block. */
export const buildFrontmatter = (fields: Record<string, FrontmatterValue>): string => {
  const lines = Object.entries(fields)
    .map(([key, value]) => renderField(key, value))
    .filter((line): line is string => line !== null);
  return ["---", ...lines, "---"].join("\n");
};

/** Combines a frontmatter block with a Markdown body. */
export const buildNote = (fields: Record<string, FrontmatterValue>, body: string): string =>
  `${buildFrontmatter(fields)}\n\n${body.trimStart()}`;

/** A note split into its parsed frontmatter and Markdown body. */
export interface ParsedNote {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

const unquote = (raw: string): string => {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  return value;
};

/**
 * Parses notes produced by {@link buildNote}. Scalars are returned as strings
 * (callers coerce); block sequences become string arrays. This is the inverse
 * of {@link buildFrontmatter} for the plugin's own well-typed notes, not a
 * general YAML parser.
 */
export const parseNote = (rawContent: string): ParsedNote => {
  // Normalise CRLF (Windows checkouts/editors) to LF so the `---` fence and the
  // line parsing below match regardless of line endings.
  const content = rawContent.replace(/\r\n/g, "\n");
  // Consume the closing fence plus the blank line buildNote inserts, so the
  // body round-trips exactly.
  const match = /^---\n([\s\S]*?)\n---\n?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };

  const lines = match[1].split("\n");
  const frontmatter: Record<string, string | string[]> = {};
  let i = 0;
  while (i < lines.length) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!field) {
      i++;
      continue;
    }
    const [, key, rest] = field;
    if (rest === "[]") {
      frontmatter[key] = [];
      i++;
      continue;
    }
    if (rest === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(unquote(lines[j].replace(/^\s*-\s+/, "")));
        j++;
      }
      frontmatter[key] = items.length > 0 ? items : "";
      i = items.length > 0 ? j : i + 1;
      continue;
    }
    frontmatter[key] = unquote(rest);
    i++;
  }

  return { frontmatter, body: content.slice(match[0].length) };
};

/** Parses just the frontmatter block of a note. */
export const parseFrontmatter = (content: string): Record<string, string | string[]> =>
  parseNote(content).frontmatter;

/**
 * Rewrites a note's frontmatter, merging `changes` over the existing fields and
 * preserving the Markdown body and any unknown frontmatter fields. Used to
 * update managed fields (e.g. `feature_files`) without clobbering hand-written
 * content. A `null`/`undefined` change drops that key.
 */
export const updateNoteFrontmatter = (
  content: string,
  changes: Record<string, FrontmatterValue>,
): string => {
  const { frontmatter, body } = parseNote(content);
  const merged: Record<string, FrontmatterValue> = { ...frontmatter, ...changes };
  return `${buildFrontmatter(merged)}\n\n${body}`;
};

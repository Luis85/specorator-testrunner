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
  | Array<string | number | boolean>;

const needsQuoting = (value: string): boolean =>
  value === "" ||
  /^\s|\s$/.test(value) || // leading/trailing whitespace
  /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || // ambiguous leading indicator
  /:\s/.test(value) || // looks like a nested mapping
  /:$/.test(value) ||
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
export const buildFrontmatter = (
  fields: Record<string, FrontmatterValue>,
): string => {
  const lines = Object.entries(fields)
    .map(([key, value]) => renderField(key, value))
    .filter((line): line is string => line !== null);
  return ["---", ...lines, "---"].join("\n");
};

/** Combines a frontmatter block with a Markdown body. */
export const buildNote = (
  fields: Record<string, FrontmatterValue>,
  body: string,
): string => `${buildFrontmatter(fields)}\n\n${body.trimStart()}`;

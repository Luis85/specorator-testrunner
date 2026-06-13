/**
 * Builds PRD notes byte-compatible with the plugin's PRD content factory
 * (`src/application/content/prd-content.ts`) and its frontmatter serialiser
 * (`src/shared/utils/frontmatter.ts`).
 *
 * This is a standalone re-implementation for the one-time migration scripts
 * (PRD Creator, Tasks 18/19). It deliberately mirrors `frontmatter.ts` exactly:
 *  - block-sequence arrays only (`key:\n  - item`), never inline `[a, b]`;
 *  - a `null` value renders as a bare `key:` line (no literal "null");
 *  - empty arrays render as `key: []`.
 * The PRD factory omits empty array fields entirely (passing `undefined`), so an
 * empty `scope_in`/`scope_out`/`domains` never reaches the serialiser.
 */

// --- frontmatter serialisation (mirrors src/shared/utils/frontmatter.ts) ---

const needsQuoting = (value) =>
  value === "" ||
  /^\s|\s$/.test(value) ||
  /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
  /:\s/.test(value) ||
  value.endsWith(":") ||
  /\s#/.test(value) ||
  /^(true|false|null|yes|no|on|off)$/i.test(value) ||
  /^[+-]?(\d+\.?\d*|\.\d+)$/.test(value);

const scalar = (value) => {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return needsQuoting(value) ? JSON.stringify(value) : value;
};

const renderField = (key, value) => {
  if (value === undefined) return null;
  if (value === null) return `${key}:`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return [`${key}:`, ...value.map((item) => `  - ${scalar(item)}`)].join("\n");
  }
  return `${key}: ${scalar(value)}`;
};

const buildFrontmatter = (fields) => {
  const lines = Object.entries(fields)
    .map(([key, value]) => renderField(key, value))
    .filter((line) => line !== null);
  return ["---", ...lines, "---"].join("\n");
};

const buildNote = (fields, body) => `${buildFrontmatter(fields)}\n\n${body.trimStart()}`;

// --- PRD-specific helpers ---

/** Strips characters Obsidian/OSes disallow in filenames, collapsing spaces. */
const sanitize = (value) =>
  value
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Lower-cases and kebab-cases a title for the folder/note name. */
const kebab = (value) =>
  sanitize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The shared folder + note basename for a PRD, e.g.
 * `prdFolderName("PRD-000", "Product Vision")` → `PRD-000-product-vision`.
 *
 * @param {string} id
 * @param {string} title
 * @returns {string}
 */
export const prdFolderName = (id, title) => {
  const slug = kebab(title);
  return slug ? `${id}-${slug}` : id;
};

/**
 * Renders a PRD note (frontmatter + body) identical to the plugin factory.
 *
 * @param {{
 *   id: string,
 *   title: string,
 *   status: string,
 *   parentPrdId?: string | null,
 *   domains?: string[],
 *   vision: string,
 *   scopeIn?: string[],
 *   scopeOut?: string[],
 *   displayOrder: number,
 * }} prd
 * @returns {string}
 */
export const buildPrdNote = (prd) => {
  const domains = prd.domains ?? [];
  const scopeIn = prd.scopeIn ?? [];
  const scopeOut = prd.scopeOut ?? [];
  // A root PRD (no parent) must render an EMPTY `parent-prd:` line, never the
  // literal "null" — null renders as a bare key in the serialiser above.
  const parentPrd =
    prd.parentPrdId === undefined || prd.parentPrdId === null ? null : prd.parentPrdId;

  const scopeInLines =
    scopeIn.length > 0
      ? scopeIn.map((item) => `- **In:** ${item}`).join("\n")
      : "_No in-scope items recorded yet._";
  const scopeOutLines =
    scopeOut.length > 0
      ? scopeOut.map((item) => `- **Out:** ${item}`).join("\n")
      : "_No out-of-scope items recorded yet._";

  return buildNote(
    {
      id: prd.id,
      type: "prd",
      title: prd.title,
      status: prd.status,
      "parent-prd": parentPrd,
      domains: domains.length > 0 ? domains : undefined,
      vision: prd.vision,
      scope_in: scopeIn.length > 0 ? scopeIn : undefined,
      scope_out: scopeOut.length > 0 ? scopeOut : undefined,
      display_order: prd.displayOrder,
    },
    `# ${prd.id}: ${prd.title}

## Executive Summary

${prd.vision}

## Research Summary

_No research recorded yet._

## Scope

${scopeInLines}
${scopeOutLines}

## Success Criteria

_No success criteria recorded yet._

## Related Use Cases

_No Use Cases linked yet._
`,
  );
};

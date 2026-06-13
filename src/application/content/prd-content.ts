import { buildNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import type { Prd } from "../../domain/entities/prd";

/** Kebab-case folder/file name shared by a PRD's folder and its note. */
export const prdFolderName = (id: string, title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${id}-${slug}` : id;
};

/** Serialize a PRD entity to a frontmatter+markdown note. Parser-safe forms only. */
export const buildPrdNote = (prd: Prd): string => {
  const fields: Record<string, FrontmatterValue> = {
    id: prd.id,
    type: "prd",
    title: prd.title,
    status: prd.status,
    // empty => root marker (null renders as "parent-prd:"); never literal null text
    "parent-prd": prd.parentPrdId ?? null,
    domains: prd.domains.length > 0 ? prd.domains : undefined,
    vision: prd.vision,
    scope_in: prd.scopeIn.length > 0 ? prd.scopeIn : undefined,
    scope_out: prd.scopeOut.length > 0 ? prd.scopeOut : undefined,
    display_order: prd.displayOrder,
  };

  const body = [
    `# ${prd.id}: ${prd.title}`,
    "",
    "## Executive Summary",
    "",
    "## Research Summary",
    "",
    "## Scope",
    "- **In:**",
    ...prd.scopeIn.map((s) => `  - ${s}`),
    "- **Out:**",
    ...prd.scopeOut.map((s) => `  - ${s}`),
    "",
    "## Success Criteria",
    "",
    "## Related Use Cases",
    "",
  ].join("\n");

  return buildNote(fields, body);
};

import { buildNote, parseNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import type { Persona } from "../../domain/entities/persona";
import type { VaultPath } from "../../domain/value-objects/identifiers";

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Id-stable file name; slug is cosmetic and set once at creation (not renamed). */
export const personaFileName = (id: string, name: string): string => {
  const s = slug(name);
  return s ? `${id} ${s}.md` : `${id}.md`;
};

export const buildPersonaNote = (persona: Persona): string => {
  const fields: Record<string, FrontmatterValue> = {
    type: "persona",
    id: persona.id,
    name: persona.name,
    color: persona.color && persona.color.trim() !== "" ? persona.color.trim() : undefined,
  };
  const body =
    persona.body.trim() === ""
      ? `# ${persona.name}\n`
      : `# ${persona.name}\n\n${persona.body.trim()}\n`;
  return buildNote(fields, body);
};

export const parsePersonaNote = (content: string, path: VaultPath): Persona | null => {
  const { frontmatter: fm, body } = parseNote(content);
  if (fm.type !== "persona" || typeof fm.id !== "string") return null;
  const name = typeof fm.name === "string" && fm.name !== "" ? fm.name : fm.id;
  return {
    id: fm.id,
    name,
    color: typeof fm.color === "string" && fm.color !== "" ? fm.color : undefined,
    body: stripHeading(body, name).trim(),
    path,
  };
};

const stripHeading = (body: string, name: string): string => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`^#\\s+${escaped}\\s*\\n?`), "");
};

import type { VaultPath } from "../value-objects/identifiers";

export type PersonaId = string; // "PER-NNN"
// fallow-ignore-next-line unused-export
export const PERSONA_ID_RE = /^PER-(\d{3,})$/;
export const isPersonaId = (v: unknown): v is PersonaId =>
  typeof v === "string" && PERSONA_ID_RE.test(v);

/** A reusable audience persona — shared across Story Maps (ADR-0030). */
export interface Persona {
  id: PersonaId;
  name: string;
  color?: string;
  body: string; // markdown description
  path: VaultPath;
}

/** Next sequential PER-NNN past the current max (mirrors nextUseCaseId). */
export const nextPersonaId = (existing: Pick<Persona, "id">[]): PersonaId => {
  const max = existing.reduce((hi, p) => {
    const m = PERSONA_ID_RE.exec(p.id);
    return m ? Math.max(hi, Number.parseInt(m[1], 10)) : hi;
  }, 0);
  return `PER-${String(max + 1).padStart(3, "0")}`;
};

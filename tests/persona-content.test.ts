import { describe, it, expect } from "vitest";
import {
  buildPersonaNote,
  parsePersonaNote,
  personaFileName,
} from "../src/application/content/persona-content";
import type { Persona } from "../src/domain/entities/persona";

const persona: Persona = {
  id: "PER-001",
  name: "Home Cook",
  color: "",
  body: "Cooks at home on weeknights.",
  path: "Personas/PER-001 home-cook.md" as Persona["path"],
};

describe("persona content", () => {
  it("builds a parser-safe note round-tripping through parse", () => {
    const note = buildPersonaNote(persona);
    expect(note).toContain("type: persona");
    expect(note).toContain("id: PER-001");
    expect(note).toContain("name: Home Cook");
    const parsed = parsePersonaNote(note, persona.path);
    expect(parsed).toEqual({ ...persona, color: undefined });
  });
  it("returns null for a non-persona note", () => {
    expect(parsePersonaNote("---\ntype: use-case\n---\n", persona.path)).toBeNull();
  });
  it("derives an id-stable file name with a cosmetic slug", () => {
    expect(personaFileName("PER-001", "Home Cook")).toBe("PER-001 home-cook.md");
    expect(personaFileName("PER-002", "")).toBe("PER-002.md");
  });
});

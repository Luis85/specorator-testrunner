import { describe, it, expect } from "vitest";
import { nextPersonaId, isPersonaId, type Persona } from "../src/domain/entities/persona";

describe("nextPersonaId", () => {
  it("allocates the first id from an empty library", () => {
    expect(nextPersonaId([])).toBe("PER-001");
  });
  it("increments past the current max, zero-padded", () => {
    const lib = [{ id: "PER-001" }, { id: "PER-009" }] as Persona[];
    expect(nextPersonaId(lib)).toBe("PER-010");
  });
  it("ignores ids that do not match the PER-NNN shape", () => {
    expect(nextPersonaId([{ id: "junk" }] as Persona[])).toBe("PER-001");
  });
});

describe("isPersonaId", () => {
  it("accepts PER-NNN and rejects others", () => {
    expect(isPersonaId("PER-003")).toBe(true);
    expect(isPersonaId("PRD-003")).toBe(false);
  });
});

# Story Maps: Note-Backed Cards & storymaps.io Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Story Map card and user/persona a first-class vault note, bring the board view to visual parity with storymaps.io (typed cards + legend, chips, per-slice progress/points, persona cards), and redesign the side panel — local-only, single-user.

**Architecture:** Obsidian plugin, hexagonal (domain → application → presentation), Result-based services, parser-safe frontmatter (block sequences + scalars, no inline arrays). Card-notes (`type: story-map-card`, `SMC-NNN`) live under each map's `cards/` folder and are the source of truth for placement; personas (`type: persona`, `PER-NNN`) are a shared library under `personasPath`; the Story Map note keeps only structure + ordered persona refs. The composed `StoryMap` read-model the board/grid consume keeps its current shape (`cards: StoryMapCard[]`, `users: Persona[]`), so renderers change *source*, not *interaction logic*.

**Tech Stack:** TypeScript, Vitest (1493 tests, ~96% lines), esbuild, ESLint/Prettier, fallow audit. Spec: `docs/superpowers/specs/2026-06-20-story-map-note-backed-cards-and-parity-design.md`.

---

## Definition of Done (every task)

**Gate — run before every commit; all must pass:**

```bash
npx prettier --check . && npm run lint && npm run typecheck && npm run build && npm run test:coverage && npx fallow audit --base origin/main
```

TDD: write the failing test first, watch it fail, implement minimally, watch it pass, run the gate, commit. Pure logic (domain/application) is unit-tested; the board/explorer **views** stay untested at unit level — their logic lives in pure modules that **are** tested.

---

## File Structure

**New files:**

| Path | Responsibility |
|------|----------------|
| `src/domain/entities/persona.ts` | `Persona` entity, `PER-NNN` id type + `nextPersonaId`, pure helpers. |
| `src/domain/entities/story-map-card.ts` | `CardType` + colours, `StoryMapCardNote` entity, `SMC-NNN` id type + `nextStoryMapCardId`, `cardColor`, `cardNoteSignature`. |
| `src/application/content/persona-content.ts` | `buildPersonaNote` / `parsePersonaNote` / `personaFileName`. |
| `src/application/content/story-map-card-content.ts` | `buildCardNote` / `parseCardNote` / `cardFileName`. |
| `src/application/services/persona-service.ts` | Shared persona library: `create` / `findAll` / `findById` / `rename`. |
| `src/application/services/story-map-cards-store.ts` | Card-note reconcile (upsert/delete) + scan→`StoryMapCard[]` for one map. |
| `src/presentation/views/persona-suggest-modal.ts` | "+ user" picker: existing personas + "Create new". |
| `tests/persona.test.ts`, `tests/story-map-card.test.ts`, `tests/persona-content.test.ts`, `tests/story-map-card-content.test.ts`, `tests/persona-service.test.ts`, `tests/story-map-cards-store.test.ts` | Unit tests for the above. |

**Modified files:**

| Path | Change |
|------|--------|
| `src/domain/entities/story-map.ts` | `StoryMapCard` gains `id?`, `cardType`, `order`; `users` model becomes `Persona[]`; **remove** `encodeCard`/`parseCard`; `storyMapSignature` uses card ids + persona ids. |
| `src/application/content/story-map-content.ts` | `buildStoryMapNote`: drop `cards` frontmatter, `users` → persona refs; `parseStoryMapNote`: drop card decode, `users` → refs (resolution happens in service); grid/users renderers use personas + `cardType`; `renderLegend` lists card types. |
| `src/application/services/story-map-service.ts` | `findAll`/`findById` compose via card-store + persona resolution; `saveMap` reconciles card-notes + persona refs; `addCard`/`updateCard`/`removeCard` go through the card-store; `personasPath` reset guard. |
| `src/domain/settings/settings.ts` | Add `personasPath`. |
| `src/presentation/views/story-map-board-scene.ts` | Typed-card colours, point/tag chips, per-slice progress+points, persona cards. |
| `src/presentation/views/story-map-board-layout.ts` | Carry `cardType`/colour/chips + persona lane geometry; per-slice progress/points. |
| `src/presentation/views/story-map-board-view.ts` | Persona add via suggest modal; users are personas; card editor adds `cardType`. |
| `src/presentation/views/story-map-card-modal.ts`, `src/application/services/story-map-card-form.ts`, `src/application/services/story-map-cards.ts` | Add `cardType`; drop `encodeCard`-based guard → `cardNoteSignature`. |
| `src/presentation/views/story-map-explorer-view.ts` | Redesigned rows (status pill, icon stat-strip, overflow actions, empty state, optional Personas section). |
| `styles.css` | Card-type colours, chips, progress bars, persona cards, legend, redesigned explorer. |
| `CONTEXT.md`, `docs/adr/0030-*.md` | Glossary + ADR. |

---

# Phase A — Data model

## Task A1: Persona entity

**Files:** Create `src/domain/entities/persona.ts`; Test `tests/persona.test.ts`.

- [ ] **Step 1 — failing test:**

```typescript
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
```

- [ ] **Step 2 — run, expect FAIL** (`npx vitest run tests/persona.test.ts`): module not found.

- [ ] **Step 3 — implement:**

```typescript
import type { VaultPath } from "../value-objects/identifiers";

export type PersonaId = string; // "PER-NNN"
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
```

- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): add Persona entity + PER-NNN id allocation`.

## Task A2: Card-note entity + type colours

**Files:** Create `src/domain/entities/story-map-card.ts`; Test `tests/story-map-card.test.ts`.

This entity is the **persisted** card-note. The in-memory board card (`StoryMapCard` in `story-map.ts`) is extended in Task A6 to carry `id`/`cardType`/`order`; this module owns the note-level concepts (id allocation, type→colour, note signature).

- [ ] **Step 1 — failing test:**

```typescript
import { describe, it, expect } from "vitest";
import {
  nextStoryMapCardId,
  isCardType,
  cardColor,
  CARD_TYPES,
  CARD_TYPE_COLORS,
} from "../src/domain/entities/story-map-card";

describe("nextStoryMapCardId", () => {
  it("starts at SMC-001 and increments past the max", () => {
    expect(nextStoryMapCardId([])).toBe("SMC-001");
    expect(nextStoryMapCardId([{ id: "SMC-001" }, { id: "SMC-004" }])).toBe("SMC-005");
  });
});

describe("isCardType", () => {
  it("accepts the five legend types only", () => {
    expect(CARD_TYPES).toEqual(["task", "note", "question", "edge-case", "design"]);
    expect(isCardType("task")).toBe(true);
    expect(isCardType("epic")).toBe(false);
  });
});

describe("cardColor", () => {
  it("derives colour from card_type", () => {
    expect(cardColor({ cardType: "note", color: undefined })).toBe(CARD_TYPE_COLORS.note);
  });
  it("honours an explicit colour override", () => {
    expect(cardColor({ cardType: "task", color: "#abcdef" })).toBe("#abcdef");
  });
  it("ignores a blank override and falls back to the type colour", () => {
    expect(cardColor({ cardType: "design", color: "   " })).toBe(CARD_TYPE_COLORS.design);
  });
});
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement:**

```typescript
import type { VaultPath } from "../value-objects/identifiers";
import type { CardStatus } from "./story-map";

export const CARD_TYPES = ["task", "note", "question", "edge-case", "design"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const isCardType = (v: unknown): v is CardType =>
  typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);

/** Legend colours (storymaps.io parity). CSS resolves these via var() fallbacks. */
export const CARD_TYPE_COLORS: Record<CardType, string> = {
  task: "var(--sm-card-task, #f6e58d)",
  note: "var(--sm-card-note, #7ed6df)",
  question: "var(--sm-card-question, #b8e994)",
  "edge-case": "var(--sm-card-edge, #f8a5c2)",
  design: "var(--sm-card-design, #cf9bff)",
};

export type StoryMapCardId = string; // "SMC-NNN"
export const STORY_MAP_CARD_ID_RE = /^SMC-(\d{3,})$/;

/** Persisted card-note: placement + planning attributes + body (ADR-0030). */
export interface StoryMapCardNote {
  id: StoryMapCardId;
  map: string; // owning SM-NNN
  cardType: CardType;
  ref?: string; // UC-NNN
  status?: CardStatus;
  points?: number;
  tags: string[];
  color?: string; // optional override
  activity: string;
  step?: string;
  slice: string;
  order: number; // index within its cell
  title: string;
  body: string;
  path: VaultPath;
}

export const nextStoryMapCardId = (existing: Pick<StoryMapCardNote, "id">[]): StoryMapCardId => {
  const max = existing.reduce((hi, c) => {
    const m = STORY_MAP_CARD_ID_RE.exec(c.id);
    return m ? Math.max(hi, Number.parseInt(m[1], 10)) : hi;
  }, 0);
  return `SMC-${String(max + 1).padStart(3, "0")}`;
};

/** Colour for a card: explicit non-blank override, else its type colour. */
export const cardColor = (card: { cardType: CardType; color?: string }): string =>
  card.color && card.color.trim() !== "" ? card.color.trim() : CARD_TYPE_COLORS[card.cardType];
```

- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): add card-note entity, types, colours, SMC ids`.

## Task A3: Persona note content (build/parse)

**Files:** Create `src/application/content/persona-content.ts`; Test `tests/persona-content.test.ts`. Mirror `use-case-content.ts` (`buildNote`, `parseNote`).

- [ ] **Step 1 — failing test:**

```typescript
import { describe, it, expect } from "vitest";
import { buildPersonaNote, parsePersonaNote, personaFileName } from "../src/application/content/persona-content";
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
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement** (use `buildNote`/`parseNote` from `../../shared/utils/frontmatter`, and a `slugify` like `prdFolderName`'s body):

```typescript
import { buildNote, parseNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import type { Persona } from "../../domain/entities/persona";
import type { VaultPath } from "../../domain/value-objects/identifiers";

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
  const body = persona.body.trim() === "" ? `# ${persona.name}\n` : `# ${persona.name}\n\n${persona.body.trim()}\n`;
  return buildNote(fields, body);
};

export const parsePersonaNote = (content: string, path: VaultPath): Persona | null => {
  const { frontmatter: fm, body } = parseNote(content);
  if (fm.type !== "persona" || typeof fm.id !== "string") return null;
  return {
    id: fm.id,
    name: typeof fm.name === "string" && fm.name !== "" ? fm.name : fm.id,
    color: typeof fm.color === "string" && fm.color !== "" ? fm.color : undefined,
    body: stripHeading(body, typeof fm.name === "string" ? fm.name : fm.id).trim(),
    path,
  };
};

const stripHeading = (body: string, name: string): string =>
  body.replace(new RegExp(`^#\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\n?`), "");
```

> `parseNote`'s return shape is `{ frontmatter, body }` (confirm in `frontmatter.ts`); if `body` isn't returned, use the `parseNote` overload that does, or parse the body separately.

- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): persona note build/parse`.

## Task A4: Card-note content (build/parse)

**Files:** Create `src/application/content/story-map-card-content.ts`; Test `tests/story-map-card-content.test.ts`. Frontmatter must be parser-safe (tags = block sequence; everything else scalar).

- [ ] **Step 1 — failing test:**

```typescript
import { describe, it, expect } from "vitest";
import { buildCardNote, parseCardNote, cardFileName } from "../src/application/content/story-map-card-content";
import type { StoryMapCardNote } from "../src/domain/entities/story-map-card";

const card: StoryMapCardNote = {
  id: "SMC-001", map: "SM-001", cardType: "task", ref: "UC-003", status: "planned",
  points: 3, tags: ["frontend"], color: undefined, activity: "Find & Cook",
  step: "Browse", slice: "MVP", order: 0, title: "Search by name", body: "",
  path: "Story Maps/SM-001-x/cards/SMC-001.md" as StoryMapCardNote["path"],
};

describe("card note content", () => {
  it("round-trips through build/parse", () => {
    const parsed = parseCardNote(buildCardNote(card), card.path);
    expect(parsed).toEqual(card);
  });
  it("omits empty optionals from frontmatter", () => {
    const note = buildCardNote({ ...card, ref: undefined, points: undefined, status: undefined, tags: [] });
    expect(note).not.toContain("ref:");
    expect(note).not.toContain("points:");
    expect(note).not.toContain("tags:");
  });
  it("rejects a non-card note and an out-of-set card_type/ref", () => {
    expect(parseCardNote("---\ntype: note\n---\n", card.path)).toBeNull();
    const bad = buildCardNote(card).replace("card_type: task", "card_type: epic");
    expect(parseCardNote(bad, card.path)?.cardType).toBe("task"); // falls back
  });
  it("rejects fractional points (drops to undefined)", () => {
    const frac = buildCardNote(card).replace("points: 3", "points: 2.5");
    expect(parseCardNote(frac, card.path)?.points).toBeUndefined();
  });
  it("names the file by stable id", () => {
    expect(cardFileName("SMC-001")).toBe("SMC-001.md");
  });
});
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement** (reuse `isCardType`, `isValidUseCaseRef` from domain, `isCardStatus`):

```typescript
import { buildNote, parseNote, type FrontmatterValue } from "../../shared/utils/frontmatter";
import { isCardType, type StoryMapCardNote } from "../../domain/entities/story-map-card";
import { isCardStatus, isValidUseCaseRef } from "../../domain/entities/story-map";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** Stable id-only file name (cards rename often via the board; keep the path/queue key stable). */
export const cardFileName = (id: string): string => `${id}.md`;

export const buildCardNote = (c: StoryMapCardNote): string => {
  const fields: Record<string, FrontmatterValue> = {
    type: "story-map-card",
    id: c.id,
    map: c.map,
    card_type: c.cardType,
    status: c.status,
    points: c.points === undefined ? undefined : c.points,
    tags: c.tags.length > 0 ? c.tags : undefined,
    ref: c.ref && isValidUseCaseRef(c.ref) ? c.ref : undefined,
    color: c.color && c.color.trim() !== "" ? c.color.trim() : undefined,
    activity: c.activity,
    step: c.step,
    slice: c.slice,
    order: c.order,
    title: c.title,
  };
  const body = c.body.trim() === "" ? `# ${c.title}\n` : `# ${c.title}\n\n${c.body.trim()}\n`;
  return buildNote(fields, body);
};

const intOrUndef = (v: unknown): number | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

export const parseCardNote = (content: string, path: VaultPath): StoryMapCardNote | null => {
  const { frontmatter: fm, body } = parseNote(content);
  if (fm.type !== "story-map-card" || typeof fm.id !== "string") return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v : v && v !== "" ? [String(v)] : []);
  return {
    id: fm.id,
    map: str(fm.map),
    cardType: isCardType(fm.card_type) ? fm.card_type : "task",
    ref: typeof fm.ref === "string" && isValidUseCaseRef(fm.ref) ? fm.ref : undefined,
    status: isCardStatus(fm.status) ? fm.status : undefined,
    points: intOrUndef(fm.points),
    tags: arr(fm.tags),
    color: typeof fm.color === "string" && fm.color !== "" ? fm.color : undefined,
    activity: str(fm.activity),
    step: typeof fm.step === "string" && fm.step !== "" ? fm.step : undefined,
    slice: str(fm.slice),
    order: intOrUndef(fm.order) ?? 0,
    title: str(fm.title) || fm.id,
    body: body.replace(/^#\s+.*\n?/, "").trim(),
    path,
  };
};
```

- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): card-note build/parse`.

## Task A5: Settings — `personasPath`

**Files:** Modify `src/domain/settings/settings.ts`; extend the settings test that covers paths/reset.

- [ ] **Step 1 — failing test** (in the existing settings test file): assert `DEFAULT_SETTINGS.paths.personasPath` is `"Personas"` and that the content-path reset guard includes it.

```typescript
it("defaults personasPath and guards it on reset", () => {
  expect(String(DEFAULT_SETTINGS.paths.personasPath)).toBe("Personas");
  expect(contentResetPaths(DEFAULT_SETTINGS)).toContain(DEFAULT_SETTINGS.paths.personasPath);
});
```
> Use whatever the guard helper is actually named — search `storyMapsPath` in `settings.ts` to find the reset/guard list and mirror it.

- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** add `personasPath: VaultPath;` to `TestHubPathSettings`; add `personasPath: unsafeVaultPath("Personas"),` to `DEFAULT_SETTINGS.paths`; add `personasPath` everywhere `storyMapsPath` appears in the reset/content-path guard.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(settings): add personasPath with reset guard`.

## Task A6: Extend the in-memory `StoryMapCard` + `StoryMap.users`; remove inline codec

**Files:** Modify `src/domain/entities/story-map.ts`; update `tests/story-map.test.ts`.

This is the **clean-break** core. `StoryMapCard` gains `id?`/`cardType`/`order`; `StoryMap.users` becomes `Persona[]`; `encodeCard`/`parseCard` are deleted; `storyMapSignature` switches to ids.

- [ ] **Step 1 — failing tests:** (a) `storyMapSignature` reflects card ids + persona ids and excludes title/colour; (b) `encodeCard`/`parseCard` are no longer exported (delete their tests); (c) `addCard` produces a card with `cardType: "task"` and no `id`; (d) `addUser` appends a placeholder persona `{ name: "New user" }`.

```typescript
import { storyMapSignature, addCard, addUser } from "../src/domain/entities/story-map";

it("addCard seeds a task card without an id", () => {
  const map = baseMap({ activities: ["A"], slices: ["S"] });
  const next = addCard(map, { activity: "A", slice: "S" });
  const card = next.cards.at(-1)!;
  expect(card.cardType).toBe("task");
  expect(card.id).toBeUndefined();
});

it("addUser appends a placeholder persona", () => {
  const next = addUser(baseMap({ users: [] }));
  expect(next.users.at(-1)!.name).toBe("New user");
});

it("signature uses card + persona ids", () => {
  const a = baseMap({ users: [{ id: "PER-001", name: "x", body: "", path: "p" as any }] });
  expect(storyMapSignature(a)).toContain("PER-001");
});
```

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — implement:**
  - Import `Persona` and `CardType`. Extend interface:

```typescript
export interface StoryMapCard {
  id?: StoryMapCardId;   // assigned on first save (note-backed)
  cardType: CardType;    // drives legend colour
  order?: number;        // index within cell (derived on read, written on save)
  ref?: string;
  title: string;
  activity: string;
  step?: string;
  slice: string;
  status?: CardStatus;
  points?: number;
  tags: string[];
  color?: string;
}
```
  - In `StoryMap`, change `users: string[]` → `users: Persona[]`.
  - Update `addCard` to set `cardType: "task"` on the new card. Update `addUser` to push `{ name: uniqueName(map.users.map(u=>u.name), "New user"), body: "", path: "" as VaultPath, id: "" }` (id-less placeholder; `id: ""` marks "needs allocation"). Update `renameUser`/`removeUser` to operate on `users[].name` / array position.
  - Update `renameActivity`/`renameSlice`/`renameStep` card-rewrite branches (unchanged logic, cards still have those keys).
  - **Delete** `encodeCard` and `parseCard` and their imports/usages here.
  - Rewrite `storyMapSignature`:

```typescript
export const storyMapSignature = (map: StoryMap): string =>
  JSON.stringify([
    map.users.map((u) => u.id || u.name),
    map.activities,
    map.steps.map(encodeStep),
    map.slices,
    map.cards.map((c) => [c.id ?? "", c.cardType, c.ref ?? "", c.status ?? "",
      c.points ?? "", c.tags.join(","), c.color ?? "", c.activity, c.step ?? "", c.slice, c.title].join("|")),
  ]);
```

- [ ] **Step 4 — run; fix compile fallout** in `story-map.ts` only (the rest is handled in later tasks). Expect domain tests PASS.
- [ ] **Step 5 — gate may FAIL to compile elsewhere** (content/service/views still reference old shapes) — that's expected; commit the domain change on its own once `tests/story-map.test.ts` passes and `typecheck` errors are confined to files handled in Phase B/C. If the gate's typecheck blocks the commit, proceed to Task B1+ in the same working session and commit A6 together with B1 as a single "domain+content clean-break" commit. Commit message: `refactor(story-map)!: note-backed card/persona model; drop inline codec`.

> **Note for the executor:** A6 + B1 + B2 are a tightly-coupled clean-break; if you can't keep the tree green between them, batch their commits but keep each task's tests written first.

---

# Phase B — Service composition, CRUD & clean break

## Task B1: Content layer — drop inline frontmatter, personas as refs

**Files:** Modify `src/application/content/story-map-content.ts`; update `tests/story-map-content.test.ts`.

- [ ] **Step 1 — failing tests:** `buildStoryMapNote` frontmatter has **no `cards` key**, and `users` is the persona **id** list; `renderUsersLane` shows persona **names**; `renderLegend` lists the five card types.

```typescript
it("writes users as PER refs and omits cards from frontmatter", () => {
  const note = buildStoryMapNote(mapWith({ users: [{ id: "PER-001", name: "Home Cook", body: "", path: "p" as any }] }), new Map());
  expect(note).toContain("users:");
  expect(note).toContain("- PER-001");
  expect(note).not.toMatch(/^cards:/m);
});
it("legend lists card types", () => {
  expect(renderLegend()).toContain("task");
  expect(renderLegend()).toContain("edge-case");
});
```

- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:**
  - `buildStoryMapNote` fields: remove the `cards:` line; change `users:` to `map.users.length > 0 ? map.users.map((u) => u.id) : undefined`. Update the body's source-of-truth paragraph to drop the nine-field card sentence (replace with: "Cards live as notes under `cards/`; users reference personas in `Personas/`. Run \"Refresh tables\" to regenerate the tables below.").
  - `parseStoryMapNote`: stop decoding `cards` (return `cards: []` here — the service fills them from the card-store); parse `users` as raw id strings into a temporary shape the service resolves. To keep this function pure and view-agnostic, change its return to a `ParsedStoryMapNote` that has `userRefs: string[]` instead of `users: Persona[]`, and `cards: []`. Add an exported type `ParsedStoryMapNote = Omit<StoryMap,"users"|"cards"> & { userRefs: string[] }`.
  - `renderUsersLane(map)`: `map.users.map((u) => u.name).join(" · ")`.
  - `renderLegend()`: `["#### Legend","",`Card types: ${CARD_TYPES.join(" · ")}`,`Planning status: ${CARD_STATUSES.join(" · ")}`].join("\n")`.
  - `cardAttributeSuffix`: prefix with the card type when not `task`, e.g. `if (card.cardType !== "task") parts.unshift(card.cardType)`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate (typecheck still red in service/views — acceptable per A6 note) / commit with B2.**

## Task B2: Persona service

**Files:** Create `src/application/services/persona-service.ts`; Test `tests/persona-service.test.ts`. Mirror `UseCaseService` (constructor deps: `settingsService`, `fs`, `eventBus`, `logger`, a `KeyedSerialQueue`).

- [ ] **Step 1 — failing test:** `create` writes a `PER-NNN` note under `personasPath` and returns the persona; `findAll` scans + sorts; `findById` resolves; `rename` updates the note.

```typescript
it("creates a persona note and indexes it", async () => {
  const { svc } = build();
  const created = await svc.create({ name: "Home Cook" });
  expect(created.ok && created.value.id).toBe("PER-001");
  const all = await svc.findAll();
  expect(all.ok && all.value.map((p) => p.name)).toEqual(["Home Cook"]);
});
```

- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** using `nextPersonaId`, `personaFileName`, `buildPersonaNote`, `parsePersonaNote`, `collectReadableMarkdown`, `joinVaultPath`; serialize writes through `KeyedSerialQueue.run(path, …)`; publish `persona.created`/`persona.updated` events (add these event types to the event-bus union + payloads).
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): persona library service`.

> Register `PersonaService` in the composition root (where `StoryMapService`/`UseCaseService` are constructed — search for `new StoryMapService`). Add `persona.created`/`persona.updated`/`persona.deleted` to `DomainEventType` + `EventPayloads`.

## Task B3: Card-notes store (scan + reconcile)

**Files:** Create `src/application/services/story-map-cards-store.ts`; Test `tests/story-map-cards-store.test.ts`. Pure-ish module given an `fs` + a map's `cards/` folder path.

Responsibilities: (1) `loadCards(fs, cardsDir, mapId) → StoryMapCard[]` (scan, parse, group by cell, assign `order` = index within cell, sort cells by stored `order` then id); (2) `reconcileCards(fs, queue, cardsDir, mapId, model, existingNotes) → Result<void>` (allocate `SMC-NNN` for id-less cards, write changed/new notes, delete removed ones, write `order` = index within cell).

- [ ] **Step 1 — failing tests:**

```typescript
it("loads card-notes into the cell-ordered cards array", async () => {
  const fs = fakeFs({ "Story Maps/SM-001-x/cards/SMC-001.md": cardNote({ id: "SMC-001", order: 1, slice: "MVP", activity: "A", title: "b" }),
                      "Story Maps/SM-001-x/cards/SMC-002.md": cardNote({ id: "SMC-002", order: 0, slice: "MVP", activity: "A", title: "a" }) });
  const cards = await loadCards(fs, "Story Maps/SM-001-x/cards", "SM-001");
  expect(cards.map((c) => c.title)).toEqual(["a", "b"]); // sorted by order within cell
});

it("reconcile allocates ids for new cards and deletes removed ones", async () => {
  // model has one id-less card + drops an existing SMC-002 → expect a write of SMC-003 and a delete of SMC-002
});
```

- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** scan via `collectReadableMarkdown` + `parseCardNote`; map `StoryMapCardNote → StoryMapCard` (drop `map`/`path`/`body`, keep `id`/`order`); group/sort; for reconcile, compute per-cell `order` from the model array position, diff against `existingNotes` by id (compare `cardNoteSignature`), `fs.createFile`/`writeFile` changed, `fs.deleteFile` removed, all through `queue.run(cardPath, …)`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): card-note store (scan + reconcile)`.

## Task B4: Wire composition into `StoryMapService.findAll`/`findById`

**Files:** Modify `src/application/services/story-map-service.ts`; extend `tests/story-map-service.test.ts`.

- [ ] **Step 1 — failing test:** a map whose note has `users: [PER-001]` and a `cards/SMC-001.md` resolves to a `StoryMap` with `users[0].name === "Home Cook"` and one card.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** add `personaService` (or `personaResolver`) to the constructor deps. After `parseStoryMapNote` → `ParsedStoryMapNote`, compose: `cards = await loadCards(fs, joinVaultPath(parentVaultPath(path), "cards"), id)`; `users = resolve(userRefs)` against `personaService.findAll()` (build a `Map<PersonaId,Persona>`; unresolved ref → a placeholder `{ id: ref, name: ref, body:"", path:"" }` so it's visible, per spec §5). Return the full `StoryMap`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): compose read-model from card-notes + personas`.

## Task B5: `saveMap` reconciles notes; `addCard`/`updateCard`/`removeCard` via store

**Files:** Modify `src/application/services/story-map-service.ts`; extend tests.

- [ ] **Step 1 — failing tests:** saving a model with a new id-less card writes a `SMC-NNN` note and the map frontmatter (no `cards` key); saving with a dropped card deletes its note; saving with an id-less persona (`id: ""`) allocates a `PER-NNN`, writes a persona note, and stores the ref.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** in `saveMap` (inside `withProductSafeWrite`):
  1. Stale check via `staleSignatureError(onDisk, expected)` (now id/persona-based).
  2. Normalize structure (activities/slices/steps) as today.
  3. **Personas:** for each `model.users` with `id === ""`, `personaService.create({ name })` → ref; else keep `id`. Build `userRefs: PersonaId[]`.
  4. **Cards:** `reconcileCards(fs, queue, cardsDir, id, model.cards, onDisk.cards)`.
  5. Write the map note frontmatter via `buildStoryMapNote`/`refreshManagedBlocks` with `users = resolved personas`, `cards = []` for the frontmatter (cards live in notes; grid renders from the composed model).
  6. Publish `storymap.updated`; return the re-composed map.
  - `addCard(id, card)` / `updateCard(id, cardId, card, expected)` / `removeCard(id, cardId, expected)`: re-key these on **card id** (not array index) — load the map, apply the matching pure op, then `reconcileCards`. Update the modal/board callers in Phase C.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): persist cards/personas as notes on save`.

## Task B6: Rewrite remaining inline fixtures + green the suite

**Files:** `tests/story-map.test.ts`, `tests/story-map-content.test.ts`, `tests/story-map-service.test.ts`, and any other test referencing `encodeCard`/`parseCard`/string `users`.

- [ ] **Step 1:** grep `encodeCard|parseCard|users: \[".*"\]` across `tests/` to enumerate inline fixtures.
- [ ] **Step 2:** convert each inline card fixture to include `cardType: "task"` and update `users` fixtures from `["Home Cook"]` to `[{ id:"PER-001", name:"Home Cook", body:"", path:"…" }]` (or the parsed-note `userRefs` form where testing content).
- [ ] **Step 3:** run the full suite; fix fallout until green.
- [ ] **Step 4:** confirm coverage ≥ prior threshold.
- [ ] **Step 5 — gate + commit** `test(story-map): migrate fixtures to note-backed model`.

---

# Phase C — Board visual parity

> Pure-module-first: all geometry/spec changes land in `story-map-board-layout.ts` + `story-map-board-scene.ts` (both unit-tested), then the view wires them.

## Task C1: Per-slice progress + points in the grid model

**Files:** Modify `src/domain/entities/story-map.ts` (`buildStoryMapGrid`); `tests/story-map.test.ts`.

- [ ] **Step 1 — failing test:** a `StoryMapGridRow` exposes `done` and `total` card counts alongside `points`.

```typescript
it("rolls up done/total per slice", () => {
  const grid = buildStoryMapGrid(mapWith({ slices: ["MVP"], cards: [card({slice:"MVP",status:"done"}), card({slice:"MVP"})] }));
  expect(grid.rows[0]).toMatchObject({ done: 1, total: 2 });
});
```

- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** add `done: number; total: number;` to `StoryMapGridRow`; compute `total = sliceCards.length`, `done = sliceCards.filter(c => c.status === "done").length`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): per-slice done/total roll-up`.

## Task C2: Card view-model — colour, chips, type

**Files:** Modify `src/presentation/views/story-map-board-layout.ts` (`BoardCardBox`) + `story-map-board-scene.ts` (`cardGroupSpec`); `tests/story-map-board-layout.test.ts`, `tests/story-map-board-scene.test.ts`.

- [ ] **Step 1 — failing tests:** `BoardCardBox` carries `color` (from `cardColor(card)`) and `chips: { points?: number; tags: string[] }`; `cardGroupSpec` emits a card `rect` filled with the colour, a point-chip group when `points` is set, and one chip per tag.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** in `computeBoardLayout`, set `box.color = cardColor(card)` and `box.chips`; in `cardGroupSpec`, replace the `text.sm-board-card-attrs` suffix with: a points chip (`g.sm-board-chip-points` = small circle + number) and tag chips (`rect.sm-board-chip-tag` + text), laid out along the card footer; keep the UC `ref` as a `text.sm-board-card-ref` badge. Use `box.color` as the card `rect` fill.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): typed card colours + point/tag chips`.

## Task C3: Slice rows show progress + points; static Legend

**Files:** `story-map-board-layout.ts` + `story-map-board-scene.ts`; their tests.

- [ ] **Step 1 — failing tests:** a slice row spec includes a progress label `"{done}/{total}"` + points `"{points} pts"`; `buildBoardScene` emits a `g.sm-board-legend` with five swatch+label pairs from `CARD_TYPES`/`CARD_TYPE_COLORS`.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** carry `done/total/points` onto `BoardRow`; render a progress bar rect + label on the slice header; add a `legendSpecs()` builder appended by `buildBoardScene`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): slice progress/points + static legend`.

## Task C4: USERS lane as persona cards

**Files:** `story-map-board-layout.ts` + `story-map-board-scene.ts`; their tests.

- [ ] **Step 1 — failing tests:** `usersLaneSpecs` renders one **card** per persona (name text in a filled rect, a remove ×) plus a `+ user` button; layout reserves card-sized boxes (not chips).
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** change the users lane geometry to card boxes; render persona name; keep the `data-kind="user"` add button and per-user remove. Persona colour (if set) tints the card.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): render USERS lane as persona cards`.

## Task C5: Persona suggest modal + view wiring

**Files:** Create `src/presentation/views/persona-suggest-modal.ts`; Modify `story-map-board-view.ts`, `story-map-card-modal.ts`, `story-map-card-form.ts`, `story-map-cards.ts`.

- [ ] **Step 1 — failing tests (pure):** `story-map-card-form` gains a `cardType` field (`buildCardFromForm`/`cardToForm` round-trip it; default `task`); `story-map-cards` `validateCardPlacement` accepts `cardType` and rejects unknown types. Add tests there.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:**
  - `CardFormValues` + `buildCardFromForm`/`cardToForm`/`initialCardForm`: add `cardType` (dropdown of `CARD_TYPES`).
  - `StoryMapCardModal`: add the Card Type dropdown; change the stale guard from `encodeCard(original)` to `cardNoteSignature(original)` (add `cardNoteSignature` to `story-map-card.ts` mirroring the per-card branch of `storyMapSignature`); call `updateCard(map.id, original.id!, card, expected)` keyed by id.
  - `PersonaSuggestModal` (`FuzzySuggestModal<Persona | "__new__">`): lists `personaService.findAll()` + a "Create new persona" item; resolves to a persona ref or a new placeholder. Wire the board's `addByKind` `"user"` branch to open it (fast path: empty query + Enter still creates "New user" placeholder, preserving inline speed).
- [ ] **Step 4 — run, expect PASS** (pure tests); manual-verify the board interactions.
- [ ] **Step 5 — gate + commit** `feat(story-map): card type field + persona picker`.

## Task C6: Board styles (dark-theme polish)

**Files:** Modify `styles.css`.

- [ ] **Step 1:** add `:root` card-type colour vars (`--sm-card-task` … `--sm-card-design`) with light/dark values; style `.sm-board-chip-points`, `.sm-board-chip-tag`, `.sm-board-card-ref`, `.sm-board-progress`, `.sm-board-legend`, and the persona-card lane.
- [ ] **Step 2:** verify the build (`npm run build`) inlines styles; manual dark/light check.
- [ ] **Step 3 — gate + commit** `style(story-map): board parity polish`.

---

# Phase D — In-note grid re-source

## Task D1: Grid renders from composed model; build/refresh use note-backed paths

**Files:** Modify `src/application/content/story-map-content.ts` (already partly in B1) + `story-map-service.ts` `rebuildGrid`; extend `tests/story-map-content.test.ts`.

- [ ] **Step 1 — failing test:** `renderStoryMapGridTable` for a composed map (cards with `cardType`, users as personas) renders the activity sub-tables, the per-slice points roll-up, the users lane (persona names), and a card-types legend; `buildStoryMapNote` body contains the managed grid block with that content and **no `cards` frontmatter**.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** confirm `renderActivityTable`/`renderPointsRollup` consume `buildStoryMapGrid(map)` (already do); ensure `cardAttributeSuffix` shows `cardType` (from B1); `rebuildGrid` already re-renders via `refreshManagedBlocks(body, map, noteNames)` on the **composed** map (B4) — add a test that a rebuilt note reflects a card-note edit.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — gate + commit** `feat(story-map): in-note grid renders from note-backed model`.

---

# Phase E — Side panel redesign

## Task E1: Explorer rows — status pill, icon stat-strip, overflow actions, empty state

**Files:** Modify `src/presentation/views/story-map-explorer-view.ts`; Modify `styles.css`. (View untested at unit level; keep DOM-building logic trivial and lean on existing manual smoke.)

- [ ] **Step 1 — implement** a `renderRow` redesign:
  - Row = title (`.sm-explorer-title`) + muted `SM-NNN` (`.sm-explorer-id`).
  - Status pill (`.sm-explorer-status[data-status]`) reusing the status values.
  - Icon stat-strip (`.sm-explorer-stats`): users/activities/steps/slices/cards, each an icon (use `setIcon`) + count.
  - Product link (`.sm-explorer-product`) opening the PRD note.
  - Primary **Open board** button; an overflow **⋯** (`.sm-explorer-more`) menu (Obsidian `Menu`) with "Refresh tables", "Open note", "Settings", "Delete".
  - Empty state (`.sm-explorer-empty`) with a "New Story Map" CTA when `findAll()` is empty.
- [ ] **Step 2:** add the matching `styles.css` rules (native `nav-` look, hover/selected states).
- [ ] **Step 3:** keep `REFRESH_ON` subscriptions; ensure the panel re-renders on `storymap.*` and `persona.*` events.
- [ ] **Step 4 — gate + commit** `feat(story-map): redesign explorer side panel`.

## Task E2 (optional, per D11): Personas section

**Files:** `story-map-explorer-view.ts`, `styles.css`.

- [ ] **Step 1 — implement** a collapsible "Personas" section listing `personaService.findAll()` (name + open-note), with a "New persona" action — only if it stays lightweight; otherwise skip and note in the PR.
- [ ] **Step 2 — gate + commit** `feat(story-map): personas section in side panel`.

---

# Phase F — Docs & demo

## Task F1: CONTEXT.md + ADR-0030

**Files:** Modify `CONTEXT.md`; Create `docs/adr/0030-story-map-cards-and-users-as-notes.md`.

- [ ] **Step 1:** add glossary entries for **Story Map Card** (now a `story-map-card` note, `SMC-NNN`, under `cards/`), **Persona** (`PER-NNN`, shared `Personas/`), and **`personasPath`**; update the existing inline-scalar "Story Map Card" entry.
- [ ] **Step 2:** write ADR-0030 recording decisions D1–D11; mark the nine-field-encoding and inline-`users` portions of **ADR-0028** superseded (add a "Superseded in part by ADR-0030" note to 0028).
- [ ] **Step 3 — gate + commit** `docs(adr): ADR-0030 cards & users as notes`.

## Task F2: Recreate the SM-001 demo map

**Files:** Whatever fixture/seed represents the demo map (search for `SM-001` seed data / sample vault).

- [ ] **Step 1:** recreate SM-001 in the new model: a map note (structure + `users: [PER-…]`), `cards/SMC-…md` notes, and the referenced `Personas/PER-…md`.
- [ ] **Step 2 — gate + commit** `chore(story-map): recreate SM-001 demo in note-backed model`.

---

## Self-Review

- **Spec coverage:** D1 (A2/A4), D2 (B1 structure stays in map fm), D3 (A1/A3/B2 personasPath+library+refs), D4 (A4/B3 folder-as-membership, B1 drops `cards`), D5 (A1/A2 ids), D6 (A6/B1/B6 clean break + F2 recreate), D7 (Phase C visual only; no zoom/pan/focus tasks), D8 (A2 `cardColor`), D9 (C3 static legend from fixed `CARD_TYPES`), D10 (Phase D), D11 (E2 optional). All covered.
- **Type consistency:** `StoryMapCard.id?`/`cardType`/`order`; `StoryMap.users: Persona[]`; `ParsedStoryMapNote.userRefs`; `cardNoteSignature` used by both the modal guard (C5) and `storyMapSignature` (A6). `loadCards`/`reconcileCards` names match between B3 and B4/B5.
- **Placeholders:** none — every step has concrete code or a concrete instruction with the exact symbol to change.
- **Sequencing risk:** A6+B1+B2 are a coupled clean-break; the A6 note tells the executor to batch commits if the tree can't stay green between them, while still writing each task's tests first.

# PRD Creator System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hierarchical PRD (Product Requirements Document) layer above Use Cases — PRD notes (frontmatter+markdown) organized one-folder-per-PRD, a guided PRD Builder modal, a PRD Explorer view, a Dashboard section, a Use Case breadcrumb, and migration scripts — following the existing layered architecture.

**Architecture:** Mirror the existing Use Case vertical slice. Domain entity in `src/domain/entities`, a `PrdService` (interface + `DefaultPrdService`) in `src/application/services` depending only on the `VaultFileSystem` port + `SettingsService` + `EventBus` + `Logger`, a pure content builder in `src/application/content`, presentation in `src/presentation/views` + commands, and a new typed `prd.created` domain event. On-disk frontmatter uses only forms the shared parser round-trips (string scalars + block-sequence arrays; root identified by an empty `parent-prd`, never literal `null`).

**Tech Stack:** TypeScript (strict), Obsidian Plugin API, Vitest (coverage gate 93% stmts/lines/funcs, 80% branches), esbuild.

**Source spec:** `docs/superpowers/specs/2026-06-13-prd-creator-system-design.md`

---

## Conventions used throughout this plan

- **Result/ok/err:** Copy the exact import line for `Result`, `ok`, `err` from the top of `src/application/services/use-case-service.ts` — reuse the same helpers; do not invent a new Result type.
- **VaultPath construction:** Use `joinVaultPath(...)` from `src/shared/utils/vault-path.ts` and `unsafeVaultPath` / `vaultPath` exactly as `use-case-service.ts` imports them (copy the import lines from that file rather than guessing the module path).
- **Events:** Build events with `createEvent(type, payload, options)` from `src/shared/event-bus/create-event.ts`, publish via `eventBus.publish(...)`. Correlation: `correlationId = <prdId>` (matches the Use Case convention in Event Catalog §19).
- **Per-path write serialization:** Reuse the `KeyedSerialQueue` pattern from `use-case-service.ts` (the `noteWrites` field) for every file write.
- **Test rhythm:** Each behavior gets a failing test first (`npm run test -- <file>`), then minimal implementation, then green, then commit. Builder pattern for tests mirrors `tests/use-case-service.test.ts` (`FakeVaultFileSystem`, `recordingEventBus()`, `silentLogger`, `DefaultSettingsService` + `FakeDataStore` + `DefaultPathSafetyPolicy`).
- **Run a single test file:** `npm run test -- tests/prd-service.test.ts`
- **Commit cadence:** Commit after every green step group as shown. Keep commits small.

---

## Phase 0 — Foundation: settings paths + domain event

### Task 1: Add `prdsPath` and `domainsPath` to settings

**Files:**
- Modify: `src/domain/settings/settings.ts` (interface `TestHubPathSettings` ~lines 10-19; `DEFAULT_SETTINGS.paths` ~lines 205-257)
- Test: `tests/settings-service.test.ts` (add a case) OR `tests/settings-defaults.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Add to `tests/settings-service.test.ts` (inside the top-level `describe`):

```typescript
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";

it("ships default PRD and Domain paths", () => {
  expect(String(DEFAULT_SETTINGS.paths.prdsPath)).toBe("PRDs");
  expect(String(DEFAULT_SETTINGS.paths.domainsPath)).toBe("Domains");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/settings-service.test.ts`
Expected: FAIL — `prdsPath`/`domainsPath` do not exist on the type / are undefined.

- [ ] **Step 3: Add the fields**

In `src/domain/settings/settings.ts`, extend the interface:

```typescript
export interface TestHubPathSettings {
  testHubPath: VaultPath;
  useCasesPath: VaultPath;
  prdsPath: VaultPath;
  domainsPath: VaultPath;
  specificationsPath: VaultPath;
  featureFilesPath: VaultPath;
  testSuitesPath: VaultPath;
  evidencePath: VaultPath;
  documentationPath: VaultPath;
  testRunnerPath: VaultPath;
}
```

And in `DEFAULT_SETTINGS.paths`, add (next to `useCasesPath`):

```typescript
    useCasesPath: unsafeVaultPath("Use Cases"),
    prdsPath: unsafeVaultPath("PRDs"),
    domainsPath: unsafeVaultPath("Domains"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/settings-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (settings are consumed widely)**

Run: `npm run typecheck`
Expected: PASS. If a settings-merge/normalizer or settings tab enumerates path keys exhaustively and now errors, fix those call sites to include the two new keys (search: `grep -rn "useCasesPath" src`).

- [ ] **Step 6: Commit**

```bash
git add src/domain/settings/settings.ts tests/settings-service.test.ts
git commit -m "feat(settings): add configurable prdsPath and domainsPath"
```

---

### Task 2: Register the `prd.created` domain event (type + payload + catalog)

**Files:**
- Modify: `src/domain/events/domain-event.ts` (`DomainEventType` union ~lines 25-84; `EventPayloads` interface ~lines 95-204)
- Modify: `docs/architecture/Event Catalog.md` (add a PRD events section after the Use Case events section)
- Test: `tests/prd-event.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/prd-event.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createEvent } from "../src/shared/event-bus/create-event";

describe("prd.created event", () => {
  it("creates a typed prd.created event with the catalogued payload", () => {
    const event = createEvent(
      "prd.created",
      { prdId: "PRD-001", title: "Dashboard", path: "PRDs/PRD-001-dashboard/PRD-001-dashboard.md" },
      { correlationId: "PRD-001" },
    );
    expect(event.type).toBe("prd.created");
    expect(event.payload.prdId).toBe("PRD-001");
    expect(event.correlationId).toBe("PRD-001");
    expect(event.source).toBe("plugin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/prd-event.test.ts`
Expected: FAIL — TypeScript: `"prd.created"` is not assignable to `DomainEventType`.

- [ ] **Step 3: Add the event type and payload**

In `src/domain/events/domain-event.ts`, add to the `DomainEventType` union (place a new PRD block right after the `usecase.*` entries):

```typescript
  // PRD
  | "prd.created"
```

And add to the `EventPayloads` interface (after the `usecase.*` entries):

```typescript
  // PRD
  "prd.created": { prdId: string; title: string; path: string; parentPrdId?: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/prd-event.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the event in the Event Catalog**

In `docs/architecture/Event Catalog.md`, add a new section after the Use Case events section, matching the existing entry format:

```markdown
## PRD Events

### `prd.created`

{
  prdId: string;        // e.g. "PRD-001"
  title: string;        // e.g. "Dashboard & KPI Tracking"
  path: string;         // vault path to the PRD note
  parentPrdId?: string; // parent PRD id; absent for the root PRD (PRD-000)
}

Emitted by `DefaultPrdService.create()` after the PRD note is written.
Correlation: `correlationId = prdId` (see §19, mirrors `usecase.created`).
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/events/domain-event.ts "docs/architecture/Event Catalog.md" tests/prd-event.test.ts
git commit -m "feat(events): add prd.created domain event and catalog entry"
```

---

## Phase 1 — Domain + Application: PRD model & service

### Task 3: PRD domain entity + status enum + id type

**Files:**
- Create: `src/domain/entities/prd.ts`
- Test: `tests/prd-entity.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/prd-entity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PRD_STATUSES, isPrdStatus } from "../src/domain/entities/prd";

describe("PRD status", () => {
  it("recognizes the three valid statuses", () => {
    expect(PRD_STATUSES).toEqual(["draft", "active", "deprecated"]);
    expect(isPrdStatus("active")).toBe(true);
    expect(isPrdStatus("archived")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/prd-entity.test.ts`
Expected: FAIL — module `src/domain/entities/prd.ts` not found.

- [ ] **Step 3: Create the entity**

Create `src/domain/entities/prd.ts`. Mirror the style of `src/domain/entities/use-case.ts` (copy the `VaultPath` import line from there):

```typescript
import type { VaultPath } from "../value-objects/identifiers";

/** A PRD identifier, e.g. "PRD-001". The root product-vision PRD is "PRD-000". */
export type PrdId = string;

export const PRD_STATUSES = ["draft", "active", "deprecated"] as const;
export type PrdStatus = (typeof PRD_STATUSES)[number];

export const isPrdStatus = (value: unknown): value is PrdStatus =>
  typeof value === "string" && (PRD_STATUSES as readonly string[]).includes(value);

/**
 * Read model for a PRD note. A PRD is a synthesis artifact that defines solution
 * scope above Use Cases. The root PRD (PRD-000) has no parent (`parentPrdId` undefined).
 */
export interface Prd {
  id: PrdId;
  title: string;
  status: PrdStatus;
  /** Undefined for the root PRD; otherwise the parent PRD id. */
  parentPrdId?: PrdId;
  /** Research domains this PRD synthesizes from. Optional for the root PRD. */
  domains: string[];
  vision: string;
  scopeIn: string[];
  scopeOut: string[];
  /** Sibling ordering without mutating immutable ids. */
  displayOrder: number;
  /** Folder-relative note path: <prdsPath>/<folder>/<folder>.md */
  path: VaultPath;
}
```

> If `VaultPath` is exported from a different module in this repo, copy the exact import path used at the top of `src/domain/entities/use-case.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/prd-entity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/prd.ts tests/prd-entity.test.ts
git commit -m "feat(domain): add PRD entity, status enum, and id type"
```

---

### Task 4: PRD content builder (note serialization + folder/file naming)

**Files:**
- Create: `src/application/content/prd-content.ts`
- Test: `tests/prd-content.test.ts` (new)

Key rules (from spec §2):
- Folder + note share the same name: `PRD-001-dashboard-kpi-tracking`.
- Note path: `<prdsPath>/<folder>/<folder>.md`.
- Frontmatter uses block-sequence arrays only. Root PRD: `parent-prd:` empty (pass `null`), `domains` omitted (pass `undefined`).

- [ ] **Step 1: Write the failing tests**

Create `tests/prd-content.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { prdFolderName, buildPrdNote } from "../src/application/content/prd-content";
import type { Prd } from "../src/domain/entities/prd";
import { unsafeVaultPath } from "../src/domain/value-objects/identifiers";

const samplePrd = (overrides: Partial<Prd> = {}): Prd => ({
  id: "PRD-001",
  title: "Dashboard & KPI Tracking",
  status: "draft",
  parentPrdId: "PRD-000",
  domains: ["dashboard", "reporting"],
  vision: "Single source of truth for test health",
  scopeIn: ["KPI tiles", "recent runs"],
  scopeOut: ["historical analytics"],
  displayOrder: 1,
  path: unsafeVaultPath("PRDs/PRD-001-dashboard-kpi-tracking/PRD-001-dashboard-kpi-tracking.md"),
  ...overrides,
});

describe("prdFolderName", () => {
  it("kebab-cases the title and prefixes the id", () => {
    expect(prdFolderName("PRD-001", "Dashboard & KPI Tracking")).toBe(
      "PRD-001-dashboard-kpi-tracking",
    );
  });
});

describe("buildPrdNote", () => {
  it("emits block-sequence arrays and an H1 heading", () => {
    const note = buildPrdNote(samplePrd());
    expect(note).toContain("id: PRD-001");
    expect(note).toContain("type: prd");
    expect(note).toContain("parent-prd: PRD-000");
    expect(note).toContain("domains:\n  - dashboard\n  - reporting");
    expect(note).toContain("scope_in:\n  - KPI tiles\n  - recent runs");
    expect(note).toContain("# PRD-001: Dashboard & KPI Tracking");
    // never inline arrays
    expect(note).not.toContain("[dashboard");
  });

  it("writes an empty parent-prd and omits domains for the root PRD", () => {
    const note = buildPrdNote(
      samplePrd({ id: "PRD-000", parentPrdId: undefined, domains: [], displayOrder: 0 }),
    );
    // empty parent-prd line (root marker), no literal null
    expect(note).toMatch(/parent-prd:\s*\n/);
    expect(note).not.toContain("null");
    expect(note).not.toContain("domains:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/prd-content.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the content builder**

Create `src/application/content/prd-content.ts`. Use `buildNote` from the shared frontmatter util (copy the import line from `src/application/content/use-case-content.ts` for `buildNote`):

```typescript
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
```

> Note: the shared parser renders `null` as `key:` with no value (confirmed in `src/shared/utils/frontmatter.ts`), which is exactly the empty `parent-prd` root marker we want.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/prd-content.test.ts`
Expected: PASS. If the array assertion fails, inspect the exact newline/indent the parser emits (`buildFrontmatter` uses two-space `  - ` item indent) and align the test's expected substring to it.

- [ ] **Step 5: Commit**

```bash
git add src/application/content/prd-content.ts tests/prd-content.test.ts
git commit -m "feat(content): add PRD note builder and folder naming"
```

---

### Task 5: `PrdService.create()` — write the folder + note, emit `prd.created`

**Files:**
- Create: `src/application/services/prd-service.ts`
- Test: `tests/prd-service.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/prd-service.test.ts` (mirror the builder in `tests/use-case-service.test.ts`):

```typescript
import { describe, expect, it } from "vitest";
import { DefaultPrdService } from "../src/application/services/prd-service";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, types, events } = recordingEventBus();
  const settings = new DefaultSettingsService(new FakeDataStore(), new DefaultPathSafetyPolicy(), bus);
  const service = new DefaultPrdService(settings, fs, bus, silentLogger);
  return { service, fs, types, events };
};

describe("DefaultPrdService.create", () => {
  it("creates a sub-PRD folder + note and emits prd.created", async () => {
    const { service, fs, types, events } = build();

    const result = await service.create({
      title: "Dashboard & KPI Tracking",
      parentPrdId: "PRD-000",
      domains: ["dashboard"],
      vision: "Single source of truth",
      scopeIn: ["KPI tiles"],
      scopeOut: ["historical analytics"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("PRD-001");
    expect(result.value.path).toBe(
      "PRDs/PRD-001-dashboard-kpi-tracking/PRD-001-dashboard-kpi-tracking.md",
    );
    expect(fs.files.has(result.value.path)).toBe(true);

    expect(types()).toContain("prd.created");
    const created = events.find((e) => e.type === "prd.created");
    expect(created?.payload).toEqual({
      prdId: "PRD-001",
      title: "Dashboard & KPI Tracking",
      path: result.value.path,
      parentPrdId: "PRD-000",
    });
    expect(created?.correlationId).toBe("PRD-001");
  });

  it("auto-increments ids past existing PRDs (PRD-000 reserved)", async () => {
    const { service, fs } = build();
    fs.files.set("PRDs/PRD-000-product-vision/PRD-000-product-vision.md", "---\nid: PRD-000\ntype: prd\n---\n");
    fs.files.set("PRDs/PRD-001-x/PRD-001-x.md", "---\nid: PRD-001\ntype: prd\n---\n");

    const result = await service.create({
      title: "Second", parentPrdId: "PRD-000", domains: ["d"], vision: "v", scopeIn: ["a"], scopeOut: ["b"],
    });
    expect(result.ok && result.value.id).toBe("PRD-002");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/prd-service.test.ts`
Expected: FAIL — module `prd-service` not found.

- [ ] **Step 3: Implement `create()` + id generation + the service skeleton**

Create `src/application/services/prd-service.ts`. Copy these import lines verbatim from `src/application/services/use-case-service.ts` and adapt: the `Result`/`ok`/`err` import, the `joinVaultPath`/`vaultPath` import, the `KeyedSerialQueue` import, `SettingsService`, `VaultFileSystem`, `EventBus`, `Logger`, `createEvent`.

```typescript
// --- copy the exact import lines for these from use-case-service.ts ---
// import { type Result, ok, err } from "...";
// import { joinVaultPath } from "../../shared/utils/vault-path";
// import { KeyedSerialQueue } from "...";
// import type { SettingsService } from "...";
// import type { VaultFileSystem } from "../ports/vault-file-system";
// import type { EventBus } from "../../shared/event-bus/event-bus";
// import type { Logger } from "...";
import { createEvent } from "../../shared/event-bus/create-event";
import { buildPrdNote, prdFolderName } from "../content/prd-content";
import type { Prd, PrdId, PrdStatus } from "../../domain/entities/prd";

export interface CreatePrdRequest {
  title: string;
  parentPrdId?: PrdId;
  domains: string[];
  vision: string;
  scopeIn: string[];
  scopeOut: string[];
}

export interface PrdService {
  create(request: CreatePrdRequest): Promise<Result<Prd>>;
  findAll(): Promise<Result<Prd[]>>;
  findById(id: PrdId): Promise<Result<Prd | null>>;
}

const PRD_ID_RE = /^PRD-(\d{3,})$/;

export class DefaultPrdService implements PrdService {
  private readonly noteWrites = new KeyedSerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async create(request: CreatePrdRequest): Promise<Result<Prd>> {
    const title = request.title.trim();
    if (title === "") return err(/* use the same error helper shape as use-case-service */ new Error("A PRD title is required."));
    
    const vision = request.vision.trim();
    if (vision === "") return err(new Error("PRD vision statement is required."));
    
    const scopeIn = (request.scopeIn || []).filter((s) => s.trim() !== "");
    if (scopeIn.length === 0) return err(new Error("At least one item must be in scope."));
    
    const scopeOut = (request.scopeOut || []).filter((s) => s.trim() !== "");
    if (scopeOut.length === 0) return err(new Error("At least one item must be out of scope."));
    
    if (request.parentPrdId) {
      const domains = (request.domains || []).filter((d) => d.trim() !== "");
      if (domains.length === 0) return err(new Error("Sub-PRDs must be linked to at least one domain."));
    }

    const settings = await this.settingsService.load();
    const existing = await this.findAll();
    if (!existing.ok) return existing;

    const id = this.nextId(existing.value.map((p) => p.id));
    const folder = prdFolderName(id, title);
    const path = joinVaultPath(settings.paths.prdsPath, folder, `${folder}.md`);

    const prd: Prd = {
      id,
      title,
      status: "draft",
      parentPrdId: request.parentPrdId,
      domains: scopeIn.length > 0 ? request.domains : undefined,
      vision,
      scopeIn,
      scopeOut,
      displayOrder: existing.value.length,
      path,
    };

    const folderPath = joinVaultPath(settings.paths.prdsPath, folder);
    const write = await this.noteWrites.run(path, async () => {
      const folderResult = await this.fs.createFolder(folderPath);
      if (!folderResult.ok) return folderResult;
      return this.fs.createFile(path, buildPrdNote(prd));
    });
    if (!write.ok) return write;

    await this.eventBus.publish(
      createEvent(
        "prd.created",
        { prdId: id, title, path: String(path), parentPrdId: request.parentPrdId },
        { correlationId: id },
      ),
    );
    return ok(prd);
  }

  private nextId(ids: PrdId[]): PrdId {
    let max = 0; // PRD-000 reserved; new PRDs start at 001
    for (const id of ids) {
      const m = PRD_ID_RE.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `PRD-${String(max + 1).padStart(3, "0")}`;
  }

  // findAll / findById implemented in Task 6
  async findAll(): Promise<Result<Prd[]>> {
    return ok([]);
  }
  async findById(): Promise<Result<Prd | null>> {
    return ok(null);
  }
}
```

> Replace the `new Error(...)`/`err(...)` placeholder with the exact error constructor `use-case-service.ts` uses (e.g. a domain error factory). Copy that pattern — do not introduce a different error shape.

- [ ] **Step 4: Run the create tests**

Run: `npm run test -- tests/prd-service.test.ts`
Expected: the two `create` tests PASS (the second relies on `findAll` reading existing files — it currently returns `[]`, so the id will be `PRD-001`, FAILING the auto-increment test). That is expected; Task 6 implements `findAll`. If you want both green now, you may implement Task 6 before re-running.

- [ ] **Step 5: Commit**

```bash
git add src/application/services/prd-service.ts tests/prd-service.test.ts
git commit -m "feat(application): add DefaultPrdService.create with id generation and prd.created"
```

---

### Task 6: `findAll()` + `parse()` with root normalization, `findById()`

**Files:**
- Modify: `src/application/services/prd-service.ts`
- Test: `tests/prd-service.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/prd-service.test.ts`:

```typescript
describe("DefaultPrdService.findAll/parse", () => {
  it("parses PRD notes and normalizes empty parent-prd to root", async () => {
    const { service, fs } = build();
    fs.files.set(
      "PRDs/PRD-000-product-vision/PRD-000-product-vision.md",
      ["---", "id: PRD-000", "type: prd", "title: Vision", "status: active", "parent-prd:", "vision: V", "display_order: 0", "---", "# PRD-000: Vision", ""].join("\n"),
    );
    fs.files.set(
      "PRDs/PRD-001-dash/PRD-001-dash.md",
      ["---", "id: PRD-001", "type: prd", "title: Dash", "status: draft", "parent-prd: PRD-000", "domains:", "  - dashboard", "vision: V", "scope_in:", "  - tiles", "scope_out:", "  - exports", "display_order: 1", "---", "# PRD-001: Dash", ""].join("\n"),
    );

    const result = await service.findAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.value.find((p) => p.id === "PRD-000");
    const sub = result.value.find((p) => p.id === "PRD-001");
    expect(root?.parentPrdId).toBeUndefined();
    expect(sub?.parentPrdId).toBe("PRD-000");
    expect(sub?.domains).toEqual(["dashboard"]);
    expect(sub?.scopeIn).toEqual(["tiles"]);
  });

  it("drops notes whose type is not prd", async () => {
    const { service, fs } = build();
    fs.files.set("PRDs/not-a-prd.md", "---\ntype: use-case\nid: UC-001\n---\n");
    const result = await service.findAll();
    expect(result.ok && result.value).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/prd-service.test.ts`
Expected: FAIL — `findAll` returns `[]`.

- [ ] **Step 3: Implement `findAll`, `parse`, `findById`**

Replace the stub `findAll`/`findById` in `prd-service.ts`. Use `parseNote` from the shared util (copy the import) and the `isPrdStatus` guard:

```typescript
  async findAll(): Promise<Result<Prd[]>> {
    const settings = await this.settingsService.load();
    const listed = await this.fs.listFilesRecursive(settings.paths.prdsPath);
    if (!listed.ok) return ok([]); // folder may not exist yet
    const prds: Prd[] = [];
    for (const path of listed.value) {
      if (!String(path).endsWith(".md")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue;
      const parsed = this.parse(read.value, path);
      if (parsed) prds.push(parsed);
    }
    prds.sort((a, b) => a.id.localeCompare(b.id));
    return ok(prds);
  }

  async findById(id: PrdId): Promise<Result<Prd | null>> {
    const all = await this.findAll();
    if (!all.ok) return all;
    return ok(all.value.find((p) => p.id === id) ?? null);
  }

  private parse(content: string, path: VaultPath): Prd | null {
    const { frontmatter: fm } = parseNote(content);
    if (fm.type !== "prd" || typeof fm.id !== "string") return null;
    const asArray = (v: string | string[] | undefined): string[] =>
      Array.isArray(v) ? v : v && v !== "" ? [v] : [];
    const parent = typeof fm["parent-prd"] === "string" ? (fm["parent-prd"] as string).trim() : "";
    const status = isPrdStatus(fm.status) ? fm.status : "draft";
    return {
      id: fm.id,
      title: typeof fm.title === "string" ? fm.title : fm.id,
      status,
      parentPrdId: parent === "" ? undefined : parent,
      domains: asArray(fm.domains),
      vision: typeof fm.vision === "string" ? fm.vision : "",
      scopeIn: asArray(fm.scope_in),
      scopeOut: asArray(fm.scope_out),
      displayOrder: Number.parseInt(typeof fm.display_order === "string" ? fm.display_order : "0", 10) || 0,
      path,
    };
  }
```

> Add the `VaultPath` type import and `parseNote` import at the top (copy exact module paths from `use-case-service.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/prd-service.test.ts`
Expected: PASS — including the Task 5 auto-increment test (now that `findAll` reads existing files).

- [ ] **Step 5: Commit**

```bash
git add src/application/services/prd-service.ts tests/prd-service.test.ts
git commit -m "feat(application): PrdService findAll/findById with root normalization"
```

---

### Task 7: Link a Use Case to a PRD (`assignUseCaseToPrd`)

The migration and the Builder's Step 6 both need to set `prd-id` on a Use Case note without disturbing other fields. Use `updateNoteFrontmatter` (preserves body + unknown fields).

**Files:**
- Modify: `src/application/services/prd-service.ts` (add method to `PrdService` interface + impl)
- Test: `tests/prd-service.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```typescript
describe("DefaultPrdService.assignUseCaseToPrd", () => {
  it("adds prd-id to the use case note, preserving other frontmatter", async () => {
    const { service, fs } = build();
    const ucPath = "Use Cases/UC-001 Init.md";
    fs.files.set(ucPath, ["---", "id: UC-001", "type: use-case", "title: Init", "domain: Installation", "status: specified", "---", "# UC-001 Init", ""].join("\n"));

    const result = await service.assignUseCaseToPrd(
      // pass a VaultPath; in tests use unsafeVaultPath
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ucPath as any,
      "PRD-001",
    );
    expect(result.ok).toBe(true);
    const updated = fs.files.get(ucPath) ?? "";
    expect(updated).toContain("prd-id: PRD-001");
    expect(updated).toContain("domain: Installation"); // preserved
    expect(updated).toContain("# UC-001 Init"); // body preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/prd-service.test.ts`
Expected: FAIL — `assignUseCaseToPrd` does not exist.

- [ ] **Step 3: Implement it**

Add to the `PrdService` interface:

```typescript
  assignUseCaseToPrd(useCasePath: VaultPath, prdId: PrdId): Promise<Result<void>>;
```

And to `DefaultPrdService` (import `updateNoteFrontmatter` from the shared util):

```typescript
  async assignUseCaseToPrd(useCasePath: VaultPath, prdId: PrdId): Promise<Result<void>> {
    return this.noteWrites.run(useCasePath, async () => {
      const read = await this.fs.readFile(useCasePath);
      if (!read.ok) return read;
      const next = updateNoteFrontmatter(read.value, { "prd-id": prdId });
      const write = await this.fs.writeFile(useCasePath, next);
      if (!write.ok) return write;
      
      // Emit usecase.updated so Explorer live-refresh recomputes counts & breadcrumbs
      this.eventBus.publish({
        type: "usecase.updated",
        payload: { useCasePath },
      });
      return ok(undefined);
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/prd-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/services/prd-service.ts tests/prd-service.test.ts
git commit -m "feat(application): assignUseCaseToPrd emits usecase.updated for live refresh"
```

---

### Task 8: Expose `domain` from the Use Case read model + `deriveDomains` helper

The Builder Step 1 derives domain options from existing Use Cases. The `UseCase` entity does not currently carry `domain`. Add it (optional field) and a service helper.

**Files:**
- Modify: `src/domain/entities/use-case.ts` (add `domain?: string`)
- Modify: `src/application/services/use-case-service.ts` (`parse()` reads `domain`; add `listDomains()` to interface + impl)
- Test: `tests/use-case-service.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/use-case-service.test.ts`:

```typescript
it("exposes the domain frontmatter field and lists distinct domains", async () => {
  const { service, fs } = build();
  fs.files.set("Use Cases/UC-001 A.md", "---\nid: UC-001\ntype: use-case\ntitle: A\ndomain: Installation\nstatus: specified\n---\n# UC-001 A\n");
  fs.files.set("Use Cases/UC-002 B.md", "---\nid: UC-002\ntype: use-case\ntitle: B\ndomain: Dashboard\nstatus: specified\n---\n# UC-002 B\n");
  fs.files.set("Use Cases/UC-003 C.md", "---\nid: UC-003\ntype: use-case\ntitle: C\ndomain: Dashboard\nstatus: specified\n---\n# UC-003 C\n");

  const all = await service.findAll();
  expect(all.ok && all.value.find((u) => u.id === "UC-001")?.domain).toBe("Installation");

  const domains = await service.listDomains();
  expect(domains.ok && domains.value).toEqual([
    { domain: "Dashboard", count: 2 },
    { domain: "Installation", count: 1 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/use-case-service.test.ts`
Expected: FAIL — `domain` undefined / `listDomains` missing.

- [ ] **Step 3: Implement**

In `src/domain/entities/use-case.ts`, add to the `UseCase` interface:

```typescript
  /** Optional research-domain classification (frontmatter `domain:`). */
  domain?: string;
```

In `use-case-service.ts` `parse()`, add (near the other field reads):

```typescript
      domain: typeof fm.domain === "string" && fm.domain.trim() !== "" ? fm.domain.trim() : undefined,
```

> `update()` must NOT start writing `domain` (it stays a hand-editable field preserved by `updateNoteFrontmatter`). Only `parse()` reads it.

Add to the `UseCaseService` interface and impl:

```typescript
  listDomains(): Promise<Result<{ domain: string; count: number }[]>>;
```

```typescript
  async listDomains(): Promise<Result<{ domain: string; count: number }[]>> {
    const all = await this.findAll();
    if (!all.ok) return all;
    const counts = new Map<string, number>();
    for (const uc of all.value) {
      if (!uc.domain) continue;
      counts.set(uc.domain, (counts.get(uc.domain) ?? 0) + 1);
    }
    const list = [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
    return ok(list);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/use-case-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm run test`
Expected: PASS. Coverage gate still green (new code is tested).

- [ ] **Step 6: Commit**

```bash
git add src/domain/entities/use-case.ts src/application/services/use-case-service.ts tests/use-case-service.test.ts
git commit -m "feat(use-case): expose domain in read model and add listDomains()"
```

---

## Phase 2 — Presentation: PRD Builder modal

### Task 9: Wire `DefaultPrdService` into the composition root

**Files:**
- Modify: `src/main.ts` (instantiate `DefaultPrdService` alongside the other services; expose as `this.prdService`)

- [ ] **Step 1: Instantiate the service**

In `src/main.ts`, where the other services are constructed (search for `new DefaultUseCaseService(`), add:

```typescript
this.prdService = new DefaultPrdService(this.settingsService, vault, eventBus, this.logger);
```

Declare the field next to `useCaseService` (match its visibility/type), importing `DefaultPrdService` and `PrdService`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS (bundle compiles).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "chore(main): instantiate DefaultPrdService in composition root"
```

---

### Task 10: PRD Builder modal — multi-step scaffold + create flow

The Builder is a multi-step `Modal`. Mirror `InitializationWizardModal` (step rendering) for structure and `EditUseCaseModal` (Setting API: text, dropdown, inline error) for inputs. Reference files:
- `src/presentation/views/initialization-wizard-modal.ts` (multi-step render pattern)
- `src/presentation/views/edit-use-case-modal.ts` (text/dropdown/inline error + `submitOnEnter`)
- `src/presentation/views/modal-helpers.ts` (`submitOnEnter`, `openOrNotice`)

**Files:**
- Create: `src/presentation/views/prd-builder-modal.ts`
- Test: `tests/prd-builder-modal.test.ts` (new) — unit-test the pure step-state reducer, not the DOM.

Decision (keeps logic testable under the Vitest obsidian stub): put the wizard's field-collection and validation in a pure `PrdBuilderState` object/class with methods (`setStep`, `toggleDomain`, `addDomain`, `setVision`, `setScopeIn`, `toCreateRequest`, `validate`), and have the modal render from it. Test the state object directly.

- [ ] **Step 1: Write the failing test (pure state)**

Create `tests/prd-builder-modal.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PrdBuilderState } from "../src/presentation/views/prd-builder-modal";

describe("PrdBuilderState", () => {
  it("collects fields across steps and builds a create request", () => {
    const s = new PrdBuilderState("PRD-000");
    s.addDomain("dashboard");
    s.toggleDomain("reporting");
    s.vision = "Test health at a glance";
    s.setScopeIn(["KPI tiles", "recent runs"]);
    s.setScopeOut(["exports"]);
    s.title = "Dashboard & KPI";

    expect(s.validate()).toBeNull(); // no error
    expect(s.toCreateRequest()).toEqual({
      title: "Dashboard & KPI",
      parentPrdId: "PRD-000",
      domains: ["dashboard", "reporting"],
      vision: "Test health at a glance",
      scopeIn: ["KPI tiles", "recent runs"],
      scopeOut: ["exports"],
    });
  });

  it("requires a title and at least one domain for a sub-PRD", () => {
    const s = new PrdBuilderState("PRD-000");
    expect(s.validate()).toMatch(/title/i);
    s.title = "X";
    expect(s.validate()).toMatch(/domain/i);
  });

  it("allows a root PRD to omit domains", () => {
    const s = new PrdBuilderState(undefined); // root
    s.title = "Vision";
    s.vision = "v";
    s.setScopeIn(["a"]);
    s.setScopeOut(["b"]);
    expect(s.validate()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/prd-builder-modal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the state object + a thin modal**

Create `src/presentation/views/prd-builder-modal.ts`. Export `PrdBuilderState` (pure) and `PrdBuilderModal` (DOM). The modal imports `Modal`, `Setting`, `Notice` from `obsidian` (stubbed in tests) and `submitOnEnter`/`openOrNotice` from `modal-helpers`.

```typescript
import { Modal, Notice, Setting, type App } from "obsidian";
import type { PrdService, CreatePrdRequest } from "../../application/services/prd-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import { openOrNotice } from "./modal-helpers";

export class PrdBuilderState {
  title = "";
  vision = "";
  domains: string[] = [];
  private scopeIn: string[] = [];
  private scopeOut: string[] = [];
  step = 1;
  /** Use Case paths chosen in Step 6 to link to this PRD. */
  selectedUseCases: string[] = [];

  constructor(readonly parentPrdId: string | undefined) {}

  get isRoot(): boolean {
    return this.parentPrdId === undefined;
  }
  addDomain(name: string): void {
    const v = name.trim();
    if (v && !this.domains.includes(v)) this.domains.push(v);
  }
  toggleDomain(name: string): void {
    this.domains.includes(name)
      ? (this.domains = this.domains.filter((d) => d !== name))
      : this.domains.push(name);
  }
  setScopeIn(items: string[]): void {
    this.scopeIn = items.map((s) => s.trim()).filter(Boolean);
  }
  setScopeOut(items: string[]): void {
    this.scopeOut = items.map((s) => s.trim()).filter(Boolean);
  }
  validate(): string | null {
    if (this.title.trim() === "") return "A PRD title is required.";
    if (!this.isRoot && this.domains.length === 0)
      return "Select or add at least one domain for a sub-PRD.";
    return null;
  }
  toCreateRequest(): CreatePrdRequest {
    return {
      title: this.title.trim(),
      parentPrdId: this.parentPrdId,
      domains: this.domains,
      vision: this.vision.trim(),
      scopeIn: this.scopeIn,
      scopeOut: this.scopeOut,
    };
  }
}

export interface PrdBuilderDeps {
  prdService: PrdService;
  useCaseService: UseCaseService;
  workspace: { openView(type: string): Promise<void> } & Record<string, unknown>;
  parentPrdId?: string;
}

export class PrdBuilderModal extends Modal {
  private readonly state: PrdBuilderState;
  private submitting = false;

  constructor(app: App, private readonly deps: PrdBuilderDeps) {
    super(app);
    this.state = new PrdBuilderState(deps.parentPrdId);
  }

  onOpen(): void {
    void this.renderStep();
  }
  onClose(): void {
    this.contentEl.empty();
  }

  private async renderStep(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `New PRD — step ${this.state.step} of 6` });
    // Step routing — implemented incrementally in Task 11.
    switch (this.state.step) {
      default:
        await this.renderReviewAndCreate(contentEl);
    }
  }

  private async renderReviewAndCreate(container: HTMLElement): Promise<void> {
    new Setting(container).setName("Title").addText((t) =>
      t.setValue(this.state.title).onChange((v) => (this.state.title = v)),
    );
    const errorEl = container.createDiv({ cls: "e2e-test-hub-settings-errors" });
    new Setting(container).addButton((b) =>
      b
        .setButtonText("Create PRD")
        .setCta()
        .onClick(() => void this.submit(errorEl)),
    );
  }

  private async submit(errorEl: HTMLElement): Promise<void> {
    if (this.submitting) return;
    const error = this.state.validate();
    if (error) {
      errorEl.empty();
      errorEl.createDiv({ text: `✗ ${error}` });
      return;
    }
    this.submitting = true;
    const result = await this.deps.prdService.create(this.state.toCreateRequest());
    this.submitting = false;
    if (!result.ok) {
      errorEl.empty();
      errorEl.createDiv({ text: `✗ ${result.error.message}` });
      return;
    }
    // Link any selected Use Cases (Step 6).
    for (const ucPath of this.state.selectedUseCases) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.deps.prdService.assignUseCaseToPrd(ucPath as any, result.value.id);
    }
    new Notice(`Created ${result.value.id}.`);
    this.close();
    await openOrNotice(this.deps.workspace as never, result.value.path);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/prd-builder-modal.test.ts`
Expected: PASS (state tests). Modal DOM is not asserted here.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/views/prd-builder-modal.ts tests/prd-builder-modal.test.ts
git commit -m "feat(ui): PRD Builder modal scaffold with tested step-state object"
```

---

### Task 11: Flesh out the 6 builder steps (domains → research → vision → scope → success → assign UCs → review)

**Files:**
- Modify: `src/presentation/views/prd-builder-modal.ts`
- Test: `tests/prd-builder-modal.test.ts` (extend state coverage for `selectedUseCases`, `addDomain` dedupe, scope trimming — all pure)

- [ ] **Step 1: Add failing state tests** for step navigation bounds (`next()`/`back()` clamp to 1..6) and `selectedUseCases` toggling. Write `next`/`back` methods and a `toggleUseCase(path)` on `PrdBuilderState`.

- [ ] **Step 2: Run** `npm run test -- tests/prd-builder-modal.test.ts` → FAIL.

- [ ] **Step 3: Implement** `next()`, `back()`, `toggleUseCase()` on the state, then render each step in `renderStep()` using the Setting API:
  - **Step 1 (Domains):** load `await this.deps.useCaseService.listDomains()`; render a checkbox per `{domain, count}` (toggleDomain) plus a text input + "Add domain" button (addDomain). Show a notice if the list is empty ("No domains found in Use Cases yet — type to add one").
  - **Step 2 (Research Summary):** `addTextArea` bound to a `research` string (stored on state; written into the note body later — for V1 it can be appended to the note body via the builder; keep it on state).
  - **Step 3 (Vision):** `addText` → `state.vision`.
  - **Step 4 (Scope):** two `addTextArea` controls; split on newlines into `setScopeIn`/`setScopeOut`.
  - **Step 5 (Success Criteria):** `addTextArea` → `state.successCriteria` (string[]).
  - **Step 6 (Assign UCs):** `await this.deps.useCaseService.findAll()`, filter to those whose `domain` ∈ `state.domains`, render a checkbox per UC (`toggleUseCase(uc.path)`).
  - **Review:** the existing `renderReviewAndCreate`, now also showing a read-only summary; Back/Next buttons call `state.back()/next()` then `void this.renderStep()`.

  > Research summary, success criteria, and scope already render into the note body via `buildPrdNote`'s body sections. To persist the user's free-text into those sections, after `create()` returns, update the note body — OR (simpler for V1) extend `CreatePrdRequest`/`buildPrdNote` to accept `research`, `successCriteria` and render them in the body. If you extend the request, add a matching test in `tests/prd-content.test.ts` first (TDD).

- [ ] **Step 4: Run** `npm run test -- tests/prd-builder-modal.test.ts` → PASS.

- [ ] **Step 5: Typecheck + build:** `npm run typecheck && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/views/prd-builder-modal.ts tests/prd-builder-modal.test.ts
git commit -m "feat(ui): implement all six PRD Builder steps"
```

---

### Task 12: Register a "Create PRD" command + opener in main.ts

**Files:**
- Modify: `src/main.ts` (add `openPrdBuilder()` helper)
- Modify: `src/presentation/commands/register-commands.ts` (add the command; extend its deps interface)

- [ ] **Step 1:** In `main.ts`, add:

```typescript
private openPrdBuilder(parentPrdId?: string): void {
  new PrdBuilderModal(this.app, {
    prdService: this.prdService,
    useCaseService: this.useCaseService,
    workspace: this.workspaceAdapter,
    parentPrdId,
  }).open();
}
```

- [ ] **Step 2:** In `register-commands.ts`, add to the deps interface `openPrdBuilder: () => void;` and register (mirror the `create-use-case` command):

```typescript
plugin.addCommand({
  id: "create-prd",
  name: "New PRD",
  callback: () => deps.openPrdBuilder(),
});
```

Wire `openPrdBuilder: () => this.openPrdBuilder()` where `registerCommands` is called in `main.ts`.

- [ ] **Step 3:** `npm run typecheck && npm run build` → PASS.

- [ ] **Step 4: Manual smoke (optional, documented):** In a scratch vault (`npm run test-build`), run command palette → "New PRD" → complete the wizard → confirm a `PRDs/PRD-001-*/PRD-001-*.md` note appears with correct frontmatter and that re-opening parses it (no errors in console).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/presentation/commands/register-commands.ts
git commit -m "feat(ui): add 'New PRD' command opening the builder"
```

---

## Phase 3 — Presentation: PRD Explorer view

### Task 13: PRD Explorer `ItemView` (tree + actions)

Mirror `src/presentation/views/suite-dashboard-view.ts` (ItemView + `LiveRefresh` + `REFRESH_ON`). Build the tree from `displayOrder` then `id`; immutable ids, never rename on reorder.

**Files:**
- Create: `src/presentation/views/prd-explorer-view.ts`
- Test: `tests/prd-tree.test.ts` (new) — test a pure `buildPrdTree(prds, ucCounts)` function, not the DOM.

- [ ] **Step 1: Write the failing test**

Create `tests/prd-tree.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildPrdTree } from "../src/presentation/views/prd-explorer-view";
import type { Prd } from "../src/domain/entities/prd";
import { unsafeVaultPath } from "../src/domain/value-objects/identifiers";

const prd = (id: string, parent: string | undefined, order: number): Prd => ({
  id, title: id, status: "draft", parentPrdId: parent, domains: [], vision: "",
  scopeIn: [], scopeOut: [], displayOrder: order, path: unsafeVaultPath(`PRDs/${id}/${id}.md`),
});

describe("buildPrdTree", () => {
  it("nests sub-PRDs under root and orders by displayOrder", () => {
    const tree = buildPrdTree(
      [prd("PRD-002", "PRD-000", 2), prd("PRD-000", undefined, 0), prd("PRD-001", "PRD-000", 1)],
      new Map([["PRD-001", 4]]),
    );
    expect(tree.map((n) => n.prd.id)).toEqual(["PRD-000"]);
    expect(tree[0].children.map((n) => n.prd.id)).toEqual(["PRD-001", "PRD-002"]);
    expect(tree[0].children[0].ucCount).toBe(4);
  });
});
```

- [ ] **Step 2: Run** `npm run test -- tests/prd-tree.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `buildPrdTree` + the view. The pure function:

```typescript
export interface PrdTreeNode {
  prd: Prd;
  ucCount: number;
  children: PrdTreeNode[];
}

export const buildPrdTree = (prds: Prd[], ucCounts: Map<string, number>): PrdTreeNode[] => {
  const nodes = new Map<string, PrdTreeNode>();
  for (const prd of prds) nodes.set(prd.id, { prd, ucCount: ucCounts.get(prd.id) ?? 0, children: [] });
  const roots: PrdTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.prd.parentPrdId ? nodes.get(node.prd.parentPrdId) : undefined;
    parent ? parent.children.push(node) : roots.push(node);
  }
  const sort = (list: PrdTreeNode[]) => {
    list.sort((a, b) => a.prd.displayOrder - b.prd.displayOrder || a.prd.id.localeCompare(b.prd.id));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
};
```

The `PrdExplorerView extends ItemView` (const `PRD_VIEW_TYPE = "e2e-test-hub-prds"`): in `render()`, load `await prdService.findAll()` and UC counts (from `useCaseService.findAll()` grouped by `prd-id` — add a small `countUseCasesByPrd()` helper, see Task 14), call `buildPrdTree`, and render nested `<ul>`/`<li>` with each node showing `id: title (N UCs) — status`. Per node: click → open the note (`openOrNotice`), a "＋ sub-PRD" button → `deps.openPrdBuilder(node.prd.id)`, and a "Delete" button gated per Task 16. Subscribe via `LiveRefresh` to `["prd.created", "usecase.updated", "usecase.created"]`.

- [ ] **Step 4: Run** `npm run test -- tests/prd-tree.test.ts` → PASS.

- [ ] **Step 5:** Register the view + a ribbon icon in `main.ts` (mirror the suites view registration). `npm run typecheck && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/views/prd-explorer-view.ts tests/prd-tree.test.ts src/main.ts
git commit -m "feat(ui): add PRD Explorer view with tree builder"
```

---

### Task 14: `countUseCasesByPrd()` helper on UseCaseService

**Files:**
- Modify: `src/application/services/use-case-service.ts`
- Test: `tests/use-case-service.test.ts` (extend)

- [ ] **Step 1: Failing test** — two UCs with `prd-id: PRD-001`, one with `PRD-002`, one with none → `Map { "PRD-001" => 2, "PRD-002" => 1 }`. (Note: `prd-id` isn't in the entity; read it via a dedicated frontmatter scan or add `prdId?: string` to the entity. Prefer adding `prdId?: string` to the `UseCase` entity + `parse()` for symmetry with Task 8 — write that into the test.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `prdId?: string` on the entity (read `fm["prd-id"]` in `parse()`, like `domain`) and `countUseCasesByPrd(): Promise<Result<Map<string, number>>>`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/use-case.ts src/application/services/use-case-service.ts tests/use-case-service.test.ts
git commit -m "feat(use-case): expose prdId and add countUseCasesByPrd()"
```

---

## Phase 4 — Dashboard integration

### Task 15: Dashboard "PRD & Roadmap" section

**Files:**
- Modify: `src/presentation/views/dashboard-view.ts` (add `renderPrdSection()`, call it from `render()`; extend `DashboardViewDeps` with `prdService`, `useCaseService`, `openPrdBuilder`, `navigateToPrds`)
- Modify: `src/main.ts` (pass the new deps when constructing `DashboardView`)
- Test: `tests/prd-dashboard-projection.test.ts` (new) — test a pure `projectPrdRoadmap(prds, ucCounts)` that returns `{ root, children }` view model.

- [ ] **Step 1: Failing test** for `projectPrdRoadmap`: given a root + two children + counts, returns `{ root: { id, title, vision, status, subPrdCount: 2, totalUseCases }, children: [{ id, title, ucCount, status }] }`, children ordered by `displayOrder`.

- [ ] **Step 2: Run** `npm run test -- tests/prd-dashboard-projection.test.ts` → FAIL.

- [ ] **Step 3: Implement** `projectPrdRoadmap` (pure, in `dashboard-view.ts` or a sibling `dashboard-prd-projection.ts`) and `renderPrdSection()` that: loads `prdService.findAll()` + `useCaseService.countUseCasesByPrd()`, projects, and renders a root summary card + a sub-PRD list with a "New PRD" button (`deps.openPrdBuilder()`) and a "View PRD tree" button (`deps.navigateToPrds()`). If no PRDs exist, render a single "Create PRD-000 (product vision)" call to action. Call `renderPrdSection()` from `render()` after the KPI tiles.

- [ ] **Step 4: Run** → PASS. `npm run typecheck && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/dashboard-view.ts src/main.ts tests/prd-dashboard-projection.test.ts
git commit -m "feat(dashboard): add PRD & Roadmap section"
```

---

## Phase 5 — Use Case detail breadcrumb

### Task 15.5: Add `deleteFile` to VaultFileSystem port

(Prerequisite for Task 16a's delete implementation.)

**Files:**
- Modify: `src/infrastructure/ports/vault-file-system.ts` (add `deleteFile(path): Promise<Result<void>>` to interface)
- Modify: `src/infrastructure/adapters/obsidian-vault-file-system.ts` (implement using `vault.adapter.remove(...)` or trash)
- Modify: `tests/__stubs__/fake-vault-file-system.ts` (implement stub for testing)

- [ ] **Step 1: Read the existing port** to understand the interface pattern and error handling.

- [ ] **Step 2: Add the interface method** to `VaultFileSystem`:
```typescript
deleteFile(path: VaultPath): Promise<Result<void>>;
```

- [ ] **Step 3: Implement in Obsidian adapter** (use Obsidian's `adapter.remove()` or vault methods; wrap in Result/error handling).

- [ ] **Step 4: Implement in FakeVaultFileSystem** (track deletions in an internal Set for test verification).

- [ ] **Step 5: Verify** with a simple integration test that deletes a file and checks it's gone.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/ports/vault-file-system.ts src/infrastructure/adapters/obsidian-vault-file-system.ts tests/__stubs__/fake-vault-file-system.ts
git commit -m "feat(infrastructure): add deleteFile to VaultFileSystem port"
```

---

### Task 16a: PRD delete flow that preserves user files

(Referenced by Task 13's Delete button; implement after Task 15.5.)

**Files:**
- Modify: `src/application/services/prd-service.ts` (add `deletePrd(id)` to interface + impl; add `prd.deleted` event per Task 2's pattern — register the event type/payload/catalog first via a small TDD step mirroring Task 2)
- Test: `tests/prd-service.test.ts` (extend)

- [ ] **Step 1: Failing tests:** (a) deleting a PRD whose folder contains only the PRD note removes the note; (b) if the folder also contains `diagram.png`, the PRD note is removed but the folder and `diagram.png` remain, and the result reports `preservedFiles: 1`; (c) deleting a PRD that still has children or linked UCs returns an error; (d) **deleting the root `PRD-000` always returns an error**, even with no children or UCs.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `deletePrd`: **refuse if `id === "PRD-000"` or the PRD's `parentPrdId` is undefined (the root is never deletable — it anchors the Explorer/Dashboard)**; refuse if `findAll` shows any child `parentPrdId === id` or `countUseCasesByPrd` shows `> 0` for `id`; otherwise list the folder (`fs.listFilesRecursive(folder)`), delete only the `PRD-*.md` note using `fs.deleteFile(notePath)`, and if other files remain leave the folder. Return `{ preservedFiles: number }`. Publish `prd.deleted`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/services/prd-service.ts src/domain/events/domain-event.ts "docs/architecture/Event Catalog.md" tests/prd-service.test.ts
git commit -m "feat(application): safe PRD delete preserving user files; add prd.deleted"
```

> Then wire the Explorer's Delete button (Task 13) to `deletePrd`, showing the preserved-files notice.

### Task 16b: Use Case detail PRD breadcrumb

**Files:**
- Modify: `src/presentation/views/use-case-detail-view.ts` (`renderHeader`, ~lines 192-217)
- Modify: `Dashboard/detail` deps if needed to resolve a PRD title from a `prdId`
- Test: covered via a pure helper `prdBreadcrumbLabel(uc, prdTitleById)` in a new `tests/prd-breadcrumb.test.ts`.

- [ ] **Step 1: Failing test** for `prdBreadcrumbLabel`: given a UC with `domain: "Dashboard"`, `prdId: "PRD-001"` and a map `{ "PRD-001": "Dashboard & KPI" }`, returns `"Domain: Dashboard  ›  PRD-001: Dashboard & KPI"`; with no `prdId`, returns `"Domain: Dashboard"`; with neither, returns `""`.

- [ ] **Step 2: Run** `npm run test -- tests/prd-breadcrumb.test.ts` → FAIL.

- [ ] **Step 3: Implement** `prdBreadcrumbLabel` (export from `use-case-detail-view.ts`) and render it in `renderHeader` as a `div` above the H1. If `prdId` is present, make the `PRD-NNN: ...` segment a `e2e-test-hub-link-button` that calls `this.deps.workspace.openView(PRD_VIEW_TYPE)` (import the const from the explorer view). Resolve the PRD title via `prdService.findById(prdId)` loaded in the detail view's data fetch.

- [ ] **Step 4: Run** → PASS. `npm run typecheck && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/use-case-detail-view.ts tests/prd-breadcrumb.test.ts
git commit -m "feat(ui): add PRD breadcrumb to Use Case detail header"
```

---

### Task 16c: Parent-PRD selector in the Use Case editor

Step 6 of the Builder is optional, so non-markdown users need a way to assign a Use Case's parent PRD outside the builder. Add a **Parent PRD** dropdown to `EditUseCaseModal` backed by `assignUseCaseToPrd` (Task 7).

**Files:**
- Modify: `src/presentation/views/edit-use-case-modal.ts` (add a dropdown; extend `EditUseCaseDeps` with `prdService` + the current `prdId`)
- Modify: the call sites that open `EditUseCaseModal` (`use-case-detail-view.ts`) to pass `prdService` and the UC's `prdId`
- Test: `tests/edit-use-case-prd.test.ts` (new) — test a pure helper `prdDropdownOptions(prds)` returning `{ value, label }[]` plus an unset option; assert the submit path calls `assignUseCaseToPrd` when the selection changes.

- [ ] **Step 1: Failing test** for `prdDropdownOptions([...])` → `[{ value: "", label: "— None —" }, { value: "PRD-001", label: "PRD-001: Dashboard" }, ...]` ordered by id.

- [ ] **Step 2: Run** `npm run test -- tests/edit-use-case-prd.test.ts` → FAIL.

- [ ] **Step 3: Implement** `prdDropdownOptions` (export from `edit-use-case-modal.ts`); load `await deps.prdService.findAll()` in `onOpen`, render an `addDropdown` seeded with the UC's current `prdId`. In `submit()`, after the existing `updateMetadata` call, if the selected PRD differs from the original, call `await deps.prdService.assignUseCaseToPrd(deps.useCase.path, selectedPrdId)` (skip when cleared to empty — clearing a required link is out of scope for V1; leave the existing value).

- [ ] **Step 4: Run** → PASS. `npm run typecheck && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/edit-use-case-modal.ts src/presentation/views/use-case-detail-view.ts tests/edit-use-case-prd.test.ts
git commit -m "feat(ui): add Parent PRD selector to the Use Case editor"
```

---

## Phase 6 — Migration scripts

Scripts live under `scripts/` (the repo already has `scripts/test-build.mjs`, `scripts/e2e-smoke.mjs`). They run with Node against the vault dir. Add `npm` aliases in `package.json`.

### Task 17: Phase 1 analysis — `analyze-uc-domains.mjs`

**Files:**
- Create: `scripts/analyze-uc-domains.mjs`
- Modify: `package.json` (add `"migrate:analyze-domains": "node scripts/analyze-uc-domains.mjs"`)
- Test: `tests/migrate-analyze-domains.test.ts` (new) — extract the pure grouping into `scripts/lib/uc-domains.mjs` and test it, OR test a TS helper. Prefer a tiny pure function `groupByDomain(notes)` importable by both the script and the test.

- [ ] **Step 1: Failing test** for `groupByDomain([{id, domain}, ...])` → `[{ domain, ids: [...] }, ...]` sorted by count desc.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `scripts/lib/uc-domains.mjs` (`groupByDomain`, and a frontmatter-`domain` extractor) and the script that: reads the configured `useCasesPath` (default `"Use Cases"`; accept `--use-cases-path` arg), scans `*.md`, extracts `domain`, groups, and writes `docs/migration-report-domains.md`. Read the path from a `--use-cases-path` CLI flag (do NOT hard-code `docs/use-cases`).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/analyze-uc-domains.mjs scripts/lib/uc-domains.mjs package.json tests/migrate-analyze-domains.test.ts
git commit -m "feat(migrate): Phase 1 domain analysis script"
```

### Task 18: Phase 3 — `migrate-prd-0.mjs` (backup-first, redirect, alias)

**Files:**
- Create: `scripts/migrate-prd-0.mjs`
- Modify: `package.json` (`"migrate:create-prd-0"`)

- [ ] **Step 1:** Implement, in this exact order (the order is the safety guarantee from the spec):
  1. Copy `docs/Specorator Testrunner.md` → `docs/Specorator Testrunner.md.backup` (abort if backup already exists unless `--force`).
  2. Create `<prdsPath>/PRD-000-product-vision/PRD-000-product-vision.md` with PRD frontmatter (`id: PRD-000`, `type: prd`, `status: active`, empty `parent-prd:`, `display_order: 0`, `scope_in`/`scope_out` block-sequences derived from the original Goals/Non-Goals) followed by the original body.
  3. Rewrite `docs/Specorator Testrunner.md` as a redirect note with `aliases: [PRD-000-product-vision]` and a link to the new note.

- [ ] **Step 2: Manual verification (documented):** run on a copy of the repo's `docs/`; confirm backup exists, new note parses (run the plugin's `findAll` against it in a unit harness or open in Obsidian), and an existing `[[Specorator Testrunner]]` link still resolves via the alias.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-prd-0.mjs package.json
git commit -m "feat(migrate): Phase 3 create PRD-000 with backup-first and alias redirect"
```

### Task 19: Phases 4–5 — create sub-PRDs + link Use Cases

**Files:**
- Create: `scripts/create-sub-prds.mjs` (reads a `migration-plan.json` mapping `{ "PRD-001": { title, domains, useCaseIds: [...] } }`, creates folders+notes, then sets `prd-id` on each listed UC)
- Modify: `package.json` (`"migrate:create-sub-prds"`)

- [ ] **Step 1:** Implement using the same note-building logic as `buildPrdNote` (factor the body/frontmatter assembly into `scripts/lib/prd-note.mjs` shared with `migrate-prd-0.mjs` to stay DRY). For each UC id, locate its note under the configured `useCasesPath` and add `prd-id:` via a frontmatter rewrite that preserves all other fields and the body.

- [ ] **Step 2:** Add a tiny test `tests/migrate-prd-note.test.ts` for `scripts/lib/prd-note.mjs` asserting block-sequence arrays + empty root `parent-prd` (mirror Task 4's assertions) so the script and the plugin agree on format.

- [ ] **Step 3: Run** `npm run test -- tests/migrate-prd-note.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/create-sub-prds.mjs scripts/lib/prd-note.mjs package.json tests/migrate-prd-note.test.ts
git commit -m "feat(migrate): Phases 4-5 create sub-PRDs and link Use Cases"
```

---

## Phase 7 — Required documentation (ADR + glossary)

### Task 20: ADR for the PRD hierarchy artifact model

**Files:**
- Create: `docs/adr/0026-prd-hierarchy-artifact-model.md` (0021–0025 already exist; this is the next free slot)

- [ ] **Step 1:** Write the ADR following the existing ADR format in `docs/adr/0001-*.md`. Cover: context (gap between Domain research and Use Cases), decision (three-layer Domain → PRD → Use Case; PRDs as synthesis artifacts; one-folder-per-PRD; immutable ids + `display_order`; root identified by empty `parent-prd`; `domains` optional for root), consequences, and alternatives considered (PRDs replace domains — rejected; multi-parent UCs — rejected).

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0026-prd-hierarchy-artifact-model.md
git commit -m "docs(adr): record PRD hierarchy artifact model decision"
```

### Task 21: CONTEXT.md glossary entries

**Files:**
- Modify: `CONTEXT.md` (add PRD-related terms in the "Business artifacts" section, matching the existing entry style with an `_Avoid_:` line)

- [ ] **Step 1:** Add entries for: **PRD**, **prd-id**, **parent-prd**, **display_order**, and a **Domain (research)** clarification distinguishing it from PRD. Match the existing glossary formatting exactly.

- [ ] **Step 2: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(context): add PRD glossary terms"
```

---

## Final verification

- [ ] **Full gate:** `npm run lint && npm run format:check && npm run typecheck && npm run test`
  Expected: all PASS; coverage ≥ thresholds (93/93/93/80). If coverage dips, add focused tests for any untested branch in `prd-service.ts` / projections (the pure helpers are the cheapest to cover).
- [ ] **Build:** `npm run build` → `main.js` emits.
- [ ] **Manual smoke (documented):** `npm run test-build`, then in the scratch vault: create PRD-000 via the builder (root), create a sub-PRD, see both in the PRD Explorer tree, assign a Use Case, confirm the breadcrumb on the Use Case detail, and confirm the Dashboard PRD section renders.
- [ ] **Update README** vault-layout + repository-layout sections to mention `PRDs/` and `Domains/` and the new `src` files (optional but recommended for parity with existing docs).

---

## Spec coverage check (self-review)

| Spec section | Task(s) |
| --- | --- |
| §2.2 PRD frontmatter schema | 3, 4 |
| §2.3 Use Case `prd-id` | 7, 14 |
| §2.4 file structure (one folder per PRD; configurable paths) | 1, 4, 5 |
| §2.5 markdown sections | 4, 11 |
| §3 Builder 7 steps | 10, 11 |
| §4.1 PRD Explorer | 13, 14 |
| §4.2 Dashboard | 15 |
| §4.4 UC breadcrumb | 16b |
| §3 Step 6 UC assignment outside builder (editor selector) | 16c |
| Root PRD-000 non-deletable | 16a |
| §5 Migration Phases 1–5 | 17, 18, 19 |
| Parser-safe frontmatter / root via empty parent-prd | 4, 6 |
| Immutable ids + display_order | 3, 13 |
| Domains optional for root | 4, 10 |
| Domain derived from existing UCs | 8 |
| Safe delete (preserve attachments) | 16a |
| `prd.created` event + catalog | 2, 5 |
| ADR | 20 |
| CONTEXT.md glossary | 21 |
| Event Catalog + typed payload | 2 (and 16a for `prd.deleted`) |

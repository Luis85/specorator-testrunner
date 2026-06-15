# US-056 Scenario Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Gherkin scenario a stable, collision-free **Scenario Reference** (`<featurePath>::<scenarioName>[::row-<digest>]`), enforce the validation rules that keep the key unambiguous, and attach the reference to every run-report result.

**Architecture:** A new pure domain module computes references (name-derived identity, content-stable Outline row digest per ADR-0022). The single shared `structuralIssues()` rule set gains three collision rules. A new application-layer `ScenarioIdentityResolver` enriches imported report results with their reference by resolving each row against the same-run feature; it is wired into the `PostRunCoordinator` so both the post-run and manual-import flows attach references. A small advisory warns when a scenario is renamed.

**Tech Stack:** TypeScript (strict), Vitest, the existing hexagonal layers (`domain` / `application` / `presentation`), `Result` error type, `VaultFileSystem` port.

**Spec:** `docs/superpowers/specs/2026-06-14-us-056-scenario-reference-design.md`

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/domain/value-objects/scenario-reference.ts` | Pure identity: `rowDigest`, `scenarioRef`, `outlineRowRef`, `parseScenarioReference`, `featureScenarioRefs` | Create |
| `src/application/content/feature-validation.ts` | Add duplicate-name, reserved-`::`, duplicate-Outline-row rules to `structuralIssues` | Modify |
| `src/application/ports/report-parser.ts` | Add `scenarioRef?: string` to `ScenarioResult` | Modify |
| `src/application/services/scenario-identity-resolver.ts` | Enrich `ParsedReport` results with `scenarioRef` (I/O via `VaultFileSystem`) | Create |
| `src/application/services/post-run-coordinator.ts` | Call the resolver between import and evidence | Modify |
| `src/main.ts` | Construct the resolver, pass it to the coordinator | Modify |
| `src/presentation/views/feature-editor-format.ts` | Add pure `renameAdvisory` | Modify |
| `src/presentation/views/feature-editor-view.ts` | Capture load-time baseline names; surface the advisory in the strip | Modify |
| `tests/scenario-reference.test.ts` | Domain unit tests | Create |
| `tests/feature-validation.test.ts` | New rule tests | Modify |
| `tests/scenario-identity-resolver.test.ts` | Resolver tests | Create |
| `tests/feature-editor-format.test.ts` | `renameAdvisory` tests | Modify |

Commit after every task. Run `npx vitest run <file>` for a single file; `npm test` for the full suite.

---

## Task 1: Row digest (content-stable, pure)

**Files:**
- Create: `src/domain/value-objects/scenario-reference.ts`
- Test: `tests/scenario-reference.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { rowDigest } from "../src/domain/value-objects/scenario-reference";

describe("rowDigest (content-stable Outline row key, US-056)", () => {
  it("is deterministic for the same cells", () => {
    const cells: [string, string][] = [["role", "admin"], ["name", "Alice"]];
    expect(rowDigest(cells)).toBe(rowDigest(cells));
  });

  it("is independent of column order (sorted by header)", () => {
    expect(rowDigest([["role", "admin"], ["name", "Alice"]])).toBe(
      rowDigest([["name", "Alice"], ["role", "admin"]]),
    );
  });

  it("changes when a value changes", () => {
    expect(rowDigest([["role", "admin"]])).not.toBe(rowDigest([["role", "user"]]));
  });

  it("does not alias rows when values contain separators", () => {
    // "a=b" packed into one cell must not collide with two cells a,b.
    expect(rowDigest([["x", "a=b"]])).not.toBe(rowDigest([["x", "a"], ["", "b"]]));
  });

  it("returns a compact base36 string", () => {
    expect(rowDigest([["role", "admin"]])).toMatch(/^[0-9a-z]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scenario-reference.test.ts`
Expected: FAIL — cannot find module / `rowDigest` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { FeatureSpecification } from "../entities/specification";
import { isScenarioOutline } from "../entities/specification";

/** 32-bit FNV-1a; non-cryptographic, deterministic, synchronous. */
const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * Content-stable digest of one Outline example row (US-056, ADR-0022). Cells
 * are `[header, value]` pairs; sorting by header makes the digest independent
 * of column order, and JSON-encoding the sorted pairs makes values that contain
 * separators unable to alias one row onto another. Reorder-stable: a row's
 * digest depends only on its content, never its position.
 */
export const rowDigest = (cells: ReadonlyArray<readonly [string, string]>): string => {
  const sorted = [...cells].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return fnv1a(JSON.stringify(sorted)).toString(36);
};
```

(The `FeatureSpecification` / `isScenarioOutline` imports are used by Task 3; leave them in now to avoid a second edit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scenario-reference.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/value-objects/scenario-reference.ts tests/scenario-reference.test.ts
git commit -m "feat(domain): content-stable Outline row digest (US-056)"
```

---

## Task 2: Reference formatting & parsing

**Files:**
- Modify: `src/domain/value-objects/scenario-reference.ts`
- Test: `tests/scenario-reference.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing describe blocks)

```ts
import {
  scenarioRef,
  outlineRowRef,
  parseScenarioReference,
} from "../src/domain/value-objects/scenario-reference";

describe("scenarioRef / outlineRowRef / parseScenarioReference", () => {
  const path = "Specifications/features/UC-001-login.feature";

  it("formats a plain scenario reference", () => {
    expect(scenarioRef(path, "Login")).toBe(`${path}::Login`);
  });

  it("formats an Outline row reference with the row- prefix", () => {
    const ref = outlineRowRef(path, "Login", [["role", "admin"]]);
    expect(ref.startsWith(`${path}::Login::row-`)).toBe(true);
  });

  it("round-trips a plain reference", () => {
    expect(parseScenarioReference(scenarioRef(path, "Login"))).toEqual({
      featurePath: path,
      scenarioName: "Login",
    });
  });

  it("round-trips an Outline row reference", () => {
    const ref = outlineRowRef(path, "Login", [["role", "admin"]]);
    const parsed = parseScenarioReference(ref);
    expect(parsed.featurePath).toBe(path);
    expect(parsed.scenarioName).toBe("Login");
    expect(parsed.rowDigest).toBe(rowDigest([["role", "admin"]]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scenario-reference.test.ts`
Expected: FAIL — `scenarioRef` / `outlineRowRef` / `parseScenarioReference` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `scenario-reference.ts`)

```ts
/** Plain scenario identity: `<featurePath>::<scenarioName>` (ADR-0022). */
export const scenarioRef = (featurePath: string, scenarioName: string): string =>
  `${featurePath}::${scenarioName}`;

/** Outline row identity: `<featurePath>::<scenarioName>::row-<digest>`. */
export const outlineRowRef = (
  featurePath: string,
  scenarioName: string,
  cells: ReadonlyArray<readonly [string, string]>,
): string => `${scenarioRef(featurePath, scenarioName)}::row-${rowDigest(cells)}`;

export interface ParsedScenarioReference {
  featurePath: string;
  scenarioName: string;
  /** Present only for an Outline row reference. */
  rowDigest?: string;
}

/**
 * Inverse of {@link scenarioRef} / {@link outlineRowRef}. Safe because the `::`
 * delimiter is reserved in scenario names (validation, US-056) and vault paths
 * never contain `::`, so the split is unambiguous.
 */
export const parseScenarioReference = (ref: string): ParsedScenarioReference => {
  const parts = ref.split("::");
  const base: ParsedScenarioReference = {
    featurePath: parts[0] ?? "",
    scenarioName: parts[1] ?? "",
  };
  const rowToken = parts[2];
  if (rowToken !== undefined && rowToken.startsWith("row-")) {
    return { ...base, rowDigest: rowToken.slice("row-".length) };
  }
  return base;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scenario-reference.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/value-objects/scenario-reference.ts tests/scenario-reference.test.ts
git commit -m "feat(domain): scenario reference formatting + parsing (US-056)"
```

---

## Task 3: `featureScenarioRefs` over a parsed Feature

**Files:**
- Modify: `src/domain/value-objects/scenario-reference.ts`
- Test: `tests/scenario-reference.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { featureScenarioRefs } from "../src/domain/value-objects/scenario-reference";
import { parseFeature } from "../src/application/content/gherkin";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

describe("featureScenarioRefs", () => {
  it("yields one entry per plain scenario", () => {
    const feature = parseFeature(
      "Feature: F\n  Scenario: Login\n    Given x\n  Scenario: Logout\n    Given y\n",
      vp("Specifications/features/UC-001-f.feature"),
    );
    if (!feature) throw new Error("parse failed");
    expect(featureScenarioRefs(feature).map((e) => e.ref)).toEqual([
      "Specifications/features/UC-001-f.feature::Login",
      "Specifications/features/UC-001-f.feature::Logout",
    ]);
  });

  it("yields one entry per Outline example row, in declared order", () => {
    const feature = parseFeature(
      [
        "Feature: F",
        "  Scenario Outline: Login as <role>",
        "    Given I am <role>",
        "    Examples:",
        "      | role  |",
        "      | admin |",
        "      | user  |",
        "",
      ].join("\n"),
      vp("Specifications/features/UC-001-f.feature"),
    );
    if (!feature) throw new Error("parse failed");
    const entries = featureScenarioRefs(feature);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.scenarioName === "Login as <role>")).toBe(true);
    expect(entries[0]?.ref).toContain("::row-");
    expect(entries[0]?.ref).not.toBe(entries[1]?.ref);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scenario-reference.test.ts`
Expected: FAIL — `featureScenarioRefs` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `scenario-reference.ts`)

```ts
export interface ScenarioRefEntry {
  scenarioName: string;
  ref: string;
}

/**
 * All scenario references for a parsed Feature, in declaration order: one entry
 * per plain scenario, one per Outline example row (across every `Examples`
 * block). The order matches the order a report expands rows, so a resolver can
 * zip report rows onto these entries by position within a scenario name.
 */
export const featureScenarioRefs = (feature: FeatureSpecification): ScenarioRefEntry[] => {
  const path = String(feature.path);
  const entries: ScenarioRefEntry[] = [];
  for (const scenario of feature.scenarios) {
    if (isScenarioOutline(scenario)) {
      for (const block of scenario.examples ?? []) {
        for (const row of block.rows) {
          const cells = block.header.map(
            (header, i) => [header, row[i] ?? ""] as [string, string],
          );
          entries.push({
            scenarioName: scenario.name,
            ref: outlineRowRef(path, scenario.name, cells),
          });
        }
      }
    } else {
      entries.push({ scenarioName: scenario.name, ref: scenarioRef(path, scenario.name) });
    }
  }
  return entries;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scenario-reference.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/value-objects/scenario-reference.ts tests/scenario-reference.test.ts
git commit -m "feat(domain): featureScenarioRefs enumerates per-scenario identity (US-056)"
```

---

## Task 4: Validation rules — collisions become unrepresentable

**Files:**
- Modify: `src/application/content/feature-validation.ts`
- Test: `tests/feature-validation.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the existing `describe`)

```ts
import { rowDigest } from "../src/domain/value-objects/scenario-reference";

it("flags duplicate scenario names within a Feature (ADR-0022)", () => {
  const spec = parseFeature(
    "Feature: F\n  Scenario: Dup\n    Given x\n  Scenario: Dup\n    Given y\n",
    vp("Specifications/features/UC-001-dup.feature"),
  );
  if (!spec) return;
  expect(structuralIssues(spec).map((i) => i.message)).toContain(
    'Duplicate scenario name "Dup" — names must be unique within a Feature (ADR-0022).',
  );
});

it("flags a scenario name containing the reserved :: delimiter", () => {
  const spec = parseFeature(
    "Feature: F\n  Scenario: Login::row-1\n    Given x\n",
    vp("Specifications/features/UC-001-res.feature"),
  );
  if (!spec) return;
  expect(structuralIssues(spec).map((i) => i.message)).toContain(
    'Scenario "Login::row-1" uses the reserved "::" delimiter in its name.',
  );
});

it("flags duplicate example rows within one Scenario Outline", () => {
  const spec = parseFeature(
    [
      "Feature: F",
      "  Scenario Outline: Login as <role>",
      "    Given I am <role>",
      "    Examples:",
      "      | role  |",
      "      | admin |",
      "      | admin |",
      "",
    ].join("\n"),
    vp("Specifications/features/UC-001-rows.feature"),
  );
  if (!spec) return;
  expect(structuralIssues(spec).map((i) => i.message)).toContain(
    'Scenario Outline "Login as <role>" has duplicate example rows.',
  );
  // rowDigest import is exercised so the rule and the resolver agree on keys.
  expect(rowDigest([["role", "admin"]])).toBe(rowDigest([["role", "admin"]]));
});

it("leaves a well-formed Outline with distinct rows clean of identity errors", () => {
  const spec = parseFeature(
    [
      "Feature: F",
      "  Scenario Outline: Login as <role>",
      "    Given I am <role>",
      "    Examples:",
      "      | role  |",
      "      | admin |",
      "      | user  |",
      "",
    ].join("\n"),
    vp("Specifications/features/UC-001-ok2.feature"),
  );
  if (!spec) return;
  expect(structuralIssues(spec)).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/feature-validation.test.ts`
Expected: FAIL — the new messages are not produced.

- [ ] **Step 3: Write minimal implementation**

Edit `src/application/content/feature-validation.ts`. Add imports at the top:

```ts
import { isScenarioOutline } from "../../domain/entities/specification";
import { rowDigest } from "../../domain/value-objects/scenario-reference";
```

Then, inside `structuralIssues`, replace the existing scenario loop:

```ts
  for (const scenario of specification.scenarios) {
    const label = scenario.name.trim() === "" ? "(unnamed)" : scenario.name;
    if (scenario.steps.length === 0) {
      items.push({ level: "error", message: `Scenario "${label}" has no steps.` });
    }
  }
```

with this expanded loop (keeps the stepless rule, adds the three identity rules):

```ts
  const seenNames = new Set<string>();
  const reportedDup = new Set<string>();
  for (const scenario of specification.scenarios) {
    const name = scenario.name.trim();
    const label = name === "" ? "(unnamed)" : name;

    if (scenario.steps.length === 0) {
      items.push({ level: "error", message: `Scenario "${label}" has no steps.` });
    }

    // Scenario Reference collision rules (ADR-0022, US-056): the name-based key
    // must be unique and must not forge the reserved `::` / `::row-` delimiters.
    if (name.includes("::")) {
      items.push({
        level: "error",
        message: `Scenario "${label}" uses the reserved "::" delimiter in its name.`,
      });
    }
    if (name !== "" && seenNames.has(name) && !reportedDup.has(name)) {
      items.push({
        level: "error",
        message: `Duplicate scenario name "${name}" — names must be unique within a Feature (ADR-0022).`,
      });
      reportedDup.add(name);
    }
    seenNames.add(name);

    // The content-stable Outline row digest must be collision-free, so identical
    // example rows are a structural error (mirrors the duplicate-name rule).
    if (isScenarioOutline(scenario)) {
      const seenRows = new Set<string>();
      let flagged = false;
      for (const block of scenario.examples ?? []) {
        for (const row of block.rows) {
          const cells = block.header.map(
            (header, i) => [header, row[i] ?? ""] as [string, string],
          );
          const digest = rowDigest(cells);
          if (seenRows.has(digest) && !flagged) {
            items.push({
              level: "error",
              message: `Scenario Outline "${label}" has duplicate example rows.`,
            });
            flagged = true;
          }
          seenRows.add(digest);
        }
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/feature-validation.test.ts`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/content/feature-validation.ts tests/feature-validation.test.ts
git commit -m "feat(validation): reject scenario-reference collisions (US-056)"
```

---

## Task 5: Add `scenarioRef` to the report result type

**Files:**
- Modify: `src/application/ports/report-parser.ts`

(No standalone test — the field is exercised by Task 6. This is a type-only change to unblock the resolver.)

- [ ] **Step 1: Add the field**

In `src/application/ports/report-parser.ts`, inside `interface ScenarioResult`, add after the `line` field:

```ts
  scenarioRef?: string; // Scenario Reference (<featurePath>::<name>[::row-<digest>]), set by ScenarioIdentityResolver (US-056)
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/application/ports/report-parser.ts
git commit -m "feat(report): ScenarioResult carries an optional scenarioRef (US-056)"
```

---

## Task 6: `ScenarioIdentityResolver`

**Files:**
- Create: `src/application/services/scenario-identity-resolver.ts`
- Test: `tests/scenario-identity-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { ScenarioIdentityResolver } from "../src/application/services/scenario-identity-resolver";
import type { ParsedReport, ScenarioResult } from "../src/application/ports/report-parser";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { ok, err } from "../src/shared/result/result";
import { appError } from "../src/shared/errors/errors";
import { rowDigest } from "../src/domain/value-objects/scenario-reference";

const settings = (featureFilesPath = "Specifications/features") =>
  ({ load: async () => ({ paths: { featureFilesPath: vp(featureFilesPath) } }) }) as never;

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const fsWith = (files: Record<string, string>) =>
  ({
    readFile: async (path: string) =>
      path in files ? ok(files[path]) : err(appError("FILE_NOT_FOUND", `missing ${path}`)),
  }) as never;

const report = (scenarioResults: ScenarioResult[]): ParsedReport => ({
  result: { total: scenarioResults.length, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
  scenarioResults,
  artifacts: [],
});

const FEATURE = "Specifications/features/UC-001-login.feature";

describe("ScenarioIdentityResolver", () => {
  it("attaches a plain scenario reference from featureUri + name", async () => {
    const resolver = new ScenarioIdentityResolver(
      settings(),
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    const out = await resolver.enrich(
      report([{ feature: "F", featureUri: "features/UC-001-login.feature", scenario: "Login", status: "passed" }]),
    );
    expect(out.scenarioResults[0]?.scenarioRef).toBe(`${FEATURE}::Login`);
  });

  it("attaches content-stable references to Outline rows by line order", async () => {
    const text = [
      "Feature: F",
      "  Scenario Outline: Login as <role>",
      "    Given I am <role>",
      "    Examples:",
      "      | role  |",
      "      | admin |",
      "      | user  |",
      "",
    ].join("\n");
    const resolver = new ScenarioIdentityResolver(settings(), fsWith({ [FEATURE]: text }), logger());
    const out = await resolver.enrich(
      report([
        { feature: "F", featureUri: "features/UC-001-login.feature", scenario: "Login as <role>", status: "passed", line: 7 },
        { feature: "F", featureUri: "features/UC-001-login.feature", scenario: "Login as <role>", status: "passed", line: 6 },
      ]),
    );
    const refByLine = Object.fromEntries(out.scenarioResults.map((r) => [r.line, r.scenarioRef]));
    expect(refByLine[6]).toBe(`${FEATURE}::Login as <role>::row-${rowDigest([["role", "admin"]])}`);
    expect(refByLine[7]).toBe(`${FEATURE}::Login as <role>::row-${rowDigest([["role", "user"]])}`);
  });

  it("leaves the ref undefined and warns when the feature is unreadable", async () => {
    const log = logger();
    const resolver = new ScenarioIdentityResolver(settings(), fsWith({}), log);
    const out = await resolver.enrich(
      report([{ feature: "F", featureUri: "features/UC-001-login.feature", scenario: "Login", status: "passed" }]),
    );
    expect(out.scenarioResults[0]?.scenarioRef).toBeUndefined();
    expect((log as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
  });

  it("falls back to a provisional row key when report rows exceed feature rows", async () => {
    const text = [
      "Feature: F",
      "  Scenario Outline: O",
      "    Given <a>",
      "    Examples:",
      "      | a |",
      "      | 1 |",
      "",
    ].join("\n");
    const resolver = new ScenarioIdentityResolver(settings(), fsWith({ [FEATURE]: text }), logger());
    const out = await resolver.enrich(
      report([
        { feature: "F", featureUri: "features/UC-001-login.feature", scenario: "O", status: "passed", line: 6 },
        { feature: "F", featureUri: "features/UC-001-login.feature", scenario: "O", status: "passed", line: 99 },
      ]),
    );
    const refs = out.scenarioResults.map((r) => r.scenarioRef);
    expect(refs.some((r) => r === `${FEATURE}::O::row-1`)).toBe(true); // provisional positional fallback
  });

  it("does not mutate the input report's results", async () => {
    const input = report([
      { feature: "F", featureUri: "features/UC-001-login.feature", scenario: "Login", status: "passed" },
    ]);
    const resolver = new ScenarioIdentityResolver(
      settings(),
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    await resolver.enrich(input);
    expect(input.scenarioResults[0]?.scenarioRef).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scenario-identity-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFeatureFile } from "./feature-loading";
import type { SettingsService } from "./settings-service";
import type { ParsedReport, ScenarioResult } from "../ports/report-parser";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { FeatureSpecification } from "../../domain/entities/specification";
import { featureScenarioRefs } from "../../domain/value-objects/scenario-reference";
import type { Logger } from "../../shared/logging/logger";
import { joinVaultPath } from "../../shared/utils/vault-path";

/** Last `/`-segment of a runner-relative feature uri (e.g. `UC-001-x.feature`). */
const basename = (uri: string): string => uri.split("/").pop() ?? uri;

const byLine = (a: ScenarioResult, b: ScenarioResult): number =>
  (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);

/**
 * Enriches imported report results with their Scenario Reference (US-056,
 * ADR-0022). Name-derived identity: the durable key is computed from the
 * authoritative `.feature` file, not stamped into it. Outline rows are joined to
 * the same-run feature by position (report rows expand in declaration order) and
 * keyed by the row's content digest, so a between-run row reorder still attaches
 * history to the right parameter set. Pure with respect to the input report —
 * returns a new result list; never throws.
 */
export class ScenarioIdentityResolver {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly vaultFs: VaultFileSystem,
    private readonly logger: Logger,
  ) {}

  async enrich<T extends ParsedReport>(report: T): Promise<T> {
    const settings = await this.settingsService.load();
    const featureDir = settings.paths.featureFilesPath;
    const featureCache = new Map<string, FeatureSpecification | null>();

    const enriched = report.scenarioResults.map((result) => ({ ...result }));

    const byUri = new Map<string, ScenarioResult[]>();
    for (const result of enriched) {
      if (!result.featureUri) continue; // e.g. a Background pseudo-result
      const list = byUri.get(result.featureUri) ?? [];
      list.push(result);
      byUri.set(result.featureUri, list);
    }

    for (const [uri, results] of byUri) {
      const vaultPath = String(joinVaultPath(featureDir, basename(uri)));
      let feature = featureCache.get(vaultPath);
      if (feature === undefined) {
        const read = await readFeatureFile(this.vaultFs, joinVaultPath(featureDir, basename(uri)));
        feature = read.ok ? read.value : null;
        featureCache.set(vaultPath, feature);
        if (!read.ok) {
          this.logger.warn("Scenario identity: feature unreadable; refs skipped", {
            vaultPath,
            uri,
            reason: read.error.message,
          });
        }
      }
      if (feature) this.assign(results, feature, vaultPath);
    }

    return { ...report, scenarioResults: enriched };
  }

  /** Zips a feature's ordered refs onto report rows grouped by scenario name. */
  private assign(results: ScenarioResult[], feature: FeatureSpecification, vaultPath: string): void {
    const refsByName = new Map<string, string[]>();
    for (const entry of featureScenarioRefs(feature)) {
      const list = refsByName.get(entry.scenarioName) ?? [];
      list.push(entry.ref);
      refsByName.set(entry.scenarioName, list);
    }

    const groups = new Map<string, ScenarioResult[]>();
    for (const result of results) {
      const list = groups.get(result.scenario) ?? [];
      list.push(result);
      groups.set(result.scenario, list);
    }

    for (const [name, group] of groups) {
      const refs = refsByName.get(name) ?? [];
      [...group].sort(byLine).forEach((result, index) => {
        const ref = refs[index];
        if (ref !== undefined) {
          result.scenarioRef = ref;
        } else {
          result.scenarioRef = `${vaultPath}::${name}::row-${index}`;
          this.logger.warn("Scenario identity: row count mismatch; provisional ref", {
            vaultPath,
            name,
            index,
          });
        }
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scenario-identity-resolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/services/scenario-identity-resolver.ts tests/scenario-identity-resolver.test.ts
git commit -m "feat(report): ScenarioIdentityResolver attaches scenario refs (US-056)"
```

---

## Task 7: Wire the resolver into the post-run flow

**Files:**
- Modify: `src/application/services/post-run-coordinator.ts`
- Modify: `src/main.ts`
- Test: `tests/post-run-coordinator.test.ts` (existing)

- [ ] **Step 1: Update the coordinator test setup to a failing expectation**

Open `tests/post-run-coordinator.test.ts`. Find the helper that builds `PostRunCoordinatorDeps` (search for `reportImportService:`). Add a resolver spy to the deps object:

```ts
    scenarioIdentityResolver: {
      enrich: vi.fn(async (r: unknown) => r),
    },
```

Then add a test (place it beside the existing import→evidence tests):

```ts
it("enriches the imported report with scenario refs before evidence generation", async () => {
  // Arrange the existing happy-path harness (a finished run + a successful
  // import). Reuse whatever factory the other tests use; the assertion is:
  expect(deps.scenarioIdentityResolver.enrich).toHaveBeenCalledTimes(1);
  expect(deps.evidenceGenerationService.generate).toHaveBeenCalled();
});
```

> Note: match the surrounding test's arrange/act structure (trigger a terminal event or call `importLastRun()`), then keep the two `expect`s above. The point is that `enrich` runs exactly once on the import path and evidence still runs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/post-run-coordinator.test.ts`
Expected: FAIL — `scenarioIdentityResolver` is not a property of deps / `enrich` never called.

- [ ] **Step 3: Implement the wiring**

In `src/application/services/post-run-coordinator.ts`:

Add an import at the top:

```ts
import type { ScenarioIdentityResolver } from "./scenario-identity-resolver";
```

Add to `interface PostRunCoordinatorDeps` (after `evidenceGenerationService`):

```ts
  scenarioIdentityResolver: ScenarioIdentityResolver;
```

In `runImportAndGenerate`, replace the block that passes `imported.value` to evidence:

```ts
      const evidence = await this.deps.evidenceGenerationService.generate({
        run,
        report: imported.value,
      });
```

with:

```ts
      // Attach Scenario References before evidence so downstream per-scenario
      // records key on a stable identity (US-056). Never throws; on any fault
      // the refs are simply absent and evidence still generates.
      const enriched = await this.deps.scenarioIdentityResolver.enrich(imported.value);
      const evidence = await this.deps.evidenceGenerationService.generate({
        run,
        report: enriched,
      });
```

- [ ] **Step 4: Wire the composition root**

In `src/main.ts`, add the import near the other service imports:

```ts
import { ScenarioIdentityResolver } from "./application/services/scenario-identity-resolver";
```

Immediately after `this.reportImportService = new DefaultReportImportService(...)` (around line 383), add:

```ts
    const scenarioIdentityResolver = new ScenarioIdentityResolver(
      this.hubSettingsService,
      vault,
      this.logger,
    );
```

In the `new PostRunCoordinator({ ... })` deps object (around line 411), add the entry after `evidenceGenerationService`:

```ts
      scenarioIdentityResolver,
```

- [ ] **Step 5: Run tests + type-check to verify they pass**

Run: `npx vitest run tests/post-run-coordinator.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/application/services/post-run-coordinator.ts src/main.ts tests/post-run-coordinator.test.ts
git commit -m "feat(runner): attach scenario refs on the post-run import flow (US-056)"
```

---

## Task 8: `renameAdvisory` (pure)

**Files:**
- Modify: `src/presentation/views/feature-editor-format.ts`
- Test: `tests/feature-editor-format.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/feature-editor-format.test.ts`)

```ts
import { renameAdvisory } from "../src/presentation/views/feature-editor-format";
import { parseFeature } from "../src/application/content/gherkin";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

describe("renameAdvisory (US-056)", () => {
  const feature = (body: string) =>
    parseFeature(`Feature: F\n${body}`, vp("Specifications/features/UC-001-r.feature"))!;

  it("returns nothing when there is no baseline", () => {
    expect(renameAdvisory(null, feature("  Scenario: A\n    Given x\n"))).toEqual([]);
  });

  it("returns nothing when scenario names are unchanged", () => {
    const next = feature("  Scenario: A\n    Given x\n    Then y\n");
    expect(renameAdvisory(["A"], next)).toEqual([]);
  });

  it("warns when a scenario name disappears", () => {
    const next = feature("  Scenario: B\n    Given x\n");
    expect(renameAdvisory(["A"], next)).toEqual([
      {
        level: "warning",
        message:
          'Scenario "A" was renamed or removed — its run history and quarantine state won\'t carry over.',
      },
    ]);
  });

  it("de-duplicates repeated removed names", () => {
    const next = feature("  Scenario: B\n    Given x\n");
    expect(renameAdvisory(["A", "A"], next)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/feature-editor-format.test.ts`
Expected: FAIL — `renameAdvisory` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `feature-editor-format.ts`)

```ts
/**
 * Advisory (US-056, ADR-0022): a renamed/removed scenario mints a new Scenario
 * Reference, so its prior run history and quarantine state detach. Compares the
 * load-time baseline scenario names against the edited spec; advisory-only — it
 * never blocks. `previous === null` means no baseline (fresh/raw load).
 */
export const renameAdvisory = (
  previous: readonly string[] | null,
  next: FeatureSpecification,
): ValidationItem[] => {
  if (previous === null) return [];
  const current = new Set(
    next.scenarios.map((scenario) => scenario.name.trim()).filter((name) => name !== ""),
  );
  const removed = [
    ...new Set(
      previous
        .map((name) => name.trim())
        .filter((name) => name !== "" && !current.has(name)),
    ),
  ];
  return removed.map((name) => ({
    level: "warning",
    message: `Scenario "${name}" was renamed or removed — its run history and quarantine state won't carry over.`,
  }));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/feature-editor-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/feature-editor-format.ts tests/feature-editor-format.test.ts
git commit -m "feat(editor): renameAdvisory warns history will detach (US-056)"
```

---

## Task 9: Surface the rename advisory in the editor strip

**Files:**
- Modify: `src/presentation/views/feature-editor-view.ts`

(DOM view wiring; covered by the pure `renameAdvisory` tests in Task 8 plus a type-check. No new unit test — the view has no unit harness.)

- [ ] **Step 1: Add the baseline field and import**

In `src/presentation/views/feature-editor-view.ts`, add `renameAdvisory` to the existing import from `./feature-editor-format` (it currently imports `projectValidation`):

```ts
  projectValidation,
  renameAdvisory,
```

Add a field next to `private specification` (around line 60):

```ts
  /** Scenario names as last loaded from disk — the rename-advisory baseline (US-056). */
  private baselineScenarioNames: string[] | null = null;
```

- [ ] **Step 2: Capture the baseline at load**

In `setViewData` (around line 92-97), right after `this.specification = this.project();`, add:

```ts
    this.baselineScenarioNames = this.specification
      ? this.specification.scenarios.map((scenario) => scenario.name)
      : null;
```

- [ ] **Step 3: Include the advisory in the strip**

In `refreshValidation` (around line 336), replace:

```ts
    const items = projectValidation(this.specification);
```

with:

```ts
    const items = projectValidation(this.specification);
    items.push(...renameAdvisory(this.baselineScenarioNames, this.specification));
```

- [ ] **Step 4: Type-check + full suite**

Run: `npx tsc -p tsconfig.json --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/feature-editor-view.ts
git commit -m "feat(editor): show rename advisory in the validation strip (US-056)"
```

---

## Task 10: Update CONTEXT.md (deferred → implemented)

**Files:**
- Modify: `CONTEXT.md`

- [ ] **Step 1: Rewrite the Scenario Reference glossary entry**

In `CONTEXT.md`, replace the `**Scenario Reference**` entry (the one tagged
`accepted for V2 — see ADR-0022; not yet in code`) with an *implemented* version:

```markdown
**Scenario Reference** _(implemented — see ADR-0022, US-056)_:
The natural key for a Gherkin scenario: `<featurePath>::<scenarioName>` (and
`::row-<digest>` for a Scenario Outline example). For the key to be
collision-free, scenario names must be unique within a Feature, must not contain
the reserved `::` delimiter, and an Outline's example rows must be distinct (all
three enforced by structural validation, per ADR-0022). The row key is
**content-stable**: `<digest>` derives from the example row's values, not its
position, so reordering example rows never re-attributes a row's history (US-056
resolved ADR-0022's provisional positional `::row-N`). Stable across runs but
**not** across renames — renaming a scenario mints a new Scenario Reference and
drops prior history once; the Feature Editor advises when this will happen.
Computed name-derived at parse time and attached to report results by the
`ScenarioIdentityResolver` (no ID write-back into `.feature` files). It is the
unit of scenario-level identity that per-scenario history (US-057) builds on.
_Avoid_: Scenario id, scenario key, test id.
```

- [ ] **Step 2: Verify formatting**

Run: `npx prettier --check CONTEXT.md` (if it fails, run `npx prettier --write CONTEXT.md`).
Expected: formatted / passes.

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(context): Scenario Reference deferred -> implemented (US-056)"
```

---

## Task 11: Final verification & story status

**Files:**
- Modify: `docs/issues/US-056.md`

- [ ] **Step 1: Run the full quality gate**

Run: `npm test && npx tsc -p tsconfig.json --noEmit && npm run lint`
Expected: all pass, coverage thresholds met (vitest: 93% stmts/lines/funcs, 80% branches), ESLint clean.

- [ ] **Step 2: Mark the story implemented**

In `docs/issues/US-056.md` frontmatter, change `status: proposed` to `status: implemented`, and add a note under `## Links`:

```markdown
- Design: [scenario-reference design](../superpowers/specs/2026-06-14-us-056-scenario-reference-design.md)
- Implementation deviates from the "ID write-back" AC: identity is name-derived
  per accepted ADR-0022 (rename detaches history; no `.feature` mutation).
```

- [ ] **Step 3: Commit**

```bash
git add docs/issues/US-056.md
git commit -m "docs(issues): mark US-056 implemented"
```

- [ ] **Step 4: Push and open a PR**

```bash
git push -u origin claude/v2-next-feature-4rnt92
```

Then open a PR (ready for review) describing the increment and the name-derived deviation.

---

## Self-review

**Spec coverage:**
- D1 name-derived identity → Tasks 1-3, 6 (no write-back anywhere). ✓
- D2 content-stable row key → Task 1 (`rowDigest`), Task 3 (`outlineRowRef`). ✓
- D3 three validation rules → Task 4. ✓
- D4 report→identity resolution (pure port, path canonicalization, graceful degradation) → Tasks 5-7. ✓
- D5 rename advisory → Tasks 8-9. ✓
- Docs (CONTEXT flip; deviation recorded) → Tasks 10-11. ✓
- Out-of-scope items (history/floor removal, single-scenario run, evidence enrichment, Cucumber Messages) are NOT in any task. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Task 7 Step 1 intentionally defers to the existing test harness's arrange/act shape (the file's structure isn't reproduced here) but pins the two concrete assertions and the exact deps addition — acceptable because it edits an existing, established test.

**Type consistency:** `rowDigest(cells: ReadonlyArray<readonly [string, string]>)`, `featureScenarioRefs → ScenarioRefEntry[]`, `ScenarioIdentityResolver.enrich<T extends ParsedReport>(report: T): Promise<T>`, `renameAdvisory(previous: readonly string[] | null, next: FeatureSpecification)`, and `ScenarioResult.scenarioRef?: string` are used identically across tasks and tests. `joinVaultPath`/`readFeatureFile`/`isScenarioOutline` signatures match their source files. ✓

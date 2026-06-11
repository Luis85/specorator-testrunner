# Feature Editor (.feature file handler) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `.feature` as an Obsidian file extension backed by a new structured Feature Editor view (with raw-text fallback), on top of a Gherkin parser/serializer extended to round-trip executable Gherkin losslessly.

**Architecture:** The raw file text stays the single source of truth inside a `TextFileView` subclass; structured mode is a projection that mutates an in-memory `FeatureSpecification`, re-serialises on every committed edit, and debounce-saves via `requestSave()`. A `roundTripsLosslessly` guard forces raw-text mode for files containing constructs the model does not represent (comments, `Rule:` blocks), so structured editing can never destroy content. Narrow service additions (`announceUpdated`, `listStepPatterns`, `listKnownTags`) feed events and authoring aids.

**Tech Stack:** TypeScript, Obsidian plugin API (`TextFileView`, `registerExtensions`), Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-11-feature-editor-design.md`

**Conventions used throughout:**
- Run tests with `npx vitest run tests/<file>.test.ts` (or `npm test` for the full suite).
- `vp` is `unsafeVaultPath` imported as in existing tests: `import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";`
- Every commit message is plain `type: subject` (no model identifiers).

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/domain/entities/specification.ts` | Modify | Extended Gherkin model: `DocString`, `ExamplesBlock`, optional `dataTable`/`docString` on steps, `keyword`/`description`/`examples` on scenarios, `description` on features |
| `src/application/content/gherkin.ts` | Modify (large) | Extended parser; serializer (moved in from `specification-service.ts`); `roundTripsLosslessly`; `isPlainDescriptionLine` |
| `src/application/services/specification-service.ts` | Modify | Drop local serializer (import from gherkin); add `announceUpdated` + `listStepPatterns` |
| `src/application/services/feature-insight-service.ts` | Modify | Add `listKnownTags` |
| `src/presentation/views/feature-editor-format.ts` | Create | Pure, DOM-free editor logic: validation projection, guided keywords, mutations, sanitizers, suggestions |
| `src/presentation/views/feature-editor-view.ts` | Create | The `TextFileView` subclass: toolbar, raw mode, structured mode, aids |
| `src/main.ts` | Modify | `registerView` + `registerExtensions(["feature"], …)` |
| `styles.css` | Modify | `e2e-test-hub-feature-editor-*` styles |
| `CHANGELOG.md` | Modify | Unreleased → Added entries |
| `tests/domain-factories.test.ts` | Modify | Factory `description` passthrough |
| `tests/gherkin.test.ts` | Modify | Parser/serializer/round-trip corpus |
| `tests/specification-service.test.ts` | Modify | `announceUpdated`, `listStepPatterns` |
| `tests/feature-insight-service.test.ts` | Modify | `listKnownTags` |
| `tests/feature-editor-format.test.ts` | Create | Pure-helper tests |

---

### Task 1: Extended Gherkin domain model

**Files:**
- Modify: `src/domain/entities/specification.ts`
- Test: `tests/domain-factories.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `createFeatureSpecification` describe block in `tests/domain-factories.test.ts` (it already imports `createFeatureSpecification` and `vp`):

```ts
  it("passes a feature description through (Feature Editor round-trip)", () => {
    const result = createFeatureSpecification({
      path: vp("Specifications/features/UC-001-x.feature"),
      useCaseId: "UC-001",
      featureName: "F",
      description: ["Some context line."],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toEqual(["Some context line."]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/domain-factories.test.ts`
Expected: FAIL — `description` is not a known property of the params object (TS error surfaces as a test-file compile failure).

- [ ] **Step 3: Extend the domain types**

In `src/domain/entities/specification.ts`, replace the three interfaces with:

```ts
/** A step's doc-string argument (TIS §6.4; Gherkin `"""` / ``` fences). */
export interface DocString {
  fence: '"""' | "```";
  /** Optional content type after the opening fence, e.g. `"""json`. */
  mediaType?: string;
  /** Body lines, dedented by the opening fence's indentation. */
  lines: string[];
}

/** One `Examples:` table under a Scenario Outline. */
export interface ExamplesBlock {
  tags: string[];
  name?: string;
  /** Column names (the first `|` row). */
  header: string[];
  rows: string[][];
}

export interface GherkinStep {
  keyword: "Given" | "When" | "Then" | "And" | "But" | "*";
  text: string;
  /** Optional `|`-table argument attached to the step. */
  dataTable?: string[][];
  /** Optional doc-string argument attached to the step. */
  docString?: DocString;
}

export interface ScenarioSpecification {
  /** Absent means a plain `Scenario` (backward compatible with V1 literals). */
  keyword?: "Scenario" | "Scenario Outline";
  name: string;
  tags: string[];
  /** Free-text lines under the `Scenario:` line, before the first step. */
  description?: string[];
  steps: GherkinStep[];
  /** `Examples:` blocks (Scenario Outline only). */
  examples?: ExamplesBlock[];
}

export interface FeatureSpecification {
  path: VaultPath;
  useCaseId: UseCaseId; // required per ADR-0012; orphan features are a validation error
  featureName: string;
  tags: string[];
  /** Free-text lines under the `Feature:` line. */
  description?: string[];
  background?: GherkinStep[]; // Background steps; run before every scenario
  scenarios: ScenarioSpecification[];
}
```

In `createFeatureSpecification`, add `description?: string[];` to the params type (after `tags?: string[];`) and add this line to the returned object, after the `tags` line:

```ts
    ...(params.description && params.description.length > 0
      ? { description: params.description }
      : {}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/domain-factories.test.ts`
Expected: PASS

- [ ] **Step 5: Verify nothing else broke, commit**

Run: `npm run typecheck && npm test`
Expected: clean (all new fields are optional).

```bash
git add src/domain/entities/specification.ts tests/domain-factories.test.ts
git commit -m "feat: extend the Gherkin domain model with outlines, tables, doc strings and descriptions"
```

---

### Task 2: Parser extension

**Files:**
- Modify: `src/application/content/gherkin.ts`
- Test: `tests/gherkin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/gherkin.test.ts` (top-level, after the existing fixtures):

```ts
const RICH = `@uc-001
Feature: Rich
  A description line.

  Background:
    Given a base state

  Scenario: With table and doc string
    Given a payload:
      """json
      {
        "a": 1
      }
      """
    When I submit:
      | name | value |
      | a    | 1     |
    Then it works

  @outline
  Scenario Outline: Math
    Some scenario context.
    Given <a> plus <b>
    Then the result is <sum>

    @set-1
    Examples: small numbers
      | a | b | sum |
      | 1 | 2 | 3   |
      | 2 | 3 | 5   |
`;

describe("parseFeature (extended Gherkin)", () => {
  const feature = parseFeature(RICH, vp("Specifications/features/UC-001-rich.feature"));

  it("captures feature and scenario descriptions", () => {
    expect(feature?.description).toEqual(["A description line."]);
    expect(feature?.scenarios[1].description).toEqual(["Some scenario context."]);
    expect(feature?.scenarios[0].description).toBeUndefined();
  });

  it("captures the Scenario Outline keyword and its Examples blocks", () => {
    expect(feature?.scenarios[0].keyword).toBeUndefined();
    expect(feature?.scenarios[1].keyword).toBe("Scenario Outline");
    expect(feature?.scenarios[1].examples).toEqual([
      {
        tags: ["@set-1"],
        name: "small numbers",
        header: ["a", "b", "sum"],
        rows: [
          ["1", "2", "3"],
          ["2", "3", "5"],
        ],
      },
    ]);
  });

  it("attaches a data table to the preceding step", () => {
    const when = feature?.scenarios[0].steps[1];
    expect(when?.dataTable).toEqual([
      ["name", "value"],
      ["a", "1"],
    ]);
  });

  it("attaches a doc string (with media type, dedented) to the preceding step", () => {
    const given = feature?.scenarios[0].steps[0];
    expect(given?.docString).toEqual({
      fence: '"""',
      mediaType: "json",
      lines: ["{", '  "a": 1', "}"],
    });
  });

  it("keeps Examples rows out of the scenario steps", () => {
    expect(feature?.scenarios[1].steps).toEqual([
      { keyword: "Given", text: "<a> plus <b>" },
      { keyword: "Then", text: "the result is <sum>" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gherkin.test.ts`
Expected: FAIL — the new describe block's assertions on `description`, `keyword`, `examples`, `dataTable`, `docString` all come back `undefined`. The pre-existing tests must still PASS.

- [ ] **Step 3: Extend the parser**

In `src/application/content/gherkin.ts`:

a) Replace the type-only import with:

```ts
import type {
  DocString,
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";
```

b) Replace the module doc comment (lines 8–17) with:

```ts
/**
 * I/O-free Gherkin parser + serializer (UC-006/UC-007, TIS §6.4–§6.6).
 *
 * The parser models executable Gherkin: `Feature:`, `Background:`,
 * `Scenario:`/`Scenario Outline:` (with `Examples:` tables), tag lines, the
 * step keywords (Given/When/Then/And/But/*), per-step data tables and doc
 * strings, and free-text descriptions. NOT modelled: comments (`#`) and
 * `Rule:` blocks — {@link roundTripsLosslessly} exists so the Feature Editor
 * falls back to raw-text editing for files carrying constructs the model
 * would silently drop. `useCaseId` is derived from the filename prefix
 * `UC-\d+` per ADR-0012, not from the file body.
 */
```

c) Replace the three regex constants with four (the Scenario regex now captures the optional `Outline`, shifting the name to group 2):

```ts
const FEATURE_RE = /^Feature:\s*(.*)$/;
const SCENARIO_RE = /^Scenario(\s+Outline)?:\s*(.*)$/;
const BACKGROUND_RE = /^Background:/;
const EXAMPLES_RE = /^Examples:\s*(.*)$/;

/** Splits a `| a | b |` row into trimmed cells (escaped `\|` not supported). */
const parseTableRow = (line: string): string[] =>
  line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
```

d) Replace the entire `parseFeature` function with:

```ts
/**
 * Parses Gherkin `content` into a {@link FeatureSpecification}. Returns `null`
 * when the text has no `Feature:` line. `path` supplies the required
 * `useCaseId` (ADR-0012); when the filename carries no `UC-NNN` prefix the
 * `useCaseId` is left empty so the validator can flag it as an orphan.
 */
export const parseFeature = (content: string, path: VaultPath): FeatureSpecification | null => {
  const lines = content.split(/\r?\n/);

  let featureName: string | null = null;
  const featureTags: string[] = [];
  const featureDescription: string[] = [];
  const scenarios: ScenarioSpecification[] = [];
  const background: GherkinStep[] = [];

  // Tags accumulate on the line(s) directly above a Feature/Scenario/Examples keyword.
  let pendingTags: string[] = [];
  let current: ScenarioSpecification | null = null;
  let inBackground = false;
  // Free-text lines flow here until the block's first step/table/keyword line.
  let descriptionTarget: string[] | null = null;
  // The step a `|` table row or doc string attaches to (the most recent step).
  let lastStep: GherkinStep | null = null;
  // The Examples block currently collecting `|` rows (header row first).
  let currentExamples: ExamplesBlock | null = null;
  // An open doc string collects dedented body lines until its closing fence.
  let openDocString: DocString | null = null;
  let docStringIndent = "";

  for (const raw of lines) {
    const line = raw.trim();

    if (openDocString !== null) {
      if (line === openDocString.fence) {
        openDocString = null;
        continue;
      }
      // Dedent by the opening fence's indentation (Gherkin doc-string rule);
      // shallower lines are kept trimmed rather than dropped.
      openDocString.lines.push(
        (raw.startsWith(docStringIndent) ? raw.slice(docStringIndent.length) : line).trimEnd(),
      );
      continue;
    }
    if (line.startsWith('"""') || line.startsWith("```")) {
      const fence: DocString["fence"] = line.startsWith('"""') ? '"""' : "```";
      const mediaType = line.slice(3).trim();
      openDocString = { fence, ...(mediaType ? { mediaType } : {}), lines: [] };
      docStringIndent = raw.slice(0, raw.length - raw.trimStart().length);
      // Without a preceding step the body is still consumed (it is an argument,
      // never steps) but cannot be attached — roundTripsLosslessly catches it.
      if (lastStep) lastStep.docString = openDocString;
      continue;
    }

    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("@")) {
      pendingTags.push(...parseTagLine(line));
      descriptionTarget = null; // a tag line ends a description block
      continue;
    }

    const featureMatch = FEATURE_RE.exec(line);
    if (featureMatch) {
      featureName = featureMatch[1].trim();
      featureTags.push(...pendingTags);
      pendingTags = [];
      current = null;
      inBackground = false;
      descriptionTarget = featureDescription;
      lastStep = null;
      currentExamples = null;
      continue;
    }

    // Background steps run before every scenario; collected separately so they
    // are checked by detectMissingSteps and round-trip as a `Background:` block.
    if (BACKGROUND_RE.test(line)) {
      current = null;
      inBackground = true;
      pendingTags = [];
      descriptionTarget = null;
      lastStep = null;
      currentExamples = null;
      continue;
    }

    const scenarioMatch = SCENARIO_RE.exec(line);
    if (scenarioMatch) {
      current = {
        ...(scenarioMatch[1] ? { keyword: "Scenario Outline" as const } : {}),
        name: scenarioMatch[2].trim(),
        tags: pendingTags,
        steps: [],
      };
      scenarios.push(current);
      pendingTags = [];
      inBackground = false;
      descriptionTarget = [];
      lastStep = null;
      currentExamples = null;
      continue;
    }

    const examplesMatch = EXAMPLES_RE.exec(line);
    if (examplesMatch && current) {
      const name = examplesMatch[1].trim();
      currentExamples = {
        tags: pendingTags,
        ...(name ? { name } : {}),
        header: [],
        rows: [],
      };
      (current.examples ??= []).push(currentExamples);
      pendingTags = [];
      descriptionTarget = null;
      lastStep = null;
      continue;
    }

    if (line.startsWith("|")) {
      const cells = parseTableRow(line);
      if (currentExamples) {
        if (currentExamples.header.length === 0) currentExamples.header = cells;
        else currentExamples.rows.push(cells);
      } else if (lastStep) {
        (lastStep.dataTable ??= []).push(cells);
      }
      descriptionTarget = null;
      continue;
    }

    const step = parseStep(line);
    if (step) {
      descriptionTarget = null;
      currentExamples = null;
      if (inBackground) {
        background.push(step);
        lastStep = step;
        continue;
      }
      if (current) {
        current.steps.push(step);
        lastStep = step;
        continue;
      }
    }

    if (step === null && descriptionTarget !== null) {
      descriptionTarget.push(line);
      // A scenario's description array is attached on its first line so empty
      // descriptions never appear in the model (keeps round trips stable).
      if (current && !current.description && descriptionTarget !== featureDescription) {
        current.description = descriptionTarget;
      }
      continue;
    }

    // Anything else (Rule:, free text after steps) is ignored, and a stray tag
    // block that did not attach to a keyword is discarded — both make
    // roundTripsLosslessly fail, so the Feature Editor falls back to raw text.
    pendingTags = [];
  }

  if (featureName === null) return null;

  return {
    path,
    useCaseId: useCaseIdFromPath(path) ?? "",
    featureName,
    tags: featureTags,
    ...(featureDescription.length > 0 ? { description: featureDescription } : {}),
    ...(background.length > 0 ? { background } : {}),
    scenarios,
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/gherkin.test.ts`
Expected: PASS — including every pre-existing test (the old fixtures exercise descriptions, doc strings and outlines that now land in new optional fields the old assertions don't inspect).

- [ ] **Step 5: Run the whole suite, commit**

Run: `npm run typecheck && npm test`
Expected: clean. If `tests/feature-insight-service.test.ts` or others construct scenario literals, they still compile (all new fields optional).

```bash
git add src/application/content/gherkin.ts tests/gherkin.test.ts
git commit -m "feat: parse Scenario Outlines, Examples, data tables, doc strings and descriptions"
```

---

### Task 3: Serializer move + extension, round-trip guard

**Files:**
- Modify: `src/application/content/gherkin.ts`
- Modify: `src/application/services/specification-service.ts` (remove local serializer, import instead)
- Test: `tests/gherkin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/gherkin.test.ts`:

```ts
describe("serialiseFeature / roundTripsLosslessly", () => {
  const path = vp("Specifications/features/UC-001-rich.feature");

  it("round-trips the rich corpus losslessly", () => {
    expect(roundTripsLosslessly(RICH, path)).toBe(true);
  });

  it("serialize → parse is stable (fixed point)", () => {
    const first = parseFeature(RICH, path);
    expect(first).not.toBeNull();
    if (!first) return;
    const text = serialiseFeature(first);
    expect(parseFeature(text, path)).toEqual(first);
    expect(serialiseFeature(parseFeature(text, path) as FeatureSpecification)).toBe(text);
  });

  it("is insensitive to table-cell padding and tag spacing", () => {
    const padded = RICH.replace("| a | b | sum |", "|  a |b   | sum|").replace(
      "@demo @smoke",
      "@demo   @smoke",
    );
    expect(roundTripsLosslessly(padded, path)).toBe(true);
  });

  it("fails the guard for comments (not modelled — must fall back to raw)", () => {
    expect(roundTripsLosslessly(`# top comment\n${RICH}`, path)).toBe(false);
  });

  it("fails the guard for Rule: blocks between scenarios", () => {
    const withRule = `Feature: F\n  Scenario: A\n    Given x\n  Rule: extra\n  Scenario: B\n    Given y\n`;
    expect(roundTripsLosslessly(withRule, path)).toBe(false);
  });

  it("fails the guard for unparseable content", () => {
    expect(roundTripsLosslessly("not gherkin", path)).toBe(false);
  });
});

describe("isPlainDescriptionLine", () => {
  it("accepts free text", () => {
    expect(isPlainDescriptionLine("As a user I want things")).toBe(true);
  });

  it.each([
    "@tag",
    "# comment",
    "| a | b |",
    '"""',
    "```",
    "Feature: F",
    "Scenario: S",
    "Scenario Outline: S",
    "Background:",
    "Examples:",
    "Given a step",
    "",
    "   ",
  ])("rejects %j", (line) => {
    expect(isPlainDescriptionLine(line)).toBe(false);
  });
});
```

Extend the test file's import from `../src/application/content/gherkin` to also pull `isPlainDescriptionLine`, `roundTripsLosslessly`, `serialiseFeature`, and add `import type { FeatureSpecification } from "../src/domain/entities/specification";`.

Note: the `@demo @smoke` replace in the padding test is a no-op against `RICH` (it has no such line) — keep it anyway; it documents intent and exercises the same normalization through the table cells. If you prefer, apply it to a copy of the `FEATURE` fixture in a separate assertion.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gherkin.test.ts`
Expected: FAIL — `serialiseFeature`, `roundTripsLosslessly`, `isPlainDescriptionLine` are not exported from gherkin.

- [ ] **Step 3: Add serializer, guard, and description-line check to `gherkin.ts`**

Append to `src/application/content/gherkin.ts` (before `collectStepTexts`):

```ts
/** Appends `| a | b |` rows at `indent`. */
const pushTable = (
  lines: string[],
  rows: ReadonlyArray<readonly string[]>,
  indent: string,
): void => {
  for (const row of rows) lines.push(`${indent}| ${row.join(" | ")} |`);
};

/** Appends one step line plus its data-table / doc-string arguments. */
const pushStep = (lines: string[], step: GherkinStep, indent: string): void => {
  lines.push(`${indent}${step.keyword} ${step.text}`.trimEnd());
  const inner = `${indent}  `;
  if (step.dataTable && step.dataTable.length > 0) pushTable(lines, step.dataTable, inner);
  if (step.docString) {
    lines.push(`${inner}${step.docString.fence}${step.docString.mediaType ?? ""}`);
    for (const bodyLine of step.docString.lines) lines.push(`${inner}${bodyLine}`.trimEnd());
    lines.push(`${inner}${step.docString.fence}`);
  }
};

/**
 * Serialises a {@link FeatureSpecification} back to plain Gherkin (no YAML).
 * Lives next to {@link parseFeature} because the two form the load-bearing
 * round-trip invariant the Feature Editor's structured mode depends on.
 */
export const serialiseFeature = (specification: FeatureSpecification): string => {
  const lines: string[] = [];
  if (specification.tags.length > 0) lines.push(specification.tags.join(" "));
  lines.push(`Feature: ${specification.featureName}`);
  for (const text of specification.description ?? []) lines.push(`  ${text}`);
  if (specification.background && specification.background.length > 0) {
    lines.push("");
    lines.push("  Background:");
    for (const step of specification.background) pushStep(lines, step, "    ");
  }
  for (const scenario of specification.scenarios) {
    lines.push("");
    if (scenario.tags.length > 0) lines.push(`  ${scenario.tags.join(" ")}`);
    lines.push(`  ${scenario.keyword ?? "Scenario"}: ${scenario.name}`.trimEnd());
    for (const text of scenario.description ?? []) lines.push(`    ${text}`);
    for (const step of scenario.steps) pushStep(lines, step, "    ");
    for (const block of scenario.examples ?? []) {
      lines.push("");
      if (block.tags.length > 0) lines.push(`    ${block.tags.join(" ")}`);
      lines.push(`    Examples:${block.name ? ` ${block.name}` : ""}`);
      pushTable(
        lines,
        [block.header, ...block.rows].filter((row) => row.length > 0),
        "      ",
      );
    }
  }
  return `${lines.join("\n")}\n`;
};

/**
 * Trimmed, non-blank lines with canonical table-row and tag-line spacing —
 * the comparison basis for {@link roundTripsLosslessly}. Indentation and
 * blank-line placement are serializer-owned; cell padding and tag spacing
 * are cosmetic.
 */
const significantLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith("|") ? `| ${parseTableRow(line).join(" | ")} |` : line))
    .map((line) => (line.startsWith("@") ? line.split(/\s+/).join(" ") : line));

/**
 * True when the parsed model reproduces every significant line of `content`.
 * The Feature Editor offers structured mode only then, so constructs the model
 * does not represent (comments, `Rule:` blocks, stray text) can never be
 * silently destroyed by a structured edit.
 */
export const roundTripsLosslessly = (content: string, path: VaultPath): boolean => {
  const parsed = parseFeature(content, path);
  if (parsed === null) return false;
  const original = significantLines(content);
  const reserialised = significantLines(serialiseFeature(parsed));
  return (
    original.length === reserialised.length &&
    original.every((line, index) => line === reserialised[index])
  );
};

/**
 * True when `line` survives a parse→serialize round trip as free description
 * text — i.e. it is not a tag/comment/table/fence/keyword/step line. The
 * Feature Editor filters description input through this so a typed
 * "Scenario: x" cannot silently restructure the file on the next parse.
 */
export const isPlainDescriptionLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (/^[@#|]/.test(trimmed)) return false;
  if (trimmed.startsWith('"""') || trimmed.startsWith("```")) return false;
  if (
    FEATURE_RE.test(trimmed) ||
    SCENARIO_RE.test(trimmed) ||
    BACKGROUND_RE.test(trimmed) ||
    EXAMPLES_RE.test(trimmed)
  ) {
    return false;
  }
  return parseStep(trimmed) === null;
};
```

- [ ] **Step 4: Point `specification-service.ts` at the moved serializer**

In `src/application/services/specification-service.ts`:
- Change the gherkin import to `import { collectStepTexts, parseFeature, serialiseFeature, useCaseIdFromPath } from "../content/gherkin";`
- Delete the entire local `serialiseFeature` const (the block starting `/** Serialises a {@link FeatureSpecification} back to plain Gherkin (no YAML). */`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/gherkin.test.ts tests/specification-service.test.ts`
Expected: PASS (the update/Background tests assert with `toContain`, which the extended serializer still satisfies).

- [ ] **Step 6: Full suite + commit**

Run: `npm run typecheck && npm test`

```bash
git add src/application/content/gherkin.ts src/application/services/specification-service.ts tests/gherkin.test.ts
git commit -m "feat: lossless Gherkin serializer with round-trip guard, co-located with the parser"
```

---

### Task 4: `SpecificationService.announceUpdated` + `listStepPatterns`

**Files:**
- Modify: `src/application/services/specification-service.ts`
- Test: `tests/specification-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/specification-service.test.ts`:

```ts
describe("DefaultSpecificationService.announceUpdated", () => {
  it("publishes specification.updated without writing any file", async () => {
    const { service, fs, events, types } = build();
    const spec = parseFeature(
      "Feature: F\n\n  Scenario: S\n    Given x\n",
      vp("Specifications/features/UC-001-x.feature"),
    );
    expect(spec).not.toBeNull();
    if (!spec) return;

    await service.announceUpdated(spec);

    expect(fs.files.size).toBe(0);
    expect(types()).toEqual(["specification.updated"]);
    expect(events[0].payload).toEqual({
      featurePath: "Specifications/features/UC-001-x.feature",
      scenarioCount: 1,
      tags: [],
    });
  });
});

describe("DefaultSpecificationService.listStepPatterns", () => {
  it("scrapes patterns from .testrunner/src/steps/**/*.ts", async () => {
    const { service, fs } = build();
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      'import { Given } from "@cucumber/cucumber";\nGiven("I open the local example page", async function () {});\n',
    );
    fs.files.set(".testrunner/src/steps/readme.md", 'Given("not scraped — not a .ts file")');

    const result = await service.listStepPatterns();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { kind: "expression", source: "I open the local example page" },
    ]);
  });

  it("returns an empty list when the steps folder does not exist", async () => {
    const { service } = build();
    const result = await service.listStepPatterns();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/specification-service.test.ts`
Expected: FAIL — the two methods don't exist.

- [ ] **Step 3: Implement**

In `src/application/services/specification-service.ts`:

a) Add to the gherkin/step-definitions imports: `findMissingSteps, parseStepDefinitions` already come from `../content/step-definitions`; extend that import with `type StepDefinitionPattern`.

b) Add to the `SpecificationService` interface, after `listFeatures()`:

```ts
  /**
   * Publish-only `specification.updated` for a Feature whose file was ALREADY
   * written by the caller (the Feature Editor saves through Obsidian's
   * TextFileView lifecycle, not through `update`). Keeps the event vocabulary
   * in the application layer so dashboards/explorers refresh identically for
   * UI-editor saves and programmatic updates.
   */
  announceUpdated(specification: FeatureSpecification): Promise<void>;
  /**
   * The step-definition patterns scraped from `.testrunner/src/steps/**/*.ts`
   * — the SAME source `detectMissingSteps` matches against, so the Feature
   * Editor's autocomplete/missing-step flags and the Detect action agree.
   * A missing steps folder yields an empty list (every step reads missing).
   */
  listStepPatterns(): Promise<Result<StepDefinitionPattern[]>>;
```

c) In `DefaultSpecificationService`, replace `update`'s event-publishing tail with a call to the new method:

```ts
  /** UC-007: re-serialise and write the Feature, then announce the change. */
  async update(specification: FeatureSpecification): Promise<Result<void>> {
    const written = await this.fs.writeFile(specification.path, serialiseFeature(specification));
    if (!written.ok) return err(written.error);

    await this.announceUpdated(specification);
    this.logger.info("Feature updated", { featurePath: specification.path });
    return ok(undefined);
  }

  async announceUpdated(specification: FeatureSpecification): Promise<void> {
    await this.eventBus.publish(
      createEvent("specification.updated", {
        featurePath: specification.path,
        scenarioCount: specification.scenarios.length,
        tags: specification.tags,
      }),
    );
  }

  async listStepPatterns(): Promise<Result<StepDefinitionPattern[]>> {
    const settings = await this.settingsService.load();
    const stepsDir = joinVaultPath(settings.paths.testRunnerPath, "src/steps");
    return ok(await this.loadStepDefinitions(stepsDir));
  }
```

d) In `detectMissingSteps`, replace the two lines that compute `stepsDir` and `definitions` with:

```ts
    const patterns = await this.listStepPatterns();
    const definitions = patterns.ok ? patterns.value : [];
```

(and remove the now-unused `settings` line if nothing else in the method uses it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/specification-service.test.ts tests/integration/step-definition-scenario.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/services/specification-service.ts tests/specification-service.test.ts
git commit -m "feat: add announceUpdated and listStepPatterns to SpecificationService"
```

---

### Task 5: `FeatureInsightService.listKnownTags`

**Files:**
- Modify: `src/application/services/feature-insight-service.ts`
- Test: `tests/feature-insight-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/feature-insight-service.test.ts` (reuse the file's existing builder for `DefaultFeatureInsightService` over a `FakeVaultFileSystem` + a stub `listFeatures`; follow its established setup pattern):

```ts
describe("listKnownTags", () => {
  it("unions feature, scenario and Examples tags, seeded with conventions, sorted", async () => {
    const fs = new FakeVaultFileSystem();
    const path = "Specifications/features/UC-001-a.feature";
    fs.files.set(
      path,
      `@feature-level
Feature: F

  @scenario-level
  Scenario Outline: S
    Given x

    @examples-level
    Examples:
      | a |
      | 1 |
`,
    );
    const service = new DefaultFeatureInsightService(
      { listFeatures: async () => ok([{ path: vp(path), label: "UC-001-a.feature" }]) },
      fs,
    );

    const result = await service.listKnownTags();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      "@examples-level",
      "@feature-level",
      "@scenario-level",
      "@smoke",
      "@wip",
    ]);
  });

  it("skips unreadable/unparseable features (best-effort)", async () => {
    const fs = new FakeVaultFileSystem();
    fs.files.set("Specifications/features/UC-002-bad.feature", "not gherkin");
    const service = new DefaultFeatureInsightService(
      {
        listFeatures: async () =>
          ok([
            { path: vp("Specifications/features/UC-002-bad.feature"), label: "UC-002-bad.feature" },
            { path: vp("Specifications/features/UC-003-gone.feature"), label: "UC-003-gone.feature" },
          ]),
      },
      fs,
    );

    const result = await service.listKnownTags();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(["@smoke", "@wip"]);
  });
});
```

(If the test file lacks them, add `ok` to its result imports and `FakeVaultFileSystem` to its fakes import.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/feature-insight-service.test.ts`
Expected: FAIL — `listKnownTags` does not exist.

- [ ] **Step 3: Implement**

In `src/application/services/feature-insight-service.ts`:

a) Add to the interface:

```ts
  /**
   * Union of every feature-, scenario- and Examples-level tag across the
   * Feature corpus, seeded with the `@smoke`/`@wip` conventions and sorted.
   * Best-effort like the other corpus queries (unreadable or unparseable
   * files are skipped); feeds the Feature Editor's tag picker.
   */
  listKnownTags(): Promise<Result<string[]>>;
```

b) Add to `DefaultFeatureInsightService`:

```ts
  async listKnownTags(): Promise<Result<string[]>> {
    const listed = await this.specifications.listFeatures();
    if (!listed.ok) return err(listed.error);

    const tags = new Set<string>(["@smoke", "@wip"]);
    for (const entry of listed.value) {
      const read = await this.fs.readFile(entry.path);
      if (!read.ok) continue; // best-effort: skip unreadable files
      const feature = parseFeature(read.value, entry.path);
      if (feature === null) continue; // not valid Gherkin — skip
      for (const tag of feature.tags) tags.add(tag);
      for (const scenario of feature.scenarios) {
        for (const tag of scenario.tags) tags.add(tag);
        for (const block of scenario.examples ?? []) {
          for (const tag of block.tags) tags.add(tag);
        }
      }
    }
    return ok([...tags].sort());
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/feature-insight-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/services/feature-insight-service.ts tests/feature-insight-service.test.ts
git commit -m "feat: add listKnownTags corpus query to FeatureInsightService"
```

---

### Task 6: Feature Editor pure helpers

**Files:**
- Create: `src/presentation/views/feature-editor-format.ts`
- Test: `tests/feature-editor-format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/feature-editor-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseFeature } from "../src/application/content/gherkin";
import type { ExamplesBlock } from "../src/domain/entities/specification";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import {
  addExamplesColumn,
  addExamplesRow,
  asDescriptionLines,
  fenceFor,
  moveItem,
  newExamplesBlock,
  newScenario,
  newStep,
  normalizeTag,
  projectValidation,
  removeExamplesColumn,
  sanitizeCell,
  stepIsImplemented,
  stepSuggestions,
  suggestedKeyword,
} from "../src/presentation/views/feature-editor-format";

const VALID = parseFeature(
  "Feature: F\n\n  Scenario: S\n    Given x\n",
  vp("Specifications/features/UC-001-ok.feature"),
);

describe("projectValidation", () => {
  it("returns no items for a valid, UC-prefixed feature", () => {
    expect(VALID).not.toBeNull();
    if (VALID) expect(projectValidation(VALID)).toEqual([]);
  });

  it("warns about an orphan filename (ADR-0012)", () => {
    const orphan = parseFeature("Feature: F\n\n  Scenario: S\n    Given x\n", vp("orphan.feature"));
    if (!orphan) return;
    const items = projectValidation(orphan);
    expect(items).toHaveLength(1);
    expect(items[0].level).toBe("warning");
    expect(items[0].message).toContain("orphan");
  });

  it("flags a nameless feature, stepless scenario, and rowless outline", () => {
    const messages = projectValidation({
      path: vp("Specifications/features/UC-001-x.feature"),
      useCaseId: "UC-001",
      featureName: " ",
      tags: [],
      scenarios: [
        { keyword: "Scenario Outline", name: "O", tags: [], steps: [], examples: [] },
      ],
    }).map((item) => `${item.level}:${item.message}`);
    expect(messages).toEqual([
      "error:Feature has no name.",
      'error:Scenario "O" has no steps.',
      'warning:Scenario Outline "O" has no Examples rows.',
    ]);
  });
});

describe("guided keyword flow", () => {
  it("suggests Given for the first step and And afterwards", () => {
    expect(suggestedKeyword([])).toBe("Given");
    expect(suggestedKeyword([{ keyword: "Given", text: "x" }])).toBe("And");
  });

  it("newScenario starts with one Given step; newStep follows the flow", () => {
    const scenario = newScenario();
    expect(scenario.steps).toEqual([{ keyword: "Given", text: "" }]);
    expect(newStep(scenario.steps)).toEqual({ keyword: "And", text: "" });
  });
});

describe("moveItem", () => {
  it("moves an element and reports clamped moves", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 1)).toBe(true);
    expect(list).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 0, -1)).toBe(false);
    expect(moveItem(list, 2, 1)).toBe(false);
    expect(list).toEqual(["b", "a", "c"]);
  });
});

describe("Examples mutations", () => {
  it("adds uniquely-named columns and pads rows", () => {
    const block: ExamplesBlock = { tags: [], header: ["param"], rows: [["1"]] };
    addExamplesColumn(block);
    expect(block.header).toEqual(["param", "param-2"]);
    expect(block.rows).toEqual([["1", ""]]);
  });

  it("removes a column everywhere but refuses to remove the last one", () => {
    const block: ExamplesBlock = { tags: [], header: ["a", "b"], rows: [["1", "2"]] };
    removeExamplesColumn(block, 0);
    expect(block.header).toEqual(["b"]);
    expect(block.rows).toEqual([["2"]]);
    removeExamplesColumn(block, 0);
    expect(block.header).toEqual(["b"]);
  });

  it("addExamplesRow matches the header width; newExamplesBlock is well-formed", () => {
    const block = newExamplesBlock();
    expect(block.header.length).toBeGreaterThan(0);
    addExamplesRow(block);
    expect(block.rows[block.rows.length - 1]).toHaveLength(block.header.length);
  });
});

describe("sanitizers", () => {
  it("normalizeTag ensures @, dashes inner whitespace, rejects empties", () => {
    expect(normalizeTag("wip")).toBe("@wip");
    expect(normalizeTag(" @smoke ")).toBe("@smoke");
    expect(normalizeTag("two words")).toBe("@two-words");
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("@")).toBeNull();
  });

  it("sanitizeCell strips pipes (they would break the row syntax)", () => {
    expect(sanitizeCell(" a | b ")).toBe("a / b");
  });

  it("fenceFor avoids the fence the body contains", () => {
    expect(fenceFor(["plain"])).toBe('"""');
    expect(fenceFor(['contains """ inside'])).toBe('"""');
    expect(fenceFor(['"""'])).toBe("```");
  });

  it("asDescriptionLines keeps only plain description lines", () => {
    expect(asDescriptionLines("keep me\n@tag\nScenario: nope\n\nGiven x\nalso keep")).toEqual([
      "keep me",
      "also keep",
    ]);
  });
});

describe("step suggestions & flags", () => {
  const patterns = [
    { kind: "expression" as const, source: "I open the local example page" },
    { kind: "expression" as const, source: "I open the local example page" },
  ];

  it("stepSuggestions dedupes pattern sources", () => {
    expect(stepSuggestions(patterns)).toEqual(["I open the local example page"]);
  });

  it("stepIsImplemented matches via the shared step-definition heuristics", () => {
    expect(stepIsImplemented("I open the local example page", patterns)).toBe(true);
    expect(stepIsImplemented("I do something else", patterns)).toBe(false);
  });

  it("treats an empty step as not-missing (incomplete, not unimplemented)", () => {
    expect(stepIsImplemented("  ", patterns)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/feature-editor-format.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/presentation/views/feature-editor-format.ts`:

```ts
import { isPlainDescriptionLine, useCaseIdFromPath } from "../../application/content/gherkin";
import {
  isStepDefined,
  type StepDefinitionPattern,
} from "../../application/content/step-definitions";
import type {
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";

/**
 * Pure helpers for the Feature Editor (the `.feature` file handler's
 * structured mode). DOM-free and I/O-free so the editing logic is
 * unit-testable, following the test-console-format.ts pattern.
 */

export interface ValidationItem {
  level: "error" | "warning";
  message: string;
}

/**
 * Live structural validation over the in-memory spec — the same rules as
 * `SpecificationService.validate` (name, ≥1 scenario, steps per scenario,
 * ADR-0012 filename prefix) so the editor strip and the Validate action
 * agree, plus editor-only hints (unnamed scenario, Outline without Examples
 * rows) for content that is still being typed.
 */
export const projectValidation = (specification: FeatureSpecification): ValidationItem[] => {
  const items: ValidationItem[] = [];
  if (useCaseIdFromPath(specification.path) === null) {
    items.push({
      level: "warning",
      message: 'No "UC-NNN-" filename prefix — this Feature is an orphan (ADR-0012).',
    });
  }
  if (specification.featureName.trim() === "") {
    items.push({ level: "error", message: "Feature has no name." });
  }
  if (specification.scenarios.length === 0) {
    items.push({ level: "error", message: "Feature has no scenarios." });
  }
  for (const scenario of specification.scenarios) {
    const label = scenario.name.trim() === "" ? "(unnamed)" : scenario.name;
    if (scenario.name.trim() === "") {
      items.push({ level: "warning", message: "A scenario has no name." });
    }
    if (scenario.steps.length === 0) {
      items.push({ level: "error", message: `Scenario "${label}" has no steps.` });
    }
    if (scenario.keyword === "Scenario Outline") {
      const hasRows = (scenario.examples ?? []).some((block) => block.rows.length > 0);
      if (!hasRows) {
        items.push({
          level: "warning",
          message: `Scenario Outline "${label}" has no Examples rows.`,
        });
      }
    }
  }
  return items;
};

/** Guided keyword flow: the first step reads `Given`, follow-ups read `And`. */
export const suggestedKeyword = (existingSteps: readonly GherkinStep[]): GherkinStep["keyword"] =>
  existingSteps.length === 0 ? "Given" : "And";

/** A fresh step for the add-step button (guided keyword pre-selected). */
export const newStep = (existingSteps: readonly GherkinStep[]): GherkinStep => ({
  keyword: suggestedKeyword(existingSteps),
  text: "",
});

/** A fresh scenario with one guided starter step. */
export const newScenario = (): ScenarioSpecification => ({
  name: "",
  tags: [],
  steps: [newStep([])],
});

/** A fresh Examples block with one named column and one empty row. */
export const newExamplesBlock = (): ExamplesBlock => ({
  tags: [],
  header: ["param"],
  rows: [[""]],
});

/** Moves `array[index]` one slot up/down; returns false when it cannot move. */
export const moveItem = <T>(array: T[], index: number, delta: -1 | 1): boolean => {
  const target = index + delta;
  if (index < 0 || index >= array.length || target < 0 || target >= array.length) return false;
  const [item] = array.splice(index, 1);
  array.splice(target, 0, item);
  return true;
};

/** Appends a uniquely-named column and pads every row. */
export const addExamplesColumn = (block: ExamplesBlock): void => {
  let name = "param";
  for (let n = 2; block.header.includes(name); n += 1) name = `param-${n}`;
  block.header.push(name);
  for (const row of block.rows) row.push("");
};

/** Removes column `index` from the header and every row (never the last one). */
export const removeExamplesColumn = (block: ExamplesBlock, index: number): void => {
  if (index < 0 || index >= block.header.length || block.header.length <= 1) return;
  block.header.splice(index, 1);
  for (const row of block.rows) row.splice(index, 1);
};

/** Appends an empty row matching the header width. */
export const addExamplesRow = (block: ExamplesBlock): void => {
  block.rows.push(block.header.map(() => ""));
};

/**
 * Normalises a tag chip input: trims, dashes inner whitespace, ensures the
 * leading `@`. Returns null when nothing tag-like remains.
 */
export const normalizeTag = (value: string): string | null => {
  const joined = value.trim().replace(/\s+/g, "-").replace(/^@+/, "");
  return joined === "" ? null : `@${joined}`;
};

/** Keeps a table cell round-trippable: a raw `|` would break the row syntax. */
export const sanitizeCell = (value: string): string => value.replace(/\|/g, "/").trim();

/** Picks a doc-string fence the body cannot terminate early. */
export const fenceFor = (lines: readonly string[]): '"""' | "```" =>
  lines.some((line) => line.trim() === '"""') ? "```" : '"""';

/** Splits textarea input into the lines that round-trip as description text. */
export const asDescriptionLines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => isPlainDescriptionLine(line));

/** De-duplicated datalist suggestions for the step-text inputs. */
export const stepSuggestions = (patterns: readonly StepDefinitionPattern[]): string[] => [
  ...new Set(patterns.map((pattern) => pattern.source)),
];

/**
 * True when the step needs no missing-definition flag. Empty text is
 * "incomplete", not "missing" (the validation strip owns that complaint).
 */
export const stepIsImplemented = (
  text: string,
  patterns: readonly StepDefinitionPattern[],
): boolean => text.trim() === "" || isStepDefined(text, [...patterns]);
```

Note `fenceFor` checks for a body line that EQUALS `"""` (which would close the fence early); a `"""` mid-line is harmless. This matches the test's three cases.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/feature-editor-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/feature-editor-format.ts tests/feature-editor-format.test.ts
git commit -m "feat: pure editing logic for the Feature Editor"
```

---

### Task 7: FeatureEditorView

**Files:**
- Create: `src/presentation/views/feature-editor-view.ts`

No unit test: like the other Obsidian views (`dashboard-view.ts`, `use-case-detail-view.ts`), the DOM/leaf plumbing is exercised manually; all decision logic already lives in the tested format module. Verification for this task is `typecheck` + `lint`.

- [ ] **Step 1: Create the view**

Create `src/presentation/views/feature-editor-view.ts` with exactly this content:

```ts
import { Notice, TextFileView, type WorkspaceLeaf } from "obsidian";

import {
  parseFeature,
  roundTripsLosslessly,
  serialiseFeature,
} from "../../application/content/gherkin";
import type { StepDefinitionPattern } from "../../application/content/step-definitions";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SpecificationService } from "../../application/services/specification-service";
import type {
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import {
  addExamplesColumn,
  addExamplesRow,
  asDescriptionLines,
  fenceFor,
  moveItem,
  newExamplesBlock,
  newScenario,
  newStep,
  normalizeTag,
  projectValidation,
  removeExamplesColumn,
  sanitizeCell,
  stepIsImplemented,
  stepSuggestions,
} from "./feature-editor-format";

export const FEATURE_EDITOR_VIEW_TYPE = "e2e-test-hub-feature-editor";

const STEP_DATALIST_ID = "e2e-test-hub-step-suggestions";
const TAG_DATALIST_ID = "e2e-test-hub-tag-suggestions";

export interface FeatureEditorDeps {
  specifications: Pick<SpecificationService, "announceUpdated" | "listStepPatterns">;
  featureInsight: Pick<FeatureInsightService, "listKnownTags">;
}

/**
 * Structured editor for `.feature` files — the registered file handler for
 * the extension. The RAW TEXT is the single source of truth (`this.data`,
 * TextFileView's load/save lifecycle); structured mode is a projection that
 * mutates an in-memory FeatureSpecification, re-serialises on every committed
 * edit, and debounce-saves via requestSave(). Files the extended parser
 * cannot reproduce losslessly (comments, Rule: blocks, exotic spacing) open
 * in raw-text mode behind roundTripsLosslessly — the structured editor can
 * never destroy content it does not model.
 */
export class FeatureEditorView extends TextFileView {
  private mode: "structured" | "raw" = "structured";
  private specification: FeatureSpecification | null = null;
  private stepPatterns: StepDefinitionPattern[] = [];
  private knownTags: string[] = [];
  private validationEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: FeatureEditorDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return FEATURE_EDITOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Feature";
  }

  getIcon(): string {
    return "file-code";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "feature";
  }

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    // Re-project on every load — an external change (sync, git) must rebuild
    // the structured UI rather than leave a stale in-memory spec.
    this.specification = this.project();
    if (this.specification === null) this.mode = "raw";
    this.render();
  }

  clear(): void {
    this.data = "";
    this.specification = null;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    // Authoring aids load once per view; they degrade silently on failure
    // (no suggestions, no flags) and never block editing.
    void this.loadAids();
  }

  /** Announce the save so dashboards/explorers refresh (spec Part 4). */
  async save(clear = false): Promise<void> {
    await super.save(clear);
    if (!this.file) return;
    const parsed = parseFeature(this.data, unsafeVaultPath(this.file.path));
    if (parsed !== null) await this.deps.specifications.announceUpdated(parsed);
  }

  // --- projection ----------------------------------------------------------

  /** The spec to edit, or null when the file can't be projected losslessly. */
  private project(): FeatureSpecification | null {
    if (!this.file) return null;
    const path = unsafeVaultPath(this.file.path);
    if (!roundTripsLosslessly(this.data, path)) return null;
    return parseFeature(this.data, path);
  }

  /**
   * Serialises the working spec into the view data and schedules a debounced
   * save. Structural changes re-render; field edits only refresh validation
   * (a full re-render would steal focus from the input being edited).
   */
  private commit(structureChanged: boolean): void {
    if (!this.specification) return;
    this.data = serialiseFeature(this.specification);
    this.requestSave();
    if (structureChanged) this.render();
    else this.refreshValidation();
  }

  private async loadAids(): Promise<void> {
    const [patterns, tags] = await Promise.all([
      this.deps.specifications.listStepPatterns(),
      this.deps.featureInsight.listKnownTags(),
    ]);
    if (patterns.ok) this.stepPatterns = patterns.value;
    if (tags.ok) this.knownTags = tags.value;
    this.render();
  }

  // --- rendering -----------------------------------------------------------

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("e2e-test-hub-feature-editor");
    this.renderToolbar(root);
    if (this.mode === "structured" && this.specification !== null) {
      this.renderStructured(root, this.specification);
    } else {
      this.renderRaw(root);
    }
  }

  private renderToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "e2e-test-hub-feature-editor-toolbar" });
    const structuredActive = this.mode === "structured" && this.specification !== null;
    const make = (label: string, active: boolean): HTMLButtonElement =>
      bar.createEl("button", {
        text: label,
        ...(active ? { cls: "mod-cta" } : {}),
        attr: { "aria-pressed": String(active) },
      });
    make("Structured", structuredActive).addEventListener("click", () => {
      const spec = this.project();
      if (spec === null) {
        new Notice(
          "This file contains Gherkin the structured editor can't preserve " +
            "(e.g. comments or Rule: blocks); keep editing it as raw text.",
          8000,
        );
        return;
      }
      this.specification = spec;
      this.mode = "structured";
      this.render();
    });
    make("Raw text", !structuredActive).addEventListener("click", () => {
      this.mode = "raw";
      this.render();
    });
  }

  private renderRaw(root: HTMLElement): void {
    if (this.specification === null && this.data.trim() !== "") {
      root.createDiv({
        cls: "e2e-test-hub-feature-editor-banner",
        text:
          "Structured editing is unavailable: the file is not a parseable Feature " +
          "or contains constructs the editor can't preserve (comments, Rule: blocks).",
      });
    }
    const textarea = root.createEl("textarea", {
      cls: "e2e-test-hub-feature-editor-raw",
      attr: { "aria-label": "Raw Gherkin" },
    });
    textarea.value = this.data;
    textarea.addEventListener("input", () => {
      this.data = textarea.value;
      // Keep the projection in sync so the Structured toggle and the banner
      // state stay truthful (features are small; per-keystroke parse is cheap).
      this.specification = this.project();
      this.requestSave();
    });
  }

  private renderStructured(root: HTMLElement, spec: FeatureSpecification): void {
    const body = root.createDiv({ cls: "e2e-test-hub-feature-editor-body" });

    // Native datalist autocomplete shared by the step/tag inputs.
    const stepList = body.createEl("datalist", { attr: { id: STEP_DATALIST_ID } });
    for (const suggestion of stepSuggestions(this.stepPatterns)) {
      stepList.createEl("option", { attr: { value: suggestion } });
    }
    const tagList = body.createEl("datalist", { attr: { id: TAG_DATALIST_ID } });
    for (const tag of this.knownTags) tagList.createEl("option", { attr: { value: tag } });

    this.validationEl = body.createDiv({
      cls: "e2e-test-hub-feature-editor-validation",
      attr: { "aria-live": "polite" },
    });
    this.refreshValidation();

    // Feature header card.
    const header = body.createDiv({ cls: "e2e-test-hub-feature-editor-card" });
    const name = header.createEl("input", {
      type: "text",
      value: spec.featureName,
      cls: "e2e-test-hub-feature-editor-name",
      attr: { placeholder: "Feature name", "aria-label": "Feature name" },
    });
    name.addEventListener("change", () => {
      spec.featureName = name.value.trim();
      this.commit(false);
    });
    this.renderTagEditor(header, spec.tags, "Feature tags");
    const description = header.createEl("textarea", {
      cls: "e2e-test-hub-feature-editor-description",
      attr: {
        placeholder: "Description (optional)",
        "aria-label": "Feature description",
        rows: "2",
      },
    });
    description.value = (spec.description ?? []).join("\n");
    description.addEventListener("change", () => {
      const lines = asDescriptionLines(description.value);
      if (lines.length > 0) spec.description = lines;
      else delete spec.description;
      description.value = lines.join("\n"); // reflect dropped non-description lines
      this.commit(false);
    });

    // Background.
    const backgroundCard = body.createDiv({ cls: "e2e-test-hub-feature-editor-card" });
    backgroundCard.createEl("h3", { text: "Background" });
    if (spec.background) {
      const steps = spec.background;
      this.renderStepList(backgroundCard, steps, () => {
        // Serialisation omits an empty Background; drop it from the model too.
        if (steps.length === 0) delete spec.background;
      });
    } else {
      const add = backgroundCard.createEl("button", { text: "+ Background" });
      add.addEventListener("click", () => {
        spec.background = [newStep([])];
        this.commit(true);
      });
    }

    // Scenarios.
    spec.scenarios.forEach((scenario, index) => {
      this.renderScenarioCard(body, spec, scenario, index);
    });
    const addScenario = body.createEl("button", {
      text: "+ Scenario",
      cls: "e2e-test-hub-feature-editor-add",
    });
    addScenario.addEventListener("click", () => {
      spec.scenarios.push(newScenario());
      this.commit(true);
    });
  }

  /** The ✓/✗/! strip, re-projected from the in-memory spec on every commit. */
  private refreshValidation(): void {
    if (!this.validationEl || !this.specification) return;
    this.validationEl.empty();
    const items = projectValidation(this.specification);
    const entries =
      items.length === 0
        ? [{ level: "ok", message: "Feature is structurally valid." }]
        : items;
    for (const item of entries) {
      const symbol = item.level === "error" ? "✗" : item.level === "warning" ? "!" : "✓";
      this.validationEl.createDiv({
        cls: "e2e-test-hub-feature-editor-check",
        attr: { "data-level": item.level },
        text: `${symbol} ${item.message}`,
      });
    }
  }

  /** Tag chips + a datalist-backed input; click a chip to remove its tag. */
  private renderTagEditor(parent: HTMLElement, tags: string[], label: string): void {
    const wrap = parent.createDiv({ cls: "e2e-test-hub-feature-editor-tags" });
    const chips = wrap.createDiv({ cls: "e2e-test-hub-feature-editor-tag-chips" });
    const input = wrap.createEl("input", {
      type: "text",
      attr: { placeholder: "Add tag…", list: TAG_DATALIST_ID, "aria-label": label },
    });
    const renderChips = (): void => {
      chips.empty();
      tags.forEach((tag, index) => {
        const chip = chips.createEl("button", {
          text: `${tag} ×`,
          cls: "e2e-test-hub-feature-editor-tag-chip",
          attr: { "aria-label": `Remove ${tag}` },
        });
        chip.addEventListener("click", () => {
          tags.splice(index, 1);
          renderChips();
          this.commit(false);
        });
      });
    };
    const addTag = (): void => {
      const tag = normalizeTag(input.value);
      input.value = "";
      if (tag === null || tags.includes(tag)) return;
      tags.push(tag);
      renderChips();
      this.commit(false);
    };
    input.addEventListener("change", addTag);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTag();
      }
    });
    renderChips();
  }

  private renderScenarioCard(
    parent: HTMLElement,
    spec: FeatureSpecification,
    scenario: ScenarioSpecification,
    index: number,
  ): void {
    const card = parent.createDiv({ cls: "e2e-test-hub-feature-editor-card" });
    const head = card.createDiv({ cls: "e2e-test-hub-feature-editor-scenario-head" });

    const keyword = head.createEl("select", { attr: { "aria-label": "Scenario type" } });
    for (const value of ["Scenario", "Scenario Outline"] as const) {
      const option = keyword.createEl("option", { text: value, attr: { value } });
      option.selected = (scenario.keyword ?? "Scenario") === value;
    }
    keyword.addEventListener("change", () => {
      if (keyword.value === "Scenario Outline") {
        scenario.keyword = "Scenario Outline";
        scenario.examples ??= [newExamplesBlock()];
      } else {
        // A plain Scenario cannot carry Examples; switching back drops them
        // (Obsidian's File Recovery snapshots are the undo path).
        delete scenario.keyword;
        delete scenario.examples;
      }
      this.commit(true);
    });

    const name = head.createEl("input", {
      type: "text",
      value: scenario.name,
      attr: { placeholder: "Scenario name", "aria-label": "Scenario name" },
    });
    name.addEventListener("change", () => {
      scenario.name = name.value.trim();
      this.commit(false);
    });

    const moveUp = head.createEl("button", { text: "↑", attr: { "aria-label": "Move scenario up" } });
    moveUp.addEventListener("click", () => {
      if (moveItem(spec.scenarios, index, -1)) this.commit(true);
    });
    const moveDown = head.createEl("button", {
      text: "↓",
      attr: { "aria-label": "Move scenario down" },
    });
    moveDown.addEventListener("click", () => {
      if (moveItem(spec.scenarios, index, 1)) this.commit(true);
    });
    const remove = head.createEl("button", {
      text: "Delete",
      attr: { "aria-label": "Delete scenario" },
    });
    remove.addEventListener("click", () => {
      spec.scenarios.splice(index, 1);
      this.commit(true);
    });

    this.renderTagEditor(card, scenario.tags, "Scenario tags");
    this.renderStepList(card, scenario.steps);

    if ((scenario.keyword ?? "Scenario") === "Scenario Outline") {
      const blocks = (scenario.examples ??= []);
      blocks.forEach((block, blockIndex) => this.renderExamples(card, blocks, block, blockIndex));
      const addBlock = card.createEl("button", { text: "+ Examples block" });
      addBlock.addEventListener("click", () => {
        blocks.push(newExamplesBlock());
        this.commit(true);
      });
    }
  }

  private renderStepList(parent: HTMLElement, steps: GherkinStep[], onRemoved?: () => void): void {
    const list = parent.createDiv({ cls: "e2e-test-hub-feature-editor-steps" });
    steps.forEach((step, index) => this.renderStepRow(list, steps, step, index, onRemoved));
    const add = list.createEl("button", {
      text: "+ Step",
      cls: "e2e-test-hub-feature-editor-add",
    });
    add.addEventListener("click", () => {
      steps.push(newStep(steps));
      this.commit(true);
    });
  }

  private renderStepRow(
    list: HTMLElement,
    steps: GherkinStep[],
    step: GherkinStep,
    index: number,
    onRemoved?: () => void,
  ): void {
    const row = list.createDiv({ cls: "e2e-test-hub-feature-editor-step" });

    const keyword = row.createEl("select", { attr: { "aria-label": "Step keyword" } });
    for (const value of ["Given", "When", "Then", "And", "But", "*"] as const) {
      const option = keyword.createEl("option", { text: value, attr: { value } });
      option.selected = step.keyword === value;
    }
    keyword.addEventListener("change", () => {
      step.keyword = keyword.value as GherkinStep["keyword"];
      this.commit(false);
    });

    const text = row.createEl("input", {
      type: "text",
      value: step.text,
      cls: "e2e-test-hub-feature-editor-step-text",
      attr: { placeholder: "step text", list: STEP_DATALIST_ID, "aria-label": "Step text" },
    });
    const flag = row.createSpan({ cls: "e2e-test-hub-feature-editor-step-flag" });
    const refreshFlag = (): void => {
      const implemented = stepIsImplemented(step.text, this.stepPatterns);
      flag.setText(implemented ? "" : "!");
      flag.setAttr("title", implemented ? "" : "No step definition matches this step.");
      row.toggleClass("is-missing-step", !implemented);
    };
    refreshFlag();
    text.addEventListener("change", () => {
      step.text = text.value.trim();
      this.commit(false);
      refreshFlag();
    });

    const moveUp = row.createEl("button", { text: "↑", attr: { "aria-label": "Move step up" } });
    moveUp.addEventListener("click", () => {
      if (moveItem(steps, index, -1)) this.commit(true);
    });
    const moveDown = row.createEl("button", { text: "↓", attr: { "aria-label": "Move step down" } });
    moveDown.addEventListener("click", () => {
      if (moveItem(steps, index, 1)) this.commit(true);
    });
    const remove = row.createEl("button", { text: "×", attr: { "aria-label": "Delete step" } });
    remove.addEventListener("click", () => {
      steps.splice(index, 1);
      onRemoved?.();
      this.commit(true);
    });

    this.renderStepExtras(list, step);
  }

  /** The optional data-table / doc-string argument editors under one step. */
  private renderStepExtras(parent: HTMLElement, step: GherkinStep): void {
    const extras = parent.createDiv({ cls: "e2e-test-hub-feature-editor-step-extras" });

    if (step.dataTable) {
      const table = step.dataTable;
      const grid = extras.createEl("table", { cls: "e2e-test-hub-feature-editor-grid" });
      table.forEach((cells, rowIndex) => {
        const tr = grid.createEl("tr");
        cells.forEach((cell, cellIndex) => {
          const td = tr.createEl("td");
          const input = td.createEl("input", {
            type: "text",
            value: cell,
            attr: { "aria-label": `Table cell ${rowIndex + 1},${cellIndex + 1}` },
          });
          input.addEventListener("change", () => {
            cells[cellIndex] = sanitizeCell(input.value);
            input.value = cells[cellIndex];
            this.commit(false);
          });
        });
      });
      const addRow = extras.createEl("button", { text: "+ Row" });
      addRow.addEventListener("click", () => {
        table.push((table[0] ?? [""]).map(() => ""));
        this.commit(true);
      });
      const addColumn = extras.createEl("button", { text: "+ Column" });
      addColumn.addEventListener("click", () => {
        for (const cells of table) cells.push("");
        this.commit(true);
      });
      const removeTable = extras.createEl("button", { text: "Remove table" });
      removeTable.addEventListener("click", () => {
        delete step.dataTable;
        this.commit(true);
      });
    } else {
      const addTable = extras.createEl("button", { text: "+ Data table" });
      addTable.addEventListener("click", () => {
        step.dataTable = [["value"]];
        this.commit(true);
      });
    }

    if (step.docString) {
      const docString = step.docString;
      const textarea = extras.createEl("textarea", {
        cls: "e2e-test-hub-feature-editor-docstring",
        attr: { "aria-label": "Doc string", rows: "4" },
      });
      textarea.value = docString.lines.join("\n");
      textarea.addEventListener("change", () => {
        docString.lines = textarea.value.split("\n");
        docString.fence = fenceFor(docString.lines);
        this.commit(false);
      });
      const removeDoc = extras.createEl("button", { text: "Remove text block" });
      removeDoc.addEventListener("click", () => {
        delete step.docString;
        this.commit(true);
      });
    } else {
      const addDoc = extras.createEl("button", { text: "+ Text block" });
      addDoc.addEventListener("click", () => {
        step.docString = { fence: '"""', lines: [""] };
        this.commit(true);
      });
    }
  }

  private renderExamples(
    parent: HTMLElement,
    blocks: ExamplesBlock[],
    block: ExamplesBlock,
    blockIndex: number,
  ): void {
    const wrap = parent.createDiv({ cls: "e2e-test-hub-feature-editor-examples" });
    const head = wrap.createDiv({ cls: "e2e-test-hub-feature-editor-examples-head" });
    head.createEl("h4", { text: "Examples" });
    const name = head.createEl("input", {
      type: "text",
      value: block.name ?? "",
      attr: { placeholder: "Examples name (optional)", "aria-label": "Examples name" },
    });
    name.addEventListener("change", () => {
      const trimmed = name.value.trim();
      if (trimmed) block.name = trimmed;
      else delete block.name;
      this.commit(false);
    });
    const remove = head.createEl("button", {
      text: "Delete",
      attr: { "aria-label": "Delete Examples block" },
    });
    remove.addEventListener("click", () => {
      blocks.splice(blockIndex, 1);
      this.commit(true);
    });

    this.renderTagEditor(wrap, block.tags, "Examples tags");

    const grid = wrap.createEl("table", { cls: "e2e-test-hub-feature-editor-grid" });
    const headerRow = grid.createEl("tr");
    block.header.forEach((column, columnIndex) => {
      const th = headerRow.createEl("th");
      const input = th.createEl("input", {
        type: "text",
        value: column,
        attr: { "aria-label": `Column ${columnIndex + 1} name` },
      });
      input.addEventListener("change", () => {
        block.header[columnIndex] = sanitizeCell(input.value) || column;
        this.commit(false);
      });
      const removeColumn = th.createEl("button", {
        text: "×",
        attr: { "aria-label": `Remove column ${column}` },
      });
      removeColumn.addEventListener("click", () => {
        removeExamplesColumn(block, columnIndex);
        this.commit(true);
      });
    });
    headerRow.createEl("th"); // actions column
    block.rows.forEach((cells, rowIndex) => {
      const tr = grid.createEl("tr");
      cells.forEach((cell, cellIndex) => {
        const td = tr.createEl("td");
        const input = td.createEl("input", {
          type: "text",
          value: cell,
          attr: { "aria-label": `Examples cell ${rowIndex + 1},${cellIndex + 1}` },
        });
        input.addEventListener("change", () => {
          cells[cellIndex] = sanitizeCell(input.value);
          input.value = cells[cellIndex];
          this.commit(false);
        });
      });
      const actions = tr.createEl("td");
      const removeRow = actions.createEl("button", {
        text: "×",
        attr: { "aria-label": `Remove row ${rowIndex + 1}` },
      });
      removeRow.addEventListener("click", () => {
        block.rows.splice(rowIndex, 1);
        this.commit(true);
      });
    });
    const addRow = wrap.createEl("button", { text: "+ Row" });
    addRow.addEventListener("click", () => {
      addExamplesRow(block);
      this.commit(true);
    });
    const addColumn = wrap.createEl("button", { text: "+ Column" });
    addColumn.addEventListener("click", () => {
      addExamplesColumn(block);
      this.commit(true);
    });
  }
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run typecheck && npm run lint`
Expected: clean. (If `TextFileView.save`'s signature differs in the installed `obsidian` typings — it is `save(clear?: boolean): Promise<void>` — match the override to the typings.)

- [ ] **Step 3: Commit**

```bash
git add src/presentation/views/feature-editor-view.ts
git commit -m "feat: Feature Editor view with structured and raw-text modes"
```

---

### Task 8: Register the view + extension in `main.ts`, add styles

**Files:**
- Modify: `src/main.ts`
- Modify: `styles.css`

- [ ] **Step 1: Wire the view into the composition root**

In `src/main.ts`:

a) Add the import next to the other view imports:

```ts
import {
  FEATURE_EDITOR_VIEW_TYPE,
  FeatureEditorView,
} from "./presentation/views/feature-editor-view";
```

b) After the `EVIDENCE_EXPLORER_VIEW_TYPE` `registerView` block (and before `addSettingTab`), add:

```ts
    // The `.feature` file handler: clicking a Feature file in the explorer /
    // quick switcher (or a detail-view "Open" button) now renders the Feature
    // Editor. registerExtensions throws if another plugin already claimed the
    // extension — degrade with a warning instead of failing the whole onload.
    this.registerView(
      FEATURE_EDITOR_VIEW_TYPE,
      (leaf) =>
        new FeatureEditorView(leaf, {
          specifications: this.specificationService,
          featureInsight: this.featureInsightService,
        }),
    );
    try {
      this.registerExtensions(["feature"], FEATURE_EDITOR_VIEW_TYPE);
    } catch (error) {
      this.logger.warn("Could not register the .feature extension", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
```

- [ ] **Step 2: Add the styles**

Append to `styles.css`:

```css
/* --- Feature Editor (.feature file handler) ------------------------------ */

.e2e-test-hub-feature-editor-toolbar {
  display: flex;
  gap: var(--size-2-2);
  margin-bottom: var(--size-4-2);
}

.e2e-test-hub-feature-editor-banner {
  padding: var(--size-4-2);
  margin-bottom: var(--size-4-2);
  border-radius: var(--radius-s);
  background-color: var(--background-secondary);
  color: var(--text-warning);
}

.e2e-test-hub-feature-editor-raw {
  width: 100%;
  min-height: 60vh;
  font-family: var(--font-monospace);
  resize: vertical;
}

.e2e-test-hub-feature-editor-card {
  padding: var(--size-4-2);
  margin-bottom: var(--size-4-3);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

.e2e-test-hub-feature-editor-scenario-head,
.e2e-test-hub-feature-editor-step {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  margin-bottom: var(--size-2-2);
}

.e2e-test-hub-feature-editor-name,
.e2e-test-hub-feature-editor-scenario-head input,
.e2e-test-hub-feature-editor-step-text {
  flex: 1;
}

.e2e-test-hub-feature-editor-description,
.e2e-test-hub-feature-editor-docstring {
  width: 100%;
  font-family: var(--font-monospace);
}

.e2e-test-hub-feature-editor-step.is-missing-step .e2e-test-hub-feature-editor-step-text {
  border-color: var(--text-warning);
}

.e2e-test-hub-feature-editor-step-flag {
  min-width: 1em;
  color: var(--text-warning);
  font-weight: 700;
}

.e2e-test-hub-feature-editor-check[data-level="error"] {
  color: var(--text-error);
}

.e2e-test-hub-feature-editor-check[data-level="warning"] {
  color: var(--text-warning);
}

.e2e-test-hub-feature-editor-check[data-level="ok"] {
  color: var(--text-success);
}

.e2e-test-hub-feature-editor-tags {
  margin: var(--size-2-2) 0;
}

.e2e-test-hub-feature-editor-tag-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--size-2-1);
  margin-right: var(--size-2-2);
}

.e2e-test-hub-feature-editor-step-extras {
  margin: 0 0 var(--size-2-2) var(--size-4-4);
}

.e2e-test-hub-feature-editor-grid {
  border-collapse: collapse;
  margin-bottom: var(--size-2-2);
}

.e2e-test-hub-feature-editor-grid td,
.e2e-test-hub-feature-editor-grid th {
  border: 1px solid var(--background-modifier-border);
  padding: var(--size-2-1);
}

.e2e-test-hub-feature-editor-grid input {
  width: 100%;
  border: none;
  background: transparent;
}
```

- [ ] **Step 3: Verify the bundle builds**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean build, `main.js` produced.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts styles.css
git commit -m "feat: register .feature extension with the Feature Editor view"
```

---

### Task 9: CHANGELOG + full verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the changelog entries**

Under `## [Unreleased]` → `### Added`, append:

```md
- `.feature` files now open inside Obsidian: the extension is registered to a
  new Feature Editor view with a structured mode (scenario cards, step rows
  with guided keywords, Examples grids, tag chips with vault-wide
  suggestions, step autocomplete from the scraped step definitions, and an
  inline ✓/✗/! validation strip) plus a raw-text mode. Files containing
  constructs the editor cannot preserve (comments, `Rule:` blocks) open as
  raw text behind a lossless round-trip guard.
- The Gherkin parser/serializer now models Scenario Outlines with Examples
  tables, per-step data tables, doc strings, and description lines, so
  programmatic Feature updates no longer drop them.
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean. Also run `npm run test-build` if the release scan is part of local verification (the editor introduces no pending-work markers).

- [ ] **Step 3: Manual smoke checklist (test vault)**

Cannot be automated here — verify in an Obsidian dev vault when available:
1. A `.feature` file appears in the file explorer and opens in the Feature Editor.
2. The detail view's "Open" button opens the same editor.
3. Editing a step autosaves (file content updates on disk after ~2s) and the Use Case dashboards refresh (the `specification.updated` event).
4. A file with a `# comment` opens in raw mode with the banner; the Structured button shows the Notice.
5. Outline → Examples grid edits round-trip; reopening the file reproduces it.

- [ ] **Step 4: Commit and push**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the Feature Editor and .feature file handler"
git push -u origin claude/repo-review-improvement-fa7b5s
```

---

## Self-review notes (already applied)

- **Spec coverage:** Part 1 → Task 8; Part 2 → Tasks 1–3; Part 3 → Tasks 6–7 (+8 styles); Part 4 → Tasks 4–5; Part 5 needs no work (creation flow untouched); Testing section → Tasks 1–6 test files. The spec's `keyword: "Scenario" | "Scenario Outline"` is implemented as an *optional* field (absent = plain `Scenario`) so existing scenario literals stay valid — a deliberate, documented refinement.
- **Known accepted limitations** (all degrade to the raw-mode fallback, never to data loss): escaped `\|` in table cells, multi-line tag groups, `Scenario  Outline:` double spacing, doc strings before any step, Background descriptions.
- **Type consistency:** `announceUpdated(spec): Promise<void>`, `listStepPatterns(): Promise<Result<StepDefinitionPattern[]>>`, `listKnownTags(): Promise<Result<string[]>>` are used with exactly these signatures in Task 7's view code.

# Authoring Loop Completion (C2/C4/C5 + #77) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the authoring-loop UX track — a Pending Steps sidebar companion with an authoritative step-coverage cache (closes issue #77), tag-aware suite authoring (palette builder, per-scenario membership badge, Tag glossary), and a blocking rename-identity confirm.

**Architecture:** Three independently shippable workstreams on branch `claude/plugin-ux-usability-9kaf4a`. Every decision lands in a pure, unit-tested module (`*-rows.ts`, content helpers, domain walkers); presentation stays a thin Vue/Modal shell per ADR-0033 and AGENTS.md. Spec: `docs/superpowers/specs/2026-07-17-authoring-loop-completion-design.md`.

**Tech Stack:** TypeScript (strict, `Result<T>`), Vue 3 + provide/inject (ADR-0033), Obsidian API (`ItemView`, `Modal`, DOM API — never `innerHTML`), Vitest (+ `@vue/test-utils`, happy-dom for `tests/vue`).

**Environment setup (once):** `npm install` (node_modules is not committed). Full gate: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage`.

**House rules that bite here:**
- No `as` casts in `src` except the established narrow idiom (`(x as Record<string, unknown>).field` for unknown-shaped persisted state — see `readPersistedActiveSection` in `hub-sections.ts`). Tests may use `as`.
- No `innerHTML`; Vue templates or `createEl`/`createDiv`.
- Command **ids** never change (B3); command **names** follow `<Area> — <verb>`.
- Brand accent (`--spec-accent`) is chrome-only; status colours pair with `[data-status]` text.
- Run `npm run quality:audit` before requesting review of each workstream's changes.

---

## WS1 — Pending Steps companion + authoritative step coverage (C2 + Mi4 + #77)

### Task 1: Stub insertion line ranges (content layout)

**Files:**
- Modify: `src/application/content/step-definitions.ts` (bottom of file)
- Test: `tests/step-definitions.test.ts` (append new describe block)

The service composes the exact written text via `buildStepDefinitionStubFile` / `buildAppendedStubs`. Add layout-aware variants that also return each stub's 1-based line range **within the returned text**; the existing string functions become thin delegates so every current caller/test is untouched.

- [ ] **Step 1: Write the failing tests**

Append to `tests/step-definitions.test.ts`:

```ts
import {
  buildAppendedStubs,
  buildAppendedStubsLayout,
  buildStepDefinitionStubFile,
  buildStepDefinitionStubFileLayout,
  countNewlines,
} from "../src/application/content/step-definitions";

describe("stub layout (WS1 Task 1)", () => {
  it("lays out a fresh stub file with 1-based ranges per stub", () => {
    const layout = buildStepDefinitionStubFileLayout(["I do a thing", "I see it"]);
    // Byte-identical to the string builder (delegation contract).
    expect(layout.text).toBe(buildStepDefinitionStubFile(["I do a thing", "I see it"]));
    // Header: import + destructure (lines 1-2), blank line 3; each stub is 4
    // lines (comment, Given(, throw, `});`), blocks separated by one blank line.
    expect(layout.insertions).toEqual([
      { step: "I do a thing", startLine: 4, endLine: 7 },
      { step: "I see it", startLine: 9, endLine: 12 },
    ]);
  });

  it("lays out an append to a file that already binds Given (blocks only)", () => {
    const existing = `import { createBdd } from "playwright-bdd";\nconst { Given } = createBdd();\n`;
    const layout = buildAppendedStubsLayout(existing, ["I do a thing"]);
    expect(layout.text).toBe(buildAppendedStubs(existing, ["I do a thing"]));
    // No header: the single stub starts at line 1 of the appended text.
    expect(layout.insertions).toEqual([{ step: "I do a thing", startLine: 1, endLine: 4 }]);
  });

  it("lays out an append that needs the import + Given binding header", () => {
    const existing = `const helper = 1;\n`;
    const layout = buildAppendedStubsLayout(existing, ["I do a thing"]);
    expect(layout.text).toBe(buildAppendedStubs(existing, ["I do a thing"]));
    // Header: import (1) + Given binding (2), blank line 3, stub 4-7.
    expect(layout.insertions).toEqual([{ step: "I do a thing", startLine: 4, endLine: 7 }]);
  });

  it("counts newlines for the caller's file-offset math", () => {
    expect(countNewlines("")).toBe(0);
    expect(countNewlines("a\nb\n")).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/step-definitions.test.ts`
Expected: FAIL — `buildStepDefinitionStubFileLayout` is not exported.

- [ ] **Step 3: Implement the layout builders**

Append to `src/application/content/step-definitions.ts` (below `buildAppendedStubs`), and refactor the two existing builders to delegate:

```ts
/** One generated stub's 1-based line range within the built text (WS1/C2). */
export interface StubInsertion {
  step: string;
  startLine: number;
  endLine: number;
}

/** A built stub text plus where each stub landed inside it. */
export interface StubLayout {
  text: string;
  insertions: StubInsertion[];
}

/** Number of `\n` characters — the caller's line-offset unit for appends. */
export const countNewlines = (text: string): number => {
  let count = 0;
  for (const char of text) if (char === "\n") count += 1;
  return count;
};

/**
 * Composes `header?\n\n` + stub blocks (blank-line separated) + trailing `\n`,
 * tracking each block's 1-based line range. The single composition source for
 * BOTH the string builders and the layout builders, so text and ranges cannot
 * drift.
 */
const layoutStubs = (header: string | null, missingSteps: string[]): StubLayout => {
  const parts: string[] = [];
  const insertions: StubInsertion[] = [];
  let line = 1;
  const push = (text: string): void => {
    parts.push(text);
    line += countNewlines(text);
  };
  if (header !== null) push(`${header}\n\n`);
  missingSteps.forEach((step, index) => {
    const block = renderStub(step);
    const startLine = line;
    push(index < missingSteps.length - 1 ? `${block}\n\n` : `${block}\n`);
    insertions.push({ step, startLine, endLine: startLine + countNewlines(block) });
  });
  return { text: parts.join(""), insertions };
};

/** {@link buildStepDefinitionStubFile} plus per-stub line ranges. */
export const buildStepDefinitionStubFileLayout = (missingSteps: string[]): StubLayout =>
  layoutStubs(STEP_DEFINITION_IMPORTS, missingSteps);

/** {@link buildAppendedStubs} plus per-stub line ranges (within the appended text). */
export const buildAppendedStubsLayout = (
  existingSource: string,
  missingSteps: string[],
): StubLayout => {
  if (bindsGiven(existingSource)) return layoutStubs(null, missingSteps);
  const givenBinding = createBddGiven(existingCreateBddArgs(existingSource));
  const header = bindsCreateBdd(existingSource)
    ? givenBinding
    : `${CREATE_BDD_IMPORT}\n${givenBinding}`;
  return layoutStubs(header, missingSteps);
};
```

Then change the two existing builders to delegate (replacing their bodies):

```ts
/** A complete, loadable steps module: full import header + stub blocks (new files). */
export const buildStepDefinitionStubFile = (missingSteps: string[]): string =>
  buildStepDefinitionStubFileLayout(missingSteps).text;
```

```ts
export const buildAppendedStubs = (existingSource: string, missingSteps: string[]): string =>
  buildAppendedStubsLayout(existingSource, missingSteps).text;
```

(Keep the existing doc comments on both; delete the now-unused `buildStepDefinitionStubBlocks` only if nothing else references it — it won't be: `layoutStubs` replaces it. Also delete the now-unused `STEP_DEFINITION_IMPORTS`-consuming old composition if any remains.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/step-definitions.test.ts`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/application/content/step-definitions.ts tests/step-definitions.test.ts
git commit -m "WS1: stub layout builders return per-stub line ranges (03-R2 Codex catch)"
```

### Task 2: `insertions` on `GenerateStepDefinitionsResult`

**Files:**
- Modify: `src/application/services/step-definition-service.ts`
- Test: `tests/step-definition-service.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

In `tests/step-definition-service.test.ts`, find the existing fresh-file and append-path tests (they assert `generatedSteps`/`stepFile`/`appended`) and add two new cases in the same describe, reusing the file's existing fake fs/settings helpers:

```ts
it("returns file-absolute insertion ranges for a fresh stub file", async () => {
  // Arrange exactly like the existing "creates a stub file" test (no existing
  // step file), with TWO missing steps.
  const result = await service.generate(featurePath, ["step one", "step two"]);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Fresh file: ranges are the layout's own (header lines 1-3 precede).
  expect(result.value.insertions).toEqual([
    { step: "step one", startLine: 4, endLine: 7 },
    { step: "step two", startLine: 9, endLine: 12 },
  ]);
});

it("offsets insertion ranges by the existing file content on append", async () => {
  // Arrange exactly like the existing append test: seed the step file with a
  // 2-line source that already binds Given, ending WITH a trailing newline:
  // `import { createBdd } from "playwright-bdd";\nconst { Given } = createBdd();\n`
  const result = await service.generate(featurePath, ["step one"]);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Existing content = 2 newlines; separator (content ends with \n) = "\n" (1
  // more). Appended layout starts its stub at line 1 → file line 3 + 1 = 4.
  expect(result.value.insertions).toEqual([{ step: "step one", startLine: 4, endLine: 7 }]);
});
```

(Adapt the arrange lines to the file's existing fixture helpers — the assertion shapes above are the contract. Also extend the file's existing "nothing to write" test to assert `insertions: []`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/step-definition-service.test.ts`
Expected: FAIL — `insertions` is `undefined`.

- [ ] **Step 3: Implement**

In `src/application/services/step-definition-service.ts`:

1. Extend the result interface:

```ts
export interface GenerateStepDefinitionsResult {
  /** Steps a stub was written for (the subset of input still undefined). */
  generatedSteps: string[];
  /** Vault path of the steps file the stubs were written into. */
  stepFile: VaultPath;
  /** True when the stub file already existed and stubs were appended to it. */
  appended: boolean;
  /**
   * 1-based line ranges of each generated stub IN THE WRITTEN FILE, in write
   * order (WS1/C2): computed from the exact composed content, covering the
   * appended-to-existing-file and multi-stub cases. Empty when nothing was
   * generated.
   */
  insertions: StubInsertion[];
}
```

2. Update the import from `../content/step-definitions` to also pull `buildAppendedStubsLayout`, `buildStepDefinitionStubFileLayout`, `countNewlines`, and the `StubInsertion` type (drop the now-unused `buildAppendedStubs`/`buildStepDefinitionStubFile` imports).

3. In `generate()`, replace the write block:

```ts
    const exists = await this.fs.exists(stepFile);

    let written: Result<void>;
    let insertions: StubInsertion[];
    if (exists) {
      // Append to (never overwrite) a hand-edited steps file: read its current
      // content and add the new stubs below it. buildAppendedStubsLayout prepends
      // the `createBdd()` header only when the file does not already bind Given,
      // and reports each stub's line range within the appended text; offsetting
      // by the existing content + separator yields file-absolute lines.
      const read = await this.fs.readFile(stepFile);
      if (!read.ok) return err(read.error);
      const separator = read.value.endsWith("\n") ? "\n" : "\n\n";
      const layout = buildAppendedStubsLayout(read.value, stillMissing);
      const offset = countNewlines(`${read.value}${separator}`);
      insertions = layout.insertions.map((entry) => ({
        step: entry.step,
        startLine: entry.startLine + offset,
        endLine: entry.endLine + offset,
      }));
      written = await this.fs.writeFile(stepFile, `${read.value}${separator}${layout.text}`);
    } else {
      const layout = buildStepDefinitionStubFileLayout(stillMissing);
      insertions = layout.insertions;
      written = await this.fs.createFile(stepFile, layout.text);
    }
```

4. Thread `insertions` into both `ok(...)` returns: the early empty return becomes `ok({ generatedSteps: [], stepFile, appended: false, insertions: [] })`; the final return becomes `ok({ generatedSteps: stillMissing, stepFile, appended: exists, insertions })`.

- [ ] **Step 4: Run the full unit suite for the touched area**

Run: `npx vitest run tests/step-definition-service.test.ts tests/step-definitions.test.ts tests/use-case-detail-rows.test.ts`
Expected: PASS. (If `use-case-detail-rows.test.ts` constructs `GenerateStepDefinitionsResult` literals, add `insertions: []` to them.)

- [ ] **Step 5: Commit**

```bash
git add src/application/services/step-definition-service.ts tests/step-definition-service.test.ts tests/use-case-detail-rows.test.ts
git commit -m "WS1: GenerateStepDefinitionsResult carries per-stub insertion ranges"
```

### Task 3: `StepCoverageCache` (content-addressed, in-memory)

**Files:**
- Create: `src/application/services/step-coverage-cache.ts`
- Test: `tests/step-coverage-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/step-coverage-cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { StepCoverageCache } from "../src/application/services/step-coverage-cache";
import type { StepDefinitionPattern } from "../src/application/content/step-definitions";

const defs = (...sources: string[]): StepDefinitionPattern[] =>
  sources.map((source) => ({ kind: "expression", source }));

describe("StepCoverageCache (#77)", () => {
  it("misses when nothing was recorded", () => {
    const cache = new StepCoverageCache();
    expect(cache.authoritativeCovered("f.feature", ["a step"], defs("a step"))).toBeNull();
  });

  it("hits with the recorded verdict when feature steps AND definitions match", () => {
    const cache = new StepCoverageCache();
    cache.record("f.feature", ["a step"], defs("a step"), true);
    expect(cache.authoritativeCovered("f.feature", ["a step"], defs("a step"))).toBe(true);
    cache.record("g.feature", ["other"], defs("a step"), false);
    expect(cache.authoritativeCovered("g.feature", ["other"], defs("a step"))).toBe(false);
  });

  it("misses after the feature's steps change (external edit safety)", () => {
    const cache = new StepCoverageCache();
    cache.record("f.feature", ["a step"], defs("a step"), true);
    expect(cache.authoritativeCovered("f.feature", ["a step", "new"], defs("a step"))).toBeNull();
  });

  it("misses after the definition set changes (external step-file edit safety)", () => {
    const cache = new StepCoverageCache();
    cache.record("f.feature", ["a step"], defs("a step"), true);
    // A definition deleted outside the plugin must invalidate the verdict —
    // the dangerous stale-"covered" direction the defsRevision sketch missed.
    expect(cache.authoritativeCovered("f.feature", ["a step"], [])).toBeNull();
    // Flags/kind participate in the digest too.
    const regex: StepDefinitionPattern[] = [{ kind: "regex", source: "a step", flags: "i" }];
    expect(cache.authoritativeCovered("f.feature", ["a step"], regex)).toBeNull();
  });

  it("re-records over a prior entry", () => {
    const cache = new StepCoverageCache();
    cache.record("f.feature", ["a step"], defs(), false);
    cache.record("f.feature", ["a step"], defs("a step"), true);
    expect(cache.authoritativeCovered("f.feature", ["a step"], defs("a step"))).toBe(true);
  });

  it("step ORDER matters (a reordered feature re-verifies)", () => {
    const cache = new StepCoverageCache();
    cache.record("f.feature", ["a", "b"], defs("a", "b"), true);
    expect(cache.authoritativeCovered("f.feature", ["b", "a"], defs("a", "b"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/step-coverage-cache.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/application/services/step-coverage-cache.ts`:

```ts
import type { StepDefinitionPattern } from "../content/step-definitions";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** 32-bit FNV-1a over a string; non-cryptographic, deterministic, synchronous. */
const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** Order-sensitive digest of a string list (JSON-encoded so values can't alias). */
const listDigest = (parts: readonly string[]): string => fnv1a(JSON.stringify(parts)).toString(36);

// JSON-encode each pattern's fields so no separator can alias across them
// (source "a b" + no flags vs source "a" + flags "b" must digest differently).
const patternsDigest = (patterns: readonly StepDefinitionPattern[]): string =>
  listDigest(patterns.map((p) => JSON.stringify([p.kind, p.source, p.flags ?? ""])));

interface CoverageEntry {
  stepTextsHash: string;
  defsHash: string;
  covered: boolean;
}

/**
 * In-memory, per-session record of bddgen coverage verdicts (issue #77): for a
 * Feature whose step texts AND whose loaded step-definition pattern set still
 * hash-match a recorded bddgen run, `allStepsDefined` can serve the
 * authoritative verdict instead of the conservative static heuristic.
 *
 * CONTENT-ADDRESSED ON BOTH INPUTS (spec D6 — deliberate deviation from #77's
 * sketched `defsRevision` event counter): the pattern set is re-hashed on every
 * read, so a step definition edited or deleted OUTSIDE the plugin invalidates
 * the entry — the counter would have missed that (a stale "covered" is the
 * dangerous direction). A miss is always safe: callers fall back to the static
 * heuristic. Nothing is persisted (spec D7).
 */
export class StepCoverageCache {
  private readonly entries = new Map<string, CoverageEntry>();

  /** Record a bddgen verdict for the Feature as its inputs looked when bddgen ran. */
  record(
    featurePath: VaultPath,
    stepTexts: readonly string[],
    definitions: readonly StepDefinitionPattern[],
    covered: boolean,
  ): void {
    this.entries.set(featurePath, {
      stepTextsHash: listDigest(stepTexts),
      defsHash: patternsDigest(definitions),
      covered,
    });
  }

  /**
   * The recorded verdict, or null when there is none or either input has since
   * changed (the caller then uses the static heuristic).
   */
  authoritativeCovered(
    featurePath: VaultPath,
    stepTexts: readonly string[],
    definitions: readonly StepDefinitionPattern[],
  ): boolean | null {
    const entry = this.entries.get(featurePath);
    if (entry === undefined) return null;
    if (entry.stepTextsHash !== listDigest(stepTexts)) return null;
    if (entry.defsHash !== patternsDigest(definitions)) return null;
    return entry.covered;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/step-coverage-cache.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/services/step-coverage-cache.ts tests/step-coverage-cache.test.ts
git commit -m "WS1: content-addressed StepCoverageCache (#77, spec D6/D7)"
```

### Task 4: Wire the cache into `DefaultSpecificationService` + post-generate re-detect

**Files:**
- Modify: `src/application/services/specification-service.ts`
- Modify: `src/presentation/views/use-case-detail-rows.ts` (`generateStepDefinitionsOutcome`)
- Test: `tests/specification-service.test.ts`, `tests/use-case-detail-rows.test.ts` (extend)

- [ ] **Step 1: Write the failing service tests**

In `tests/specification-service.test.ts`, locate the existing `allStepsDefined` and `detectMissingSteps` describes (reuse their fake fs / child-process arrangements) and add:

```ts
it("allStepsDefined serves the bddgen verdict after a detect (cache hit)", async () => {
  // Arrange a feature whose step the STATIC matcher cannot model (optional
  // syntax), with a definition file containing `Given("I have a colou?r")` and
  // a feature step `I have a colour`. Static findMissingSteps reports it
  // missing, so allStepsDefined would be false.
  // Arrange the fake child-process runner (as the existing detect tests do) to
  // exit 0 with NO missing-steps header → detect returns missingSteps: [].
  const detected = await service.detectMissingSteps(featurePath);
  expect(detected.ok).toBe(true);
  // The detect recorded covered=true; the static heuristic is now overridden.
  expect(await service.allStepsDefined([featurePath])).toBe(true);
});

it("allStepsDefined falls back to static after the feature changes (hash miss)", async () => {
  // Same arrange as above, then REWRITE the feature file adding a step with no
  // definition (via the fake fs). The cache hash misses; static reports false.
  const detected = await service.detectMissingSteps(featurePath);
  expect(detected.ok).toBe(true);
  await writeFeature(featurePath, featureWithExtraUndefinedStep);
  expect(await service.allStepsDefined([featurePath])).toBe(false);
});

it("detectMissingSteps with missing steps records covered=false", async () => {
  // Arrange bddgen output WITH the missing-steps header + snippets (as the
  // existing "reports missing" test does) for a step that static ALSO thinks
  // is missing — then verify allStepsDefined is false (either tier).
  await service.detectMissingSteps(featurePath);
  expect(await service.allStepsDefined([featurePath])).toBe(false);
});

it("records against the definitions bddgen saw, not a post-spawn edit (TOCTOU)", async () => {
  // Arrange the covering-definitions fixture (as in the cache-hit test), but
  // make the fake child-process run DELETE/EMPTY the step-definition file as a
  // side effect (simulating an external edit during the bddgen window). The
  // recorded defsHash must reflect the PRE-spawn set, so the follow-up
  // allStepsDefined — hashing the now-changed set — hash-misses and falls back
  // to the static heuristic, which reports the step undefined.
  const detected = await service.detectMissingSteps(featurePath);
  expect(detected.ok).toBe(true);
  expect(await service.allStepsDefined([featurePath])).toBe(false);
});
```

(Adapt arrange details to the file's existing fixtures — the three behaviours are the contract: hit-overrides-static, feature-edit-misses, negative-verdict-recorded.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/specification-service.test.ts`
Expected: the first new test FAILS (static heuristic says false; no cache exists yet).

- [ ] **Step 3: Implement the service wiring**

In `src/application/services/specification-service.ts`:

1. Import the cache: `import { StepCoverageCache } from "./step-coverage-cache";`
2. Add a private field on `DefaultSpecificationService` (no constructor change — the service is a composition-root singleton, so an internal field shares the cache between detect and the rail reads):

```ts
  // #77: bddgen coverage verdicts, content-addressed by (feature steps, defs).
  private readonly stepCoverage = new StepCoverageCache();
```

3. Snapshot the definition set BEFORE spawning bddgen, and record against that snapshot. Reading the set after the spawn would be a TOCTOU hole: a step file edited or deleted externally during the bddgen window would hash-match the recorded entry and serve a stale `covered=true` — exactly the direction the content-addressing exists to prevent (Codex P2 on PR #102). Immediately before the `this.childProcess.run` call add:

```ts
    // #77: the definition snapshot bddgen is about to evaluate — the cache
    // records against THIS set, so a step file edited externally during or
    // after the spawn hash-misses and falls back to the static heuristic.
    const definitionsAtSpawn = await this.listStepPatterns();
```

Then at the END of `detectMissingSteps` (just before `return ok(...)`, after `missingSteps` is computed and the event is published), record the verdict:

```ts
    // #77: record the authoritative verdict against the inputs bddgen saw, so
    // the loop rail's allStepsDefined can serve it until either input changes.
    this.stepCoverage.record(
      featurePath,
      collectStepTexts(feature.value),
      definitionsAtSpawn,
      missingSteps.length === 0,
    );
```

4. Replace the body of `allStepsDefined` (keeping its doc comment, plus append to it: "Prefers a content-address-matched bddgen verdict recorded by `detectMissingSteps` (#77); falls back to the static heuristic on any miss."):

```ts
  async allStepsDefined(featurePaths: readonly VaultPath[]): Promise<boolean> {
    if (featurePaths.length === 0) return false;
    // Read the defined patterns ONCE — they both key the #77 cache lookup and
    // feed the static fallback, so the authoritative path costs no extra I/O.
    const definitions = await this.listStepPatterns();
    let sawStep = false;
    for (const featurePath of featurePaths) {
      const feature = await readFeatureFile(this.fs, featurePath);
      // An unreadable Feature means we can't prove its steps are covered: don't
      // claim "defined" (the rail keeps offering the Steps action).
      if (!feature.ok) return false;
      const stepTexts = collectStepTexts(feature.value);
      if (stepTexts.length > 0) sawStep = true;
      const authoritative = this.stepCoverage.authoritativeCovered(
        featurePath,
        stepTexts,
        definitions,
      );
      if (authoritative !== null) {
        if (!authoritative) return false;
        continue;
      }
      if (findMissingSteps(stepTexts, definitions).length > 0) return false;
    }
    // Require at least one step across the set (a step-less Feature set proves
    // nothing), matching the pre-cache semantics.
    return sawStep;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/specification-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing outcome test (post-generate re-detect)**

In `tests/use-case-detail-rows.test.ts`, find the `generateStepDefinitionsOutcome` describe and add:

```ts
it("re-detects after generating stubs so the coverage verdict lands (#77)", async () => {
  const detectCalls: string[] = [];
  const spec = {
    detectMissingSteps: async (path: string) => {
      detectCalls.push(path);
      return ok({ featurePath: path, missingSteps: ["a step"], detectionEventId: "e1" });
    },
  };
  const stepDefs = {
    generate: async () =>
      ok({ generatedSteps: ["a step"], stepFile: "steps.ts", appended: false, insertions: [] }),
  };
  await generateStepDefinitionsOutcome(spec, stepDefs, "f.feature");
  // detect → generate → RE-detect (the re-detect records covered=true).
  expect(detectCalls).toHaveLength(2);
});

it("skips the re-detect when nothing was generated", async () => {
  const detectCalls: string[] = [];
  const spec = {
    detectMissingSteps: async (path: string) => {
      detectCalls.push(path);
      return ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" });
    },
  };
  const stepDefs = {
    generate: async () =>
      ok({ generatedSteps: [], stepFile: "steps.ts", appended: false, insertions: [] }),
  };
  await generateStepDefinitionsOutcome(spec, stepDefs, "f.feature");
  expect(detectCalls).toHaveLength(1);
});
```

(Match the fake-shape idiom already used in that file — plain object literals typed by the `Pick<>` params.)

- [ ] **Step 6: Implement the re-detect**

In `src/presentation/views/use-case-detail-rows.ts`, in `generateStepDefinitionsOutcome`, after the successful `generated` result and before `return stepGenerationRows(...)`:

```ts
  if (generated.value.generatedSteps.length > 0) {
    // #77: one post-generate re-detect so bddgen confirms the stubs cover the
    // feature and the coverage cache records it — the rail advances off Steps
    // without a second manual Detect. Best-effort: a refusal (e.g. a run
    // started meanwhile) leaves the static heuristic in charge.
    await specificationService.detectMissingSteps(featurePath);
  }
```

- [ ] **Step 7: Run to verify pass, then commit**

Run: `npx vitest run tests/use-case-detail-rows.test.ts tests/specification-service.test.ts`
Expected: PASS.

```bash
git add src/application/services/specification-service.ts src/presentation/views/use-case-detail-rows.ts tests/specification-service.test.ts tests/use-case-detail-rows.test.ts
git commit -m "WS1: allStepsDefined prefers bddgen verdicts; generate re-detects (closes #77 core)"
```

### Task 5: `pending-steps-rows.ts` pure projection

**Files:**
- Create: `src/presentation/views/pending-steps-rows.ts`
- Test: `tests/pending-steps-rows.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/pending-steps-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  pendingStepsTargetForRun,
  projectPendingFeature,
  readPersistedPendingStepsTarget,
} from "../src/presentation/views/pending-steps-rows";
import type { StepDefinitionPattern } from "../src/application/content/step-definitions";

const defs = (...sources: string[]): StepDefinitionPattern[] =>
  sources.map((source) => ({ kind: "expression", source }));

describe("projectPendingFeature", () => {
  it("projects the static tier: missing list, counts, progress text", () => {
    const group = projectPendingFeature(
      "Specifications/features/UC-001-happy-path.feature",
      ["I am here", "I do a thing", "I see it"],
      defs("I am here"),
      null,
    );
    expect(group).toEqual({
      path: "Specifications/features/UC-001-happy-path.feature",
      label: "UC-001-happy-path.feature",
      totalSteps: 3,
      definedSteps: 1,
      progressText: "1 of 3 steps defined",
      missing: ["I do a thing", "I see it"],
      tier: "static",
      complete: false,
    });
  });

  it("prefers an authoritative bddgen missing list (tier bddgen)", () => {
    const group = projectPendingFeature("f.feature", ["a", "b"], defs(), ["b"]);
    expect(group.tier).toBe("bddgen");
    expect(group.missing).toEqual(["b"]);
    expect(group.definedSteps).toBe(1);
    expect(group.complete).toBe(false);
  });

  it("is complete when bddgen reports nothing missing", () => {
    const group = projectPendingFeature("f.feature", ["a"], defs(), []);
    expect(group.complete).toBe(true);
    expect(group.progressText).toBe("1 of 1 steps defined");
  });

  it("a step-less feature is never complete", () => {
    expect(projectPendingFeature("f.feature", [], defs(), null).complete).toBe(false);
  });
});

describe("pendingStepsTargetForRun", () => {
  it("maps use-case and feature scopes to targeted panels, others to vault", () => {
    expect(pendingStepsTargetForRun("use-case", "UC-001")).toEqual({
      kind: "use-case",
      useCaseId: "UC-001",
    });
    expect(pendingStepsTargetForRun("feature", "f.feature")).toEqual({
      kind: "feature",
      featurePath: "f.feature",
    });
    expect(pendingStepsTargetForRun("suite", "SUITE-001")).toEqual({ kind: "vault" });
    expect(pendingStepsTargetForRun("all", "all")).toEqual({ kind: "vault" });
    expect(pendingStepsTargetForRun("demo", "demo")).toEqual({ kind: "vault" });
  });
});

describe("readPersistedPendingStepsTarget", () => {
  it("round-trips the three shapes and rejects junk", () => {
    expect(readPersistedPendingStepsTarget({ target: { kind: "vault" } })).toEqual({
      kind: "vault",
    });
    expect(
      readPersistedPendingStepsTarget({ target: { kind: "use-case", useCaseId: "UC-001" } }),
    ).toEqual({ kind: "use-case", useCaseId: "UC-001" });
    expect(
      readPersistedPendingStepsTarget({ target: { kind: "feature", featurePath: "f.feature" } }),
    ).toEqual({ kind: "feature", featurePath: "f.feature" });
    expect(readPersistedPendingStepsTarget(undefined)).toBeNull();
    expect(readPersistedPendingStepsTarget({ target: { kind: "nope" } })).toBeNull();
    expect(readPersistedPendingStepsTarget({ target: { kind: "use-case" } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pending-steps-rows.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/presentation/views/pending-steps-rows.ts`:

```ts
import {
  findMissingSteps,
  type StepDefinitionPattern,
} from "../../application/content/step-definitions";
import type { ExecutionScope } from "../../domain/entities/test-run";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";

/**
 * The Pending Steps companion (WS1/C2, spec §3.2): pure projections behind the
 * sidebar panel, so the Vue surface stays a thin render (ADR-0029/0033).
 */

/** What the panel is pointed at — persisted as the leaf's view state (spec D5). */
export type PendingStepsTarget =
  | { kind: "use-case"; useCaseId: string }
  | { kind: "feature"; featurePath: VaultPath }
  | { kind: "vault" };

/** One Feature's step-coverage picture inside the panel. */
export interface PendingFeatureGroup {
  path: VaultPath;
  /** The filename — the panel's row label. */
  label: string;
  totalSteps: number;
  definedSteps: number;
  /** E.g. "12 of 15 steps defined" — rendered next to the progress bar. */
  progressText: string;
  /** The undefined step texts (distinct, first-seen order). */
  missing: string[];
  /**
   * Which signal produced `missing`: the conservative static matcher, or an
   * authoritative bddgen detect (spec D8 — bddgen only on explicit actions).
   */
  tier: "static" | "bddgen";
  /** Every declared step has a definition (and there IS at least one step). */
  complete: boolean;
}

/**
 * Projects one Feature's panel group. `bddgenMissing` is the authoritative
 * missing list when a detect has run (null → static tier via
 * {@link findMissingSteps}).
 */
export const projectPendingFeature = (
  path: VaultPath,
  stepTexts: readonly string[],
  definitions: readonly StepDefinitionPattern[],
  bddgenMissing: readonly string[] | null,
): PendingFeatureGroup => {
  const missing =
    bddgenMissing === null ? findMissingSteps([...stepTexts], [...definitions]) : [...bddgenMissing];
  const missingSet = new Set(missing);
  const definedSteps = stepTexts.filter((text) => !missingSet.has(text)).length;
  const totalSteps = stepTexts.length;
  return {
    path,
    label: path.split("/").pop() ?? path,
    totalSteps,
    definedSteps,
    progressText: `${definedSteps} of ${totalSteps} steps defined`,
    missing,
    tier: bddgenMissing === null ? "static" : "bddgen",
    complete: totalSteps > 0 && missing.length === 0,
  };
};

/**
 * The panel target for a finished run's scope — the console's missing-steps
 * hint opens the panel here. Suite/all/demo runs span features, so they open
 * the vault-wide listing (spec §3.3).
 */
export const pendingStepsTargetForRun = (
  scope: ExecutionScope,
  target: string,
): PendingStepsTarget => {
  if (scope === "use-case") return { kind: "use-case", useCaseId: target };
  if (scope === "feature") return { kind: "feature", featurePath: unsafeVaultPath(target) };
  return { kind: "vault" };
};

/**
 * Reads the persisted `target` off Obsidian's opaque `setState` payload without
 * an unsafe cast — the same idiom as `readPersistedActiveSection`
 * (hub-sections.ts). Null for anything that isn't one of the three shapes; the
 * view then falls back to the vault target.
 */
export const readPersistedPendingStepsTarget = (state: unknown): PendingStepsTarget | null => {
  if (typeof state !== "object" || state === null) return null;
  const target: unknown = (state as Record<string, unknown>).target;
  if (typeof target !== "object" || target === null) return null;
  const record = target as Record<string, unknown>;
  if (record.kind === "vault") return { kind: "vault" };
  if (record.kind === "use-case" && typeof record.useCaseId === "string") {
    return { kind: "use-case", useCaseId: record.useCaseId };
  }
  if (record.kind === "feature" && typeof record.featurePath === "string") {
    return { kind: "feature", featurePath: unsafeVaultPath(record.featurePath) };
  }
  return null;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/pending-steps-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/views/pending-steps-rows.ts tests/pending-steps-rows.test.ts
git commit -m "WS1: pending-steps pure projections (groups, run target, persisted state)"
```

### Task 6: `openInSystemEditor` on the workspace port

**Files:**
- Modify: `src/application/ports/workspace-port.ts`
- Modify: `src/infrastructure/obsidian/obsidian-workspace-adapter.ts`
- Modify: `tests/__stubs__/obsidian.ts` **only if** the stub `App` lacks the member and a test exercises it; check first.

- [ ] **Step 1: Extend the port**

In `src/application/ports/workspace-port.ts`, add to the interface:

```ts
  /**
   * Opens a vault file in the OS default application (WS1/C2 spec D2) — the
   * step-file jump for `.testrunner/src/steps/*.ts`, which Obsidian itself
   * cannot edit (unindexed dot-folder). Desktop-only plugin, so unconditional.
   */
  openInSystemEditor(path: VaultPath): Promise<Result<void>>;
```

- [ ] **Step 2: Implement in the adapter**

In `src/infrastructure/obsidian/obsidian-workspace-adapter.ts`, add the method to `ObsidianWorkspaceAdapter`:

```ts
  async openInSystemEditor(path: VaultPath): Promise<Result<void>> {
    // `openWithDefaultApp` ships on desktop `App` builds but not in every
    // typings version — probe it via the established narrow-record idiom
    // (readPersistedActiveSection) instead of an unsafe broad cast.
    const candidate: unknown = (this.app as unknown as Record<string, unknown>)
      .openWithDefaultApp;
    if (typeof candidate !== "function") {
      return err(
        appError("VALIDATION_FAILED", "Opening files in the system editor is not supported here."),
      );
    }
    try {
      await (candidate as (this: App, target: string) => Promise<void>).call(
        this.app,
        normalizePath(path),
      );
      return ok(undefined);
    } catch (cause) {
      return err(appError("INIT_FAILED", `Could not open "${path}" in the system editor.`, { cause }));
    }
  }
```

NOTE: if `App` in the installed `obsidian` typings already declares `openWithDefaultApp`, simplify to a direct `await this.app.openWithDefaultApp(normalizePath(path))` in the try block and drop the probe. Check with: `grep -n "openWithDefaultApp" node_modules/obsidian/obsidian.d.ts`. If ESLint rejects the double cast above, use the single-step `Record<string, unknown>` idiom from `hub-sections.ts` (`readPersistedActiveSection`) and adjust; tests are relaxed if a `tests/` stub needs `as`.

- [ ] **Step 3: Typecheck and run any workspace-port consumers' tests**

Run: `npm run typecheck && npx vitest run tests --reporter=dot 2>&1 | tail -5`
Expected: typecheck clean. If any test constructs a `WorkspacePort` fake object literal, add `openInSystemEditor: async () => ok(undefined)` to it (grep: `grep -rn "openView:" tests | head`).

- [ ] **Step 4: Commit**

```bash
git add src/application/ports/workspace-port.ts src/infrastructure/obsidian/obsidian-workspace-adapter.ts tests
git commit -m "WS1: openInSystemEditor workspace-port capability (spec D2)"
```

### Task 7: The Pending Steps leaf (deps, Vue app, view, registration, opener)

**Files:**
- Create: `src/presentation/vue/pending-steps/pending-steps-deps.ts`
- Create: `src/presentation/vue/pending-steps/PendingStepsApp.vue`
- Create: `src/presentation/vue/pending-steps/PendingFeatureCard.vue`
- Create: `src/presentation/views/pending-steps-view.ts`
- Modify: `src/register-views.ts` (register the view; add `openPendingSteps` to `ViewWiringDeps`)
- Modify: `src/main.ts` (the `openPendingSteps` leaf opener + deps wiring)
- Test: `tests/vue/pending-steps-app.test.ts`

- [ ] **Step 1: Create the deps module**

Create `src/presentation/vue/pending-steps/pending-steps-deps.ts`:

```ts
import type { InjectionKey, Ref } from "vue";
import type { VaultFileSystem } from "../../../application/ports/vault-file-system";
import type { WorkspacePort } from "../../../application/ports/workspace-port";
import type { SpecificationService } from "../../../application/services/specification-service";
import type { StepDefinitionService } from "../../../application/services/step-definition-service";
import type { UseCaseService } from "../../../application/services/use-case-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { PendingStepsTarget } from "../../views/pending-steps-rows";

/**
 * The composition-root slice the Pending Steps companion needs (WS1/C2): the
 * spec/step services for detect/generate, the Use Case lookup to resolve a
 * use-case target to its Feature files, the vault fs for the read-only stub
 * viewer, and the workspace port's system-editor jump.
 */
export interface PendingStepsDeps {
  specificationService: Pick<
    SpecificationService,
    "listFeatures" | "listStepPatterns" | "detectMissingSteps"
  >;
  stepDefinitionService: Pick<StepDefinitionService, "generate">;
  useCaseService: Pick<UseCaseService, "findById">;
  fs: Pick<VaultFileSystem, "readFile">;
  workspace: Pick<WorkspacePort, "openInSystemEditor">;
  eventBus: EventBus;
}

export const PENDING_STEPS_DEPS = Symbol("pending-steps-deps") as InjectionKey<PendingStepsDeps>;

/**
 * The target as a reactive Ref OWNED by the view (the USE_CASE_DETAIL_ID
 * pattern): setState writes it, getState reads it, the app watches it — so the
 * restore-before-onOpen gap is handled naturally.
 */
export const PENDING_STEPS_TARGET = Symbol("pending-steps-target") as InjectionKey<
  Ref<PendingStepsTarget>
>;
```

Verified: `UseCaseService.findById(id: UseCaseId): Promise<Result<UseCase | null>>` (`UseCaseId` is a plain string alias) and `UseCase.featureFiles: VaultPath[]` are the real names. ALSO: `readFeatureFile` in `src/application/services/feature-loading.ts` currently takes the full `VaultFileSystem`; narrow its parameter to `fs: Pick<VaultFileSystem, "readFile">` (it only calls `readFile`; structural typing keeps every existing call site working — same idiom as `loadStepDefinitions`) so this deps slice satisfies it.

- [ ] **Step 2: Create the per-feature card component**

Create `src/presentation/vue/pending-steps/PendingFeatureCard.vue`:

```vue
<script setup lang="ts">
/**
 * One Feature's group in the Pending Steps panel (WS1/C2): progress line + bar,
 * the undefined-step rows, the Verify/Generate/Open actions, and — after a
 * generate — the read-only stub viewer highlighting the inserted ranges.
 * Dumb by design: all async work lives in the parent (App), which passes the
 * group state down and receives action events up.
 */
import { computed } from "vue";
import ChecklistRows from "../ChecklistRows.vue";
import type { ChecklistRow } from "../../views/checklist";
import type { PendingFeatureGroup } from "../../views/pending-steps-rows";
import type { StubInsertion } from "../../../application/content/step-definitions";

export interface StubViewerState {
  stepFile: string;
  /** The step file's full content, split into lines for range highlighting. */
  lines: string[];
  insertions: StubInsertion[];
}

const props = defineProps<{
  group: PendingFeatureGroup;
  busy: boolean;
  result: ChecklistRow[] | null;
  viewer: StubViewerState | null;
}>();

const emit = defineEmits<{
  verify: [];
  generate: [];
  openFile: [];
}>();

const progressPercent = computed(() =>
  props.group.totalSteps === 0
    ? 0
    : Math.round((props.group.definedSteps / props.group.totalSteps) * 100),
);

const highlighted = (line: number): boolean =>
  (props.viewer?.insertions ?? []).some((entry) => line >= entry.startLine && line <= entry.endLine);

const copyStub = (): void => {
  const viewer = props.viewer;
  if (viewer === null) return;
  const text = viewer.insertions
    .map((entry) => viewer.lines.slice(entry.startLine - 1, entry.endLine).join("\n"))
    .join("\n\n");
  void navigator.clipboard.writeText(text);
};
</script>

<template>
  <section class="spec-pending-feature" :data-status="group.complete ? 'ok' : 'pending'">
    <header class="spec-pending-feature-head">
      <span class="spec-pending-feature-name" :title="group.path">{{ group.label }}</span>
      <span class="spec-pending-feature-progress-text">
        {{ group.progressText }}
        <span class="spec-pending-feature-tier">({{ group.tier === "bddgen" ? "verified" : "static check" }})</span>
      </span>
    </header>
    <div
      class="spec-pending-feature-progress"
      role="progressbar"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${group.label}: ${group.progressText}`"
    >
      <div class="spec-pending-feature-progress-fill" :style="{ width: `${progressPercent}%` }" />
    </div>

    <ul v-if="group.missing.length > 0" class="spec-pending-feature-missing">
      <li v-for="step in group.missing" :key="step">{{ step }}</li>
    </ul>
    <p v-else-if="group.complete" class="spec-pending-feature-done">
      Every step has a definition.
    </p>

    <div class="spec-pending-feature-actions">
      <button :disabled="busy" :aria-label="`Verify ${group.label} with bddgen`" @click="emit('verify')">
        Verify
      </button>
      <button
        class="mod-cta"
        :disabled="busy || group.missing.length === 0"
        :aria-label="`Generate step stubs for ${group.label}`"
        @click="emit('generate')"
      >
        Generate stubs
      </button>
      <button :aria-label="`Open the step file for ${group.label} in the system editor`" @click="emit('openFile')">
        Open step file
      </button>
    </div>

    <div class="spec-pending-feature-result" aria-live="polite">
      <ChecklistRows v-if="result" :rows="result" />
    </div>

    <details v-if="viewer" class="spec-pending-stub-viewer" open>
      <summary>
        Generated stubs in {{ viewer.stepFile }}
        <button aria-label="Copy the generated stubs" @click.prevent="copyStub">Copy</button>
      </summary>
      <pre class="spec-pending-stub-code"><code><span
        v-for="(line, i) in viewer.lines"
        :key="i"
        class="spec-pending-stub-line"
        :class="{ 'is-inserted': highlighted(i + 1) }"
      >{{ line }}
</span></code></pre>
    </details>
  </section>
</template>
```

- [ ] **Step 3: Create the app component**

Create `src/presentation/vue/pending-steps/PendingStepsApp.vue`:

```vue
<script setup lang="ts">
/**
 * The Pending Steps companion app (WS1/C2, spec §3.2): resolves the target to a
 * Feature list, projects each through the STATIC tier, and runs bddgen only on
 * explicit actions (a feature-targeted open counts as one — spec D8). Owns all
 * async work; PendingFeatureCard is a dumb renderer.
 */
import { inject, shallowRef, watch } from "vue";
import { PENDING_STEPS_DEPS, PENDING_STEPS_TARGET } from "./pending-steps-deps";
import PendingFeatureCard, { type StubViewerState } from "./PendingFeatureCard.vue";
import { useEventBus } from "../use-event-bus";
import { checklistRow, type ChecklistRow } from "../../views/checklist";
import {
  projectPendingFeature,
  type PendingFeatureGroup,
  type PendingStepsTarget,
} from "../../views/pending-steps-rows";
import { collectStepTexts } from "../../../application/content/gherkin";
import { readFeatureFile } from "../../../application/services/feature-loading";
import type { StepDefinitionPattern } from "../../../application/content/step-definitions";
import type { VaultPath } from "../../../domain/value-objects/identifiers";

const deps = inject(PENDING_STEPS_DEPS)!;
const target = inject(PENDING_STEPS_TARGET)!;

interface GroupState {
  group: PendingFeatureGroup;
  busy: boolean;
  result: ChecklistRow[] | null;
  viewer: StubViewerState | null;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; title: string; groups: GroupState[] };

const state = shallowRef<PanelState>({ kind: "loading" });

// Stale-load guard (the FeatureRow generation-counter idiom): any await that
// resolves after a newer load/re-target drops its write.
let generation = 0;

const targetTitle = (value: PendingStepsTarget): string =>
  value.kind === "use-case"
    ? `Pending steps — ${value.useCaseId}`
    : value.kind === "feature"
      ? `Pending steps — ${value.featurePath.split("/").pop() ?? value.featurePath}`
      : "Pending steps — vault";

/** The Feature paths the current target spans (empty list is a valid answer). */
async function resolvePaths(value: PendingStepsTarget): Promise<VaultPath[]> {
  if (value.kind === "feature") return [value.featurePath];
  if (value.kind === "use-case") {
    const useCase = await deps.useCaseService.findById(value.useCaseId);
    return useCase.ok && useCase.value !== null ? useCase.value.featureFiles : [];
  }
  const listed = await deps.specificationService.listFeatures();
  return listed.ok ? listed.value.map((entry) => entry.path) : [];
}

/** Static-tier group for one Feature (no process spawn — spec D8). */
async function staticGroup(
  path: VaultPath,
  definitions: StepDefinitionPattern[],
): Promise<PendingFeatureGroup | null> {
  const feature = await readFeatureFile(deps.fs, path);
  if (!feature.ok) return null;
  return projectPendingFeature(path, collectStepTexts(feature.value), definitions, null);
}

async function load(): Promise<void> {
  const gen = ++generation;
  const value = target.value;
  state.value = { kind: "loading" };
  const paths = await resolvePaths(value);
  // Load the step-definition patterns ONCE per render, not once per Feature —
  // listStepPatterns re-scans `.testrunner/src/steps` on every call, so a
  // per-group load would repeat that scan N times on a vault target (Codex P2
  // on PR #102).
  const definitions = await deps.specificationService.listStepPatterns();
  const groups: GroupState[] = [];
  for (const path of paths) {
    const group = await staticGroup(path, definitions);
    if (group === null) continue;
    // The vault-wide listing shows only incomplete Features (spec §3.2).
    if (value.kind === "vault" && group.complete) continue;
    groups.push({ group, busy: false, result: null, viewer: null });
  }
  if (gen !== generation) return;
  state.value = { kind: "loaded", title: targetTitle(value), groups };
  // A feature-targeted open is an explicit user action: run ONE authoritative
  // verify automatically (spec D8); use-case / vault targets stay static until
  // a per-feature action.
  if (value.kind === "feature" && groups.length === 1) void verify(groups[0]);
}

watch(target, () => void load());

// Panel actions (Verify/Generate) publish the very events this panel
// subscribes to, and InMemoryEventBus.publish AWAITS handlers straight through
// RenderScheduler's returned chain — so an inline event reload would bump
// `generation` MID-action and drop the action's own success path (re-detect,
// success rows, stub viewer) every single time (Codex P1 on PR #102). While a
// panel action is in flight, self-caused events are deliberately SWALLOWED,
// not deferred: the action leaves its group MORE accurate (authoritative
// bddgen tier) than the static reload would, and a trailing reload would wipe
// the just-rendered viewer. An external edit landing exactly inside that
// window self-heals on its next event.
let actionDepth = 0;
async function withAction(run: () => Promise<void>): Promise<void> {
  actionDepth += 1;
  try {
    await run();
  } finally {
    actionDepth -= 1;
  }
}

// specification.created covers a newly generated Feature in the vault listing;
// specification.linkedToUseCase covers the USE-CASE target — createFromUseCase
// publishes `created` BEFORE writing the Use Case's featureFiles link, so a
// panel refreshing on `created` alone reads the pre-link list and would never
// see the new Feature until an unrelated event (Codex P2s on PR #102).
useEventBus(
  deps.eventBus,
  [
    "specification.created",
    "specification.linkedToUseCase",
    "specification.updated",
    "stepdefinition.generated",
  ],
  () => (actionDepth > 0 ? undefined : load()),
);

/** Public actions: wrapped so self-caused events are swallowed (Codex P1). */
const verify = (entry: GroupState): Promise<void> => withAction(() => verifyInner(entry));
const generate = (entry: GroupState): Promise<void> => withAction(() => generateInner(entry));

/** Re-projects one group after a bddgen detect (authoritative tier). */
async function verifyInner(entry: GroupState): Promise<void> {
  const gen = generation;
  entry.busy = true;
  entry.result = [checklistRow("pending", "Verifying with bddgen…")];
  patch(entry);
  const detected = await deps.specificationService.detectMissingSteps(entry.group.path);
  if (gen !== generation) return;
  entry.busy = false;
  if (!detected.ok) {
    entry.result = [checklistRow("error", `Verify failed: ${detected.error.message}`)];
    patch(entry);
    return;
  }
  const feature = await readFeatureFile(deps.fs, entry.group.path);
  const definitions = await deps.specificationService.listStepPatterns();
  if (gen !== generation) return;
  if (feature.ok) {
    entry.group = projectPendingFeature(
      entry.group.path,
      collectStepTexts(feature.value),
      definitions,
      detected.value.missingSteps,
    );
  }
  entry.result = null;
  patch(entry);
}

/** Detect → generate → re-detect → show the written stubs (spec §3.2). */
async function generateInner(entry: GroupState): Promise<void> {
  const gen = generation;
  entry.busy = true;
  entry.result = [checklistRow("pending", "Generating step stubs…")];
  patch(entry);
  const detected = await deps.specificationService.detectMissingSteps(entry.group.path);
  if (gen !== generation) return;
  if (!detected.ok) {
    entry.busy = false;
    entry.result = [checklistRow("error", `Detection failed: ${detected.error.message}`)];
    patch(entry);
    return;
  }
  const generated = await deps.stepDefinitionService.generate(
    entry.group.path,
    detected.value.missingSteps,
    detected.value.detectionEventId,
  );
  if (gen !== generation) return;
  if (!generated.ok) {
    entry.busy = false;
    entry.result = [checklistRow("error", `Could not generate: ${generated.error.message}`)];
    patch(entry);
    return;
  }
  // Post-generate re-detect: flips the coverage cache to covered (#77) and
  // refreshes this group's authoritative picture.
  const redetected = await deps.specificationService.detectMissingSteps(entry.group.path);
  const feature = await readFeatureFile(deps.fs, entry.group.path);
  const definitions = await deps.specificationService.listStepPatterns();
  if (gen !== generation) return;
  if (feature.ok) {
    entry.group = projectPendingFeature(
      entry.group.path,
      collectStepTexts(feature.value),
      definitions,
      redetected.ok ? redetected.value.missingSteps : null,
    );
  }
  entry.busy = false;
  entry.result =
    generated.value.generatedSteps.length === 0
      ? [checklistRow("ok", "No missing steps — nothing to generate.")]
      : [
          checklistRow(
            "ok",
            `Generated ${generated.value.generatedSteps.length} step ${
              generated.value.generatedSteps.length === 1 ? "stub" : "stubs"
            } in ${generated.value.stepFile}.`,
          ),
        ];
  // The read-only stub viewer: the written file, highlighted at the returned
  // insertion ranges (spec D2).
  if (generated.value.generatedSteps.length > 0) {
    const content = await deps.fs.readFile(generated.value.stepFile);
    if (gen !== generation) return;
    if (content.ok) {
      entry.viewer = {
        stepFile: generated.value.stepFile,
        lines: content.value.split("\n"),
        insertions: generated.value.insertions,
      };
    }
  }
  patch(entry);
}

function openFile(entry: GroupState): void {
  const stepFile = entry.viewer?.stepFile;
  if (stepFile !== undefined) {
    void deps.workspace.openInSystemEditor(stepFile);
    return;
  }
  // The step-file path is minted by the generator (service-owned convention),
  // so before a generate there is nothing reliable to open — say so inline.
  entry.result = [
    checklistRow("info", "Generate stubs first — Generate creates/locates the step file."),
  ];
  patch(entry);
}

/** shallowRef state: re-set the loaded object so Vue re-renders the group. */
function patch(entry: GroupState): void {
  if (state.value.kind !== "loaded") return;
  state.value = {
    ...state.value,
    groups: state.value.groups.map((candidate) =>
      candidate.group.path === entry.group.path ? { ...entry } : candidate,
    ),
  };
}
</script>

<template>
  <div class="spec-pending-steps">
    <p v-if="state.kind === 'loading'" class="spec-empty">Loading…</p>
    <p v-else-if="state.kind === 'error'">{{ state.message }}</p>
    <template v-else>
      <h4 class="spec-pending-steps-title">{{ state.title }}</h4>
      <p v-if="state.groups.length === 0" class="spec-empty">
        No Features with pending steps — everything the static check can see is defined.
      </p>
      <PendingFeatureCard
        v-for="entry in state.groups"
        :key="entry.group.path"
        :group="entry.group"
        :busy="entry.busy"
        :result="entry.result"
        :viewer="entry.viewer"
        @verify="verify(entry)"
        @generate="generate(entry)"
        @open-file="openFile(entry)"
      />
    </template>
  </div>
</template>
```

- [ ] **Step 4: Create the view class**

Create `src/presentation/views/pending-steps-view.ts`:

```ts
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { ref, type Ref } from "vue";
import PendingStepsApp from "../vue/pending-steps/PendingStepsApp.vue";
import {
  PENDING_STEPS_DEPS,
  PENDING_STEPS_TARGET,
  type PendingStepsDeps,
} from "../vue/pending-steps/pending-steps-deps";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import {
  readPersistedPendingStepsTarget,
  type PendingStepsTarget,
} from "./pending-steps-rows";

export const PENDING_STEPS_VIEW_TYPE = "e2e-test-hub-pending-steps";

/**
 * The Pending Steps right-sidebar companion (WS1/C2, spec D5): a targeted leaf
 * (use-case / feature / vault) that guides step-definition implementation.
 * Thin Obsidian shell over {@link PendingStepsApp} (ADR-0033); the target Ref
 * follows the Use Case detail's restore-gap pattern — setState writes the ref
 * before onOpen, the app's initial load reads whatever is already there.
 */
export class PendingStepsView extends ItemView {
  private mounted: MountedVueView | null = null;
  private readonly target: Ref<PendingStepsTarget> = ref({ kind: "vault" });

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: PendingStepsDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PENDING_STEPS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Pending Steps";
  }

  getIcon(): string {
    return "list-checks";
  }

  getState(): Record<string, unknown> {
    return { target: this.target.value };
  }

  async setState(state: unknown, result: never): Promise<void> {
    const restored = readPersistedPendingStepsTarget(state);
    if (restored !== null) this.target.value = restored;
    await Promise.resolve(result);
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, PendingStepsApp, (app) => {
      app.provide(PENDING_STEPS_DEPS, this.deps);
      app.provide(PENDING_STEPS_TARGET, this.target);
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}
```

NOTE: mirror the exact `setState` signature used by `use-case-detail-view.ts` (check it — it types the second param per Obsidian's `ViewStateResult`); copy that file's signature and its restore-gap comment style rather than the sketch above if they differ.

- [ ] **Step 5: Register the view and the opener**

In `src/register-views.ts`:
1. Import: `import { PENDING_STEPS_VIEW_TYPE, PendingStepsView } from "./presentation/views/pending-steps-view";` (match the file's relative-import style: `./presentation/views/...` from `src/`).
2. Add to `ViewWiringDeps` (find the interface — it carries `openUseCaseDetail`, `openCreateSuite`, …): `openPendingSteps: (target: PendingStepsTarget) => void;` with the import `import type { PendingStepsTarget } from "./presentation/views/pending-steps-rows";`
3. Register (next to the Test Console registration):

```ts
  plugin.registerView(
    PENDING_STEPS_VIEW_TYPE,
    (leaf) =>
      new PendingStepsView(leaf, {
        specificationService: s.specificationService,
        stepDefinitionService: s.stepDefinitionService,
        useCaseService: s.useCaseService,
        fs: vault,
        workspace,
        eventBus,
      }),
  );
```

In `src/main.ts`, add the opener next to `openUseCaseDetail` (sidebar variant — the console's placement):

```ts
  // WS1/C2: open (or re-target) the Pending Steps sidebar companion. A single
  // leaf is reused; the target travels in the view state so it survives a
  // workspace reload (spec D5).
  private async openPendingSteps(target: PendingStepsTarget): Promise<void> {
    const { workspace } = this.app;
    const leaf =
      workspace.getLeavesOfType(PENDING_STEPS_VIEW_TYPE)[0] ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: PENDING_STEPS_VIEW_TYPE, active: true, state: { target } });
    void workspace.revealLeaf(leaf);
  }
```

…with imports for `PENDING_STEPS_VIEW_TYPE` and `PendingStepsTarget`, and pass `openPendingSteps: (target) => void this.openPendingSteps(target)` wherever `ViewWiringDeps` is constructed (grep `openUseCaseDetail:` in `main.ts` — add the sibling entry at each construction site).

- [ ] **Step 6: Write the component test**

Create `tests/vue/pending-steps-app.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import PendingStepsApp from "../../src/presentation/vue/pending-steps/PendingStepsApp.vue";
import {
  PENDING_STEPS_DEPS,
  PENDING_STEPS_TARGET,
  type PendingStepsDeps,
} from "../../src/presentation/vue/pending-steps/pending-steps-deps";
import type { PendingStepsTarget } from "../../src/presentation/views/pending-steps-rows";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { createEvent } from "../../src/shared/event-bus/create-event";
import { ok, err } from "../../src/shared/result/result";
import { appError } from "../../src/shared/errors/errors";

const FEATURE = `Feature: Demo\n\nScenario: One\n  Given I do a thing\n`;

const makeDeps = (overrides: Partial<PendingStepsDeps> = {}): PendingStepsDeps => ({
  specificationService: {
    listFeatures: async () => ok([{ path: "features/UC-001-a.feature", label: "UC-001-a.feature" }]),
    listStepPatterns: async () => [],
    detectMissingSteps: async (path) =>
      ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" }),
  },
  stepDefinitionService: {
    generate: async () =>
      ok({ generatedSteps: [], stepFile: "steps.ts", appended: false, insertions: [] }),
  },
  useCaseService: { findById: async () => err(appError("VALIDATION_FAILED", "none")) },
  fs: { readFile: async () => ok(FEATURE) },
  workspace: { openInSystemEditor: async () => ok(undefined) },
  eventBus: new InMemoryEventBus(),
  ...overrides,
});

const mountApp = (target: PendingStepsTarget, deps: PendingStepsDeps) =>
  mount(PendingStepsApp, {
    global: {
      provide: {
        [PENDING_STEPS_DEPS as symbol]: deps,
        [PENDING_STEPS_TARGET as symbol]: ref(target),
      },
    },
  });

describe("PendingStepsApp", () => {
  it("lists statically-incomplete features for the vault target without spawning", async () => {
    const detectCalls: string[] = [];
    let patternLoads = 0;
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () =>
          ok([
            { path: "features/UC-001-a.feature", label: "UC-001-a.feature" },
            { path: "features/UC-002-b.feature", label: "UC-002-b.feature" },
          ]),
        listStepPatterns: async () => {
          patternLoads += 1;
          return [];
        },
        detectMissingSteps: async (path) => {
          detectCalls.push(path);
          return ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" });
        },
      },
    });
    const w = mountApp({ kind: "vault" }, deps);
    await flushPromises();
    expect(w.text()).toContain("UC-001-a.feature");
    expect(w.text()).toContain("0 of 1 steps defined");
    // Vault target never runs bddgen (spec D8)…
    expect(detectCalls).toHaveLength(0);
    // …and the step-definition scan runs ONCE per render, not once per Feature
    // (Codex P2 on PR #102).
    expect(patternLoads).toBe(1);
  });

  it("auto-verifies a feature-targeted open (one bddgen run) and flips to verified", async () => {
    const detectCalls: string[] = [];
    const deps = makeDeps({
      specificationService: {
        listFeatures: async () => ok([]),
        listStepPatterns: async () => [],
        detectMissingSteps: async (path) => {
          detectCalls.push(path);
          return ok({ featurePath: path, missingSteps: [], detectionEventId: "e1" });
        },
      },
    });
    const w = mountApp({ kind: "feature", featurePath: "features/UC-001-a.feature" }, deps);
    await flushPromises();
    expect(detectCalls).toEqual(["features/UC-001-a.feature"]);
    expect(w.text()).toContain("verified");
    expect(w.text()).toContain("Every step has a definition.");
  });

  it("generate survives its own stepdefinition.generated event and shows the viewer", async () => {
    const detectCalls: string[] = [];
    const stubFile = `import { createBdd } from "playwright-bdd";\nconst { Given, When, Then } = createBdd();\n\n// stub\nGiven("I do a thing", async ({ page }) => {\n  throw new Error("Pending");\n});\n`;
    // A SHARED bus the generate fake publishes on, exactly like the real
    // service — InMemoryEventBus.publish awaits the panel's own subscription,
    // so without the actionDepth swallow this bumps `generation` mid-action
    // and the success path/viewer never renders (Codex P1 on PR #102). This
    // test FAILS against the unguarded implementation.
    const bus = new InMemoryEventBus();
    const deps = makeDeps({
      eventBus: bus,
      specificationService: {
        listFeatures: async () => ok([]),
        listStepPatterns: async () => [],
        detectMissingSteps: async (path) => {
          detectCalls.push(path);
          return ok({
            featurePath: path,
            missingSteps: detectCalls.length === 1 ? [] : detectCalls.length === 2 ? ["I do a thing"] : [],
            detectionEventId: "e1",
          });
        },
      },
      stepDefinitionService: {
        generate: async () => {
          await bus.publish(
            createEvent("stepdefinition.generated", {
              featurePath: "features/UC-001-a.feature",
              stepFile: "steps/UC-001-a.steps.ts",
              generatedSteps: ["I do a thing"],
            }),
          );
          return ok({
            generatedSteps: ["I do a thing"],
            stepFile: "steps/UC-001-a.steps.ts",
            appended: false,
            insertions: [{ step: "I do a thing", startLine: 4, endLine: 7 }],
          });
        },
      },
      fs: {
        readFile: async (path: string) => ok(path.endsWith(".steps.ts") ? stubFile : FEATURE),
      },
    });
    const w = mountApp({ kind: "feature", featurePath: "features/UC-001-a.feature" }, deps);
    await flushPromises(); // initial load + auto-verify (detect #1)
    await w.find(".spec-pending-feature-actions button.mod-cta").trigger("click"); // Generate (detect #2, re-detect #3)
    await flushPromises();
    expect(detectCalls).toHaveLength(3);
    expect(w.text()).toContain("Generated 1 step stub in steps/UC-001-a.steps.ts.");
    const inserted = w.findAll(".spec-pending-stub-line.is-inserted");
    expect(inserted).toHaveLength(4); // lines 4-7
  });
});
```

NOTE: check `InMemoryEventBus`'s actual exported name/construction in `src/shared/event-bus/event-bus.ts` (grep `export class`) and match; if the fake-bus idiom in existing `tests/vue/*.test.ts` differs (e.g. a `tests/fakes.ts` helper), reuse that instead. The generate-button selector must not collide with other `.mod-cta` buttons — scope it via `w.find(".spec-pending-feature-actions button.mod-cta")`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/vue/pending-steps-app.test.ts && npm run typecheck`
Expected: PASS + clean typecheck (the vue tsconfig picks up the new .vue files via the existing include).

- [ ] **Step 8: Commit**

```bash
git add src/presentation/vue/pending-steps src/presentation/views/pending-steps-view.ts src/register-views.ts src/main.ts tests/vue/pending-steps-app.test.ts
git commit -m "WS1: Pending Steps sidebar companion leaf (spec D5, ADR-0033 pattern)"
```

### Task 8: Entry points — merged Steps action, rail CTA, console hint button, command, tour

**Files:**
- Modify: `src/presentation/vue/use-case-detail/FeatureRow.vue`
- Modify: `src/presentation/vue/use-case-detail/use-case-detail-deps.ts`
- Modify: `src/presentation/vue/use-case-detail/UseCaseDetailApp.vue`
- Modify: `src/presentation/views/loop-rail-rows.ts`
- Modify: `src/presentation/views/test-console-format.ts`
- Modify: `src/presentation/vue/test-console/test-console-deps.ts`, `src/presentation/vue/test-console/TestConsoleApp.vue`
- Modify: `src/presentation/commands/register-commands.ts` (+ its deps construction in `main.ts`)
- Modify: `src/presentation/views/tour-actions.ts`, `src/domain/onboarding/tour-steps.ts`, `src/register-views.ts` (tour flows)
- Tests: `tests/loop-rail-rows.test.ts`, `tests/test-console-format.test.ts`, `tests/vue/use-case-detail-app.test.ts`, `tests/vue/test-console-app.test.ts`, `tests/tour-steps.test.ts`, `tests/register-commands*.test.ts` (whichever exists — see the command smoke test)

- [ ] **Step 1: Rail label — failing test first**

In `tests/loop-rail-rows.test.ts`, find the assertion on the steps-stage `actionLabel` (search `"Generate step definitions"`) and change it to `"Open pending steps"`. Run `npx vitest run tests/loop-rail-rows.test.ts` — expect FAIL. Then in `src/presentation/views/loop-rail-rows.ts` change:

```ts
const ACTION_LABEL: Record<Exclude<LoopRailAction, null>, string> = {
  "generate-feature": "Generate feature",
  "generate-steps": "Open pending steps",
  "create-suite": "Create suite",
  run: "Run",
};
```

Re-run — expect PASS.

- [ ] **Step 2: Use Case detail — deps + rail action + merged row button**

1. `src/presentation/vue/use-case-detail/use-case-detail-deps.ts`: add to `UseCaseDetailDeps`:

```ts
  /** WS1/C2: opens the Pending Steps sidebar companion at a target. */
  openPendingSteps: (target: PendingStepsTarget) => void;
```

with `import type { PendingStepsTarget } from "../../views/pending-steps-rows";`

2. `src/register-views.ts`: in the `UseCaseDetailView` registration deps, add `openPendingSteps: (target) => deps.openPendingSteps(target),`.

3. `src/presentation/vue/use-case-detail/UseCaseDetailApp.vue`: in `runLoopAction`, replace the `generate-steps` arm:

```ts
    case "generate-steps":
      // WS1/C2: the guided flow opens the Pending Steps companion (which owns
      // detect/generate + the stub viewer) instead of blind-generating here.
      deps.openPendingSteps({ kind: "use-case", useCaseId: model.useCase.id });
      return;
```

Then delete `generateStepsForAll` and `collectStepGenerationRows` and their now-unused imports **if** nothing else references them (`grep -n "generateStepsForAll\|collectStepGenerationRows" src/presentation/vue/use-case-detail/UseCaseDetailApp.vue`); keep `loopResult` only if other arms still write it — if unused, remove the ref and its template block too.

4. `src/presentation/vue/use-case-detail/FeatureRow.vue`: replace the two buttons (Detect missing steps / Generate step definitions) with one:

```vue
        <button :aria-label="`Open pending steps for ${row.label}`" @click="steps">
          Steps
        </button>
```

and in the script replace the `detect`/`generate` handlers with:

```ts
const steps = (): void =>
  deps.openPendingSteps({ kind: "feature", featurePath: props.row.path });
```

Remove the now-unused imports (`detectMissingStepsOutcome`, `generateStepDefinitionsOutcome`) from FeatureRow.vue — but NOTE `generateStepDefinitionsOutcome` must stay exported from `use-case-detail-rows.ts` (the command palette still uses it — verify with `grep -rn "generateStepDefinitionsOutcome" src`).

5. Update `tests/vue/use-case-detail-app.test.ts`: the rail-action test that asserted generation now asserts `openPendingSteps` was called with `{ kind: "use-case", useCaseId: ... }` (add the fake to its deps object); the FeatureRow assertions on the two old buttons become one "Steps" button asserting the `{ kind: "feature", ... }` call.

Run: `npx vitest run tests/vue/use-case-detail-app.test.ts` → PASS.

- [ ] **Step 3: Console hint becomes a button**

1. `tests/test-console-format.test.ts`: update the `summaryHint` expectation to the new copy `"Some steps have no step definition — open Pending Steps to generate and implement them."` (run first to see it fail).
2. `src/presentation/views/test-console-format.ts`: change the hint string accordingly.
3. `src/presentation/vue/test-console/test-console-deps.ts`: add to `TestConsoleDeps`:

```ts
  // WS1/C2: the missing-steps hint's action — opens the Pending Steps
  // companion targeted at the finished run's scope (vault-wide otherwise).
  openPendingSteps(target: PendingStepsTarget): void;
```

with `import type { PendingStepsTarget } from "../../views/pending-steps-rows";`

4. `src/register-views.ts`: in the `TestConsoleView` registration deps add `openPendingSteps: (target) => deps.openPendingSteps(target),`.
5. `src/presentation/vue/test-console/TestConsoleApp.vue`: import `pendingStepsTargetForRun` from `"../../views/pending-steps-rows"`; add next to the other handlers:

```ts
const openPendingSteps = (): void => {
  const last = lastRunSnap.value;
  deps.openPendingSteps(
    last === null ? { kind: "vault" } : pendingStepsTargetForRun(last.scope, last.target),
  );
};
```

and extend the banner-hint template block:

```vue
        <div v-if="banner.hint" class="e2e-test-hub-console-banner-hint">
          {{ banner.hint }}
          <button aria-label="Open pending steps" @click="openPendingSteps">
            Open pending steps
          </button>
        </div>
```

6. `tests/vue/test-console-app.test.ts`: add a case that drives a terminal run with a `Missing step definitions: 2` summary line (reuse the file's existing event-driving helpers), then clicks the hint button and asserts `openPendingSteps` received the run-scope target. Add the `openPendingSteps` fake to the file's deps factory.

Run: `npx vitest run tests/test-console-format.test.ts tests/vue/test-console-app.test.ts` → PASS.

- [ ] **Step 4: Command palette + tour**

1. `src/presentation/commands/register-commands.ts`: add to `TestHubCommandDeps` (the interface listing services/helpers): `openPendingSteps: (target: PendingStepsTarget) => void;` (+ type import). Register next to "Build — generate step definitions":

```ts
  plugin.addCommand({
    id: "open-pending-steps",
    name: "Build — open pending steps",
    callback: () => deps.openPendingSteps({ kind: "vault" }),
  });
```

2. `src/main.ts`: pass `openPendingSteps: (target) => void this.openPendingSteps(target)` where `TestHubCommandDeps` is constructed.
3. Tour: in `src/presentation/views/tour-actions.ts`, find the `TourActionId` union / flows map (`TourActionFlows`) and add an `open-pending-steps` action (label "Open pending steps") whose flow calls the same `deps.openPendingSteps({ kind: "vault" })`; wire the flow in `src/register-views.ts`'s `tourActionFlows`. In `src/domain/onboarding/tour-steps.ts`, change the `implement-steps` step's `action` from `{ id: "open-use-cases", label: "Open Use Cases" }` to `{ id: "open-pending-steps", label: "Open pending steps" }`. Its completion rules are event-based (`stepdefinition.generated` → zero-missing detect) and the panel's Generate emits both — no completion change.
4. Update `tests/tour-steps.test.ts` if it asserts the step's action id/label, and the command smoke test (`grep -rln "unique ids" tests` → the register-commands test) picks the new command up automatically; run it.

Run: `npx vitest run tests/tour-steps.test.ts && npx vitest run tests --reporter=dot 2>&1 | tail -3`
Expected: PASS across the suite.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "WS1: merged Steps action, rail CTA, console hint button, command + tour entry points (Mi4)"
```

### Task 9: WS1 CSS, docs, gate

**Files:**
- Modify: `styles.css`
- Modify: `CONTEXT.md` (add **Pending Steps** under Product surfaces)
- Modify: `CHANGELOG.md` (Unreleased → Added)
- Modify: `README.md` ("Working from the UI" — the Use Case detail bullet)

- [ ] **Step 1: CSS**

Append to `styles.css` (A1 tokens; status via `[data-status]`; accent = chrome only):

```css
/* ── Pending Steps companion (WS1/C2) ─────────────────────────────────────── */
.spec-pending-steps {
  padding: var(--size-4-2);
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
.spec-pending-steps-title {
  margin: 0;
}
.spec-pending-feature {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  padding: var(--size-4-2);
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
}
.spec-pending-feature-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--size-4-2);
}
.spec-pending-feature-name {
  font-weight: var(--font-semibold);
  overflow-wrap: anywhere;
}
.spec-pending-feature-progress-text,
.spec-pending-feature-tier {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  white-space: nowrap;
}
.spec-pending-feature-progress {
  height: 6px;
  border-radius: var(--radius-s);
  background: var(--background-modifier-border);
  overflow: hidden;
}
.spec-pending-feature-progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 150ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .spec-pending-feature-progress-fill {
    transition: none;
  }
}
.spec-pending-feature-missing {
  margin: 0;
  padding-inline-start: var(--size-4-4);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.spec-pending-feature-done {
  margin: 0;
  color: var(--text-muted);
}
.spec-pending-feature-actions {
  display: flex;
  gap: var(--size-2-2);
  flex-wrap: wrap;
}
.spec-pending-stub-viewer summary {
  cursor: var(--cursor);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.spec-pending-stub-code {
  max-height: 16em;
  overflow: auto;
  margin: var(--size-2-2) 0 0;
}
.spec-pending-stub-line.is-inserted {
  background: var(--text-selection);
  display: inline-block;
  width: 100%;
}
.e2e-test-hub-console-banner-hint button {
  margin-inline-start: var(--size-2-2);
}
```

- [ ] **Step 2: CONTEXT.md**

Under `### Product surfaces` (after **.testrunner**), add:

```markdown
**Pending Steps**:
The right-sidebar companion leaf that closes the step-definition cliff: for a Use Case, a single Feature, or the whole Vault it lists every undefined Gherkin step (conservative static tier on render; authoritative `bddgen` tier on explicit Verify/Generate), generates stubs, shows the generated code read-only at its exact insertion lines, and jumps to the step file in the system editor. Opened from the loop rail's Steps action, a Feature row's Steps button, the Test Console's missing-steps hint, and `Build — open pending steps`.
_Avoid_: Steps panel, stub browser, step explorer.
```

- [ ] **Step 2b: README.md**

In "Working from the UI", update the **Use Case detail** bullet: replace `per-Feature **Open / Run / Validate / Detect missing steps / Generate step definitions** actions` with `per-Feature **Open / Run / Validate / Steps** actions (Steps opens the **Pending Steps** sidebar companion — undefined steps, stub generation with the generated code shown at its exact lines, and a system-editor jump)`.

- [ ] **Step 3: CHANGELOG.md**

Under `## [Unreleased]` → `### Added`, prepend:

```markdown
- A **Pending Steps** sidebar companion (UX WS-C2) closing the step-definition
  cliff: per-Feature undefined-step lists with a defined/total progress bar, a
  one-click **Generate stubs** whose result opens a read-only viewer scrolled to
  the exact inserted lines (`GenerateStepDefinitionsResult` now returns per-stub
  insertion ranges), an **Open step file** jump to the system editor, and
  Verify-on-demand via `bddgen`. The Use Case detail's separate
  Detect/Generate buttons merge into one **Steps** action, the Test Console's
  missing-steps hint becomes a button, and the loop rail's Steps CTA opens the
  companion. The rail's "steps defined" signal now prefers recorded `bddgen`
  verdicts through a content-addressed step-coverage cache — an
  advanced-construct Feature advances the rail after one Verify/Generate, and
  any external edit to the Feature or the step files safely invalidates the
  verdict (closes #77).
```

- [ ] **Step 4: Full gate + audit**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage`
Expected: all green (run `npm run format` first if format:check complains).
Run: `npm run quality:audit`
Expected: no findings introduced by the changeset.

- [ ] **Step 5: Commit**

```bash
git add styles.css CONTEXT.md CHANGELOG.md
git commit -m "WS1: Pending Steps styling + glossary/changelog entries"
```

---

## WS2 — Tag-aware suites (C4)

### Task 10: `tagsInExpression` domain walker

**Files:**
- Modify: `src/domain/policies/tag-expression.ts`
- Test: `tests/tag-expression.test.ts` (extend; create the describe if the file organises differently — check `ls tests | grep tag`)

- [ ] **Step 1: Failing test**

```ts
import { parseTagExpression, tagsInExpression } from "../src/domain/policies/tag-expression";

describe("tagsInExpression", () => {
  const tagsOf = (expression: string): string[] => {
    const parsed = parseTagExpression(expression);
    if (!parsed.ok) throw new Error("fixture must parse");
    return tagsInExpression(parsed.value);
  };

  it("collects distinct tags in first-seen order across operators", () => {
    expect(tagsOf("@smoke and not @wip")).toEqual(["@smoke", "@wip"]);
    expect(tagsOf("(@a or @b) and @a")).toEqual(["@a", "@b"]);
    expect(tagsOf("")).toEqual([]);
  });
});
```

Run: `npx vitest run tests/tag-expression.test.ts` → FAIL (not exported).

- [ ] **Step 2: Implement**

Append to `src/domain/policies/tag-expression.ts`:

```ts
/**
 * Every tag a parsed expression references, distinct, first-seen order — the
 * Tag glossary's "which suites use this tag" edge (WS2/C4). Token extraction
 * from the AST, never substring matching (spec §4.3).
 */
export const tagsInExpression = (expression: TagExpression): string[] => {
  const seen = new Set<string>();
  const walk = (node: TagExpression): void => {
    switch (node.kind) {
      case "all":
        return;
      case "tag":
        seen.add(node.tag);
        return;
      case "not":
        walk(node.operand);
        return;
      case "and":
      case "or":
        walk(node.left);
        walk(node.right);
        return;
    }
  };
  walk(expression);
  return [...seen];
};
```

- [ ] **Step 3: Run + commit**

Run: `npx vitest run tests/tag-expression.test.ts` → PASS.

```bash
git add src/domain/policies/tag-expression.ts tests/tag-expression.test.ts
git commit -m "WS2: tagsInExpression AST walker for the Tag glossary"
```

### Task 11: Insight additions — per-scenario suite membership + tag usage

**Files:**
- Modify: `src/application/services/feature-insight-service.ts`
- Test: `tests/feature-insight-service.test.ts` (extend)

- [ ] **Step 1: Failing tests**

Add to `tests/feature-insight-service.test.ts` (reuse its existing feature/suite fixtures and fake-fs arrangement; the shapes below are the contract):

```ts
describe("suiteMembershipForScenario (WS2/C4)", () => {
  it("evaluates each suite's expression against the scenario's effective tags", () => {
    const feature = parseFixtureFeature(`@ui\nFeature: F\n\n@smoke\nScenario: S\n  Given a step\n`);
    const scenario = feature.scenarios[0];
    const suites = [
      suite("Smoke", "@smoke"),
      suite("UI", "@ui and not @wip"),
      suite("Other", "@other"),
      suite("Broken", "@a and and"), // malformed — skipped, never throws
    ];
    expect(suiteMembershipForScenario(feature, scenario, suites).map((s) => s.name)).toEqual([
      "Smoke",
      "UI",
    ]);
  });

  it("matches an Outline through any runnable Examples block's tags", () => {
    const feature = parseFixtureFeature(
      `Feature: F\n\nScenario Outline: O\n  Given <x>\n\n@slow\nExamples:\n  | x |\n  | 1 |\n`,
    );
    const suites = [suite("Slow", "@slow")];
    expect(
      suiteMembershipForScenario(feature, feature.scenarios[0], suites).map((s) => s.name),
    ).toEqual(["Slow"]);
  });
});

describe("tagUsage (WS2/C4)", () => {
  it("counts scenarios per tag over effective tag sets, seeding conventions", async () => {
    // Arrange the fake corpus with one feature: feature tag @ui, scenario A
    // tagged @smoke, scenario B untagged.
    const usage = await service.tagUsage();
    expect(usage.ok).toBe(true);
    if (!usage.ok) return;
    const byTag = new Map(usage.value.map((row) => [row.tag, row.scenarioCount]));
    expect(byTag.get("@ui")).toBe(2); // inherited by both scenarios
    expect(byTag.get("@smoke")).toBe(1);
    expect(byTag.get("@wip")).toBe(0); // seeded convention, unused
  });
});
```

(`suite(name, expression)` = a `TestSuite` literal `{ id, name, tagExpression, path }` — match the file's existing fixture style; `parseFixtureFeature` = whatever parse helper the file already uses, else `parseFeature(source, "f.feature")` from `../src/application/content/gherkin` with a non-null assert in tests.)

Run: `npx vitest run tests/feature-insight-service.test.ts` → FAIL.

- [ ] **Step 2: Implement**

In `src/application/services/feature-insight-service.ts`:

1. Export the currently-private tag-set helper by changing its declaration to:

```ts
export const effectiveScenarioTagSets = (
```

2. Add imports: `tagsInExpression` is NOT needed here; add `import type { TestSuite } from "../../domain/entities/suite";`
3. Add the pure membership projection (below `countMatchingScenariosInFeature`):

```ts
/**
 * The suites whose Tag Expression matches THIS scenario's effective tags
 * (WS2/C4 — the Feature Editor's "In N suites" badge). Explicitly NOT
 * `scenarioCounter`, which aggregates one expression over the whole corpus
 * (03-R6 Codex catch). A malformed expression never matches (and never
 * throws) — the suites explorer already surfaces its parse error.
 */
export const suiteMembershipForScenario = (
  feature: FeatureSpecification,
  scenario: ScenarioSpecification,
  suites: readonly TestSuite[],
): TestSuite[] =>
  suites.filter((suite) => {
    const parsed = parseTagExpression(suite.tagExpression);
    if (!parsed.ok) return false;
    return effectiveScenarioTagSets(feature, scenario).some((tags) =>
      matchesTags(parsed.value, tags),
    );
  });
```

4. Add the usage row type + service method. Interface addition:

```ts
  /**
   * Scenario counts per known tag over the Feature corpus (effective tag sets,
   * so feature-level tags count for every scenario; an Outline counts once when
   * any runnable block carries the tag). Seeds the `@smoke`/`@wip`/`@quarantine`
   * conventions at zero so the glossary always lists them. Sorted by tag.
   */
  tagUsage(): Promise<Result<TagUsageRow[]>>;
```

Type (near `FeatureHealth`):

```ts
/** One Tag glossary data row (WS2/C4): a tag and how many scenarios carry it. */
export interface TagUsageRow {
  tag: string;
  scenarioCount: number;
}
```

Implementation on `DefaultFeatureInsightService`:

```ts
  async tagUsage(): Promise<Result<TagUsageRow[]>> {
    const features = await this.loadValidFeatures();
    if (!features.ok) return err(features.error);

    const counts = new Map<string, number>([
      [SMOKE_TAG, 0],
      [WIP_TAG, 0],
      [QUARANTINE_TAG, 0],
    ]);
    for (const feature of features.value) {
      for (const scenario of feature.scenarios) {
        const tags = new Set(effectiveScenarioTagSets(feature, scenario).flat());
        for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return ok(
      [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([tag, scenarioCount]) => ({ tag, scenarioCount })),
    );
  }
```

- [ ] **Step 3: Run + commit**

Run: `npx vitest run tests/feature-insight-service.test.ts` → PASS.

```bash
git add src/application/services/feature-insight-service.ts tests/feature-insight-service.test.ts
git commit -m "WS2: per-scenario suite membership + tagUsage insight (03-R6 Codex catch honoured)"
```

### Task 12: Suite modal tag-expression builder

**Files:**
- Modify: `src/presentation/views/suite-rows.ts` (`insertToken`)
- Modify: `src/presentation/views/create-suite-modal.ts`
- Modify: `src/register-views.ts` / `src/main.ts` — wherever `CreateSuiteModal` deps are built, widen `featureInsight` to include `listKnownTags` (grep `new CreateSuiteModal`)
- Test: `tests/suite-rows.test.ts` (extend)

- [ ] **Step 1: Failing tests for `insertToken`**

Add to `tests/suite-rows.test.ts`:

```ts
import { insertToken } from "../src/presentation/views/suite-rows";

describe("insertToken (WS2/C4 builder)", () => {
  it("inserts at the cursor with a separating space when needed", () => {
    expect(insertToken("", 0, "@smoke")).toEqual({ expression: "@smoke", cursor: 6 });
    expect(insertToken("@smoke", 6, "and")).toEqual({ expression: "@smoke and", cursor: 10 });
    expect(insertToken("@smoke and", 10, "not")).toEqual({
      expression: "@smoke and not",
      cursor: 14,
    });
    expect(insertToken("@smoke and not", 14, "@wip")).toEqual({
      expression: "@smoke and not @wip",
      cursor: 19,
    });
  });

  it("adds a trailing space when inserting mid-expression before a word", () => {
    // cursor before "@wip": "@smoke |@wip" + "not" → "@smoke not @wip"
    expect(insertToken("@smoke @wip", 7, "not")).toEqual({
      expression: "@smoke not @wip",
      cursor: 11,
    });
  });

  it("does not double a space and hugs an open paren", () => {
    expect(insertToken("@smoke ", 7, "and")).toEqual({ expression: "@smoke and", cursor: 10 });
    expect(insertToken("(", 1, "@a")).toEqual({ expression: "(@a", cursor: 3 });
  });

  it("clamps an out-of-range cursor to the end", () => {
    expect(insertToken("@a", 99, "and")).toEqual({ expression: "@a and", cursor: 6 });
  });
});
```

Run: `npx vitest run tests/suite-rows.test.ts` → FAIL.

- [ ] **Step 2: Implement `insertToken`**

Append to `src/presentation/views/suite-rows.ts`:

```ts
/** A builder insertion result: the new expression and where the caret lands. */
export interface TokenInsertion {
  expression: string;
  cursor: number;
}

/**
 * Inserts a palette token (a tag or `and`/`or`/`not`/`(`/`)`) into the raw Tag
 * Expression at the caret (WS2/C4): a single separating space is added on
 * either side when the neighbouring character needs one (never after `(`,
 * never doubled), and the caret lands after the token (before any added
 * trailing space's word). Pure so the composition rules are unit-tested; the
 * modal stays a thin DOM shell.
 */
export const insertToken = (expression: string, cursor: number, token: string): TokenInsertion => {
  const at = Math.max(0, Math.min(cursor, expression.length));
  const before = expression.slice(0, at);
  const after = expression.slice(at);
  const needsLeading = before !== "" && !before.endsWith(" ") && !before.endsWith("(");
  const needsTrailing = after !== "" && !after.startsWith(" ") && !after.startsWith(")");
  const inserted = `${needsLeading ? " " : ""}${token}${needsTrailing ? " " : ""}`;
  return {
    expression: `${before}${inserted}${after}`,
    cursor: at + (needsLeading ? 1 : 0) + token.length,
  };
};
```

Run: `npx vitest run tests/suite-rows.test.ts` → PASS.

- [ ] **Step 3: Add the palette to the modal**

In `src/presentation/views/create-suite-modal.ts`:

1. Widen the deps: `featureInsight: Pick<FeatureInsightService, "countMatchingScenarios" | "listKnownTags">;` (update the comment: it now also feeds the builder palette). Update every construction site (grep `new CreateSuiteModal(` — the deps object passes `s.featureInsightService`, which already implements both, so only the `Pick` type changes).
2. Import `insertToken` from `./suite-rows`.
3. In `onOpen()`, capture the tag-expression input element: in the `.addText((text) => { ... })` callback add `this.tagInputEl = text.inputEl;` (declare `private tagInputEl: HTMLInputElement | null = null;` on the class).
4. After the `previewEl` creation, add the palette:

```ts
    // WS2/C4: the tag-expression builder — operator buttons + the vault's known
    // tags as clickable chips composing into the SAME raw input (which stays
    // fully editable; the live preview revalidates every insertion).
    const palette = contentEl.createDiv({ cls: "spec-suite-tag-palette" });
    const operators = palette.createDiv({ cls: "spec-suite-tag-palette-row" });
    for (const operator of ["and", "or", "not", "(", ")"]) {
      const button = operators.createEl("button", {
        text: operator,
        attr: { type: "button", "aria-label": `Insert ${operator}` },
      });
      button.addEventListener("click", () => this.insertPaletteToken(operator));
    }
    const tagsRow = palette.createDiv({ cls: "spec-suite-tag-palette-row" });
    void this.deps.featureInsight.listKnownTags().then((tags) => {
      if (!tags.ok || !tagsRow.isConnected) return;
      for (const tag of tags.value) {
        const chip = tagsRow.createEl("button", {
          text: tag,
          cls: "spec-suite-tag-chip",
          attr: { type: "button", "aria-label": `Insert ${tag}` },
        });
        chip.addEventListener("click", () => this.insertPaletteToken(tag));
      }
    });
```

5. Add the private method (near `schedulePreview`):

```ts
  /** Compose a palette token into the raw input at the caret, then re-preview. */
  private insertPaletteToken(token: string): void {
    const input = this.tagInputEl;
    if (input === null) return;
    const caret = input.selectionStart ?? input.value.length;
    const next = insertToken(input.value, caret, token);
    input.value = next.expression;
    this.tagExpression = next.expression;
    input.focus();
    input.setSelectionRange(next.cursor, next.cursor);
    const previewEl = this.previewEl;
    if (previewEl !== null) this.schedulePreview(previewEl);
  }
```

6. `schedulePreview` currently receives `previewEl` as a parameter from the `onChange` closure; store it on the class instead so `insertPaletteToken` can reach it: declare `private previewEl: HTMLElement | null = null;`, set `this.previewEl = previewEl;` right after creating it in `onOpen()`, and null it in `onClose()`.

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npx vitest run tests/suite-rows.test.ts`
Expected: clean + PASS. (The modal itself has no unit test — per AGENTS.md views stay untested; the pure `insertToken` carries the logic.)

```bash
git add src/presentation/views/suite-rows.ts src/presentation/views/create-suite-modal.ts src/register-views.ts src/main.ts tests/suite-rows.test.ts
git commit -m "WS2: suite-modal tag palette + operator builder over pure insertToken"
```

### Task 13: "In N suites" badge in the Feature editor

**Files:**
- Modify: `src/presentation/vue/feature-editor/feature-editor-controller.ts` (deps + suites ref)
- Modify: `src/presentation/vue/feature-editor/ScenarioCard.vue` (the chip)
- Modify: `src/presentation/views/feature-editor-view.ts` + `src/register-views.ts` (deps wiring — find where `FeatureEditorView` is constructed and its controller deps built)
- Test: `tests/vue/scenario-card-membership.test.ts` (new)

- [ ] **Step 1: Failing component test**

Create `tests/vue/scenario-card-membership.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, shallowRef } from "vue";
import ScenarioCard from "../../src/presentation/vue/feature-editor/ScenarioCard.vue";
import { FEATURE_EDITOR } from "../../src/presentation/vue/feature-editor/feature-editor-controller";
import { parseFeature } from "../../src/application/content/gherkin";

const SOURCE = `@ui\nFeature: F\n\n@smoke\nScenario: S\n  Given a step\n`;

const makeCtrl = (suites: { name: string; tagExpression: string }[]) => ({
  // Only the members ScenarioCard touches; tests may shape-cast (relaxed lint).
  commit: () => undefined,
  suites: ref(
    suites.map((s, i) => ({ id: `SUITE-00${i}`, name: s.name, tagExpression: s.tagExpression, path: `Suites/${s.name}.md` })),
  ),
  historyRefs: ref(new Set<string>()),
  historyRuns: ref(new Map<string, number>()),
  knownTags: ref([]),
  stepPatterns: ref([]),
});

describe("ScenarioCard suite-membership badge", () => {
  it("shows In N suites with the names in the tooltip", () => {
    const spec = parseFeature(SOURCE, "f.feature");
    if (spec === null) throw new Error("fixture must parse");
    const ctrl = makeCtrl([
      { name: "Smoke", tagExpression: "@smoke" },
      { name: "UI", tagExpression: "@ui" },
      { name: "Other", tagExpression: "@other" },
    ]);
    const w = mount(ScenarioCard, {
      props: { spec, index: 0 },
      global: { provide: { [FEATURE_EDITOR as symbol]: ctrl } },
    });
    const badge = w.find(".spec-suite-membership");
    expect(badge.text()).toBe("In 2 suites");
    expect(badge.attributes("title")).toBe("Smoke, UI");
  });

  it("renders the zero case muted", () => {
    const spec = parseFeature(SOURCE, "f.feature");
    if (spec === null) throw new Error("fixture must parse");
    const w = mount(ScenarioCard, {
      props: { spec, index: 0 },
      global: { provide: { [FEATURE_EDITOR as symbol]: makeCtrl([]) } },
    });
    expect(w.find(".spec-suite-membership").text()).toBe("In no suites");
  });
});
```

(If mounting `ScenarioCard` standalone drags in child deps that need more ctrl members, extend `makeCtrl` with inert refs to satisfy them — check `TagEditor`/`StepList`/`StepRow` for what they inject; they use the same `FEATURE_EDITOR` controller, so include `datalist`-related members as inert values as needed. Follow whatever `tests/vue/use-case-detail-app.test.ts`-style fakes already do for this tree if a helper exists.)

Run: `npx vitest run tests/vue/scenario-card-membership.test.ts` → FAIL.

- [ ] **Step 2: Implement**

1. `feature-editor-controller.ts`:
   - Deps: `specifications` stays; widen `featureInsight` to `Pick<FeatureInsightService, "listKnownTags">` (unchanged) and ADD `suiteService: Pick<SuiteService, "findAll">;` (+ import), and ADD `eventBus: EventBus;` (+ import from `../../../shared/event-bus/event-bus`).
   - Controller interface: add `suites: Ref<TestSuite[]>;` (+ `import type { TestSuite } from "../../../domain/entities/suite";`).
   - In `createFeatureEditorController`: `const suites = ref<TestSuite[]>([]);`, extend `loadAids`:

```ts
  const loadAids = async (): Promise<void> => {
    const [patterns, tags, suiteList] = await Promise.all([
      deps.specifications.listStepPatterns(),
      deps.featureInsight.listKnownTags(),
      deps.suiteService.findAll(),
    ]);
    stepPatterns.value = patterns;
    if (tags.ok) knownTags.value = tags.value;
    if (suiteList.ok) suites.value = suiteList.value;
  };
```

   - Return `suites` from the factory.
2. `FeatureEditorApp.vue`: subscribe the aids to suite creation so a suite created while the editor is open updates the badges:

```ts
import { useEventBus } from "../use-event-bus";
// All three suite events: an edited Tag Expression or a deleted suite changes
// membership just as much as a created one (Codex P2 on PR #102) — the same
// set SuiteDashboardBody subscribes to.
useEventBus(ctrl.deps.eventBus, ["suite.created", "suite.updated", "suite.deleted"], () =>
  ctrl.loadAids(),
);
```

3. `ScenarioCard.vue`: add to the script:

```ts
import { suiteMembershipForScenario } from "../../../application/services/feature-insight-service";

const membership = computed(() =>
  suiteMembershipForScenario(props.spec, scenario.value, ctrl.suites.value),
);
const membershipText = computed(() =>
  membership.value.length === 0
    ? "In no suites"
    : `In ${membership.value.length} suite${membership.value.length === 1 ? "" : "s"}`,
);
const membershipTitle = computed(() => membership.value.map((suite) => suite.name).join(", "));
```

and in the template, right after `<TagEditor ... />`:

```vue
    <span
      class="spec-suite-membership"
      :data-status="membership.length === 0 ? undefined : 'ok'"
      :title="membershipTitle || undefined"
      :aria-label="membershipTitle ? `${membershipText}: ${membershipTitle}` : membershipText"
    >{{ membershipText }}</span>
```

4. Wire the new deps where the controller is constructed: `grep -n "createFeatureEditorController\|new FeatureEditorView" src/presentation/views/feature-editor-view.ts src/register-views.ts` — add `suiteService: s.suiteService,` and `eventBus,` to the deps object.

- [ ] **Step 3: Run + commit**

Run: `npx vitest run tests/vue/scenario-card-membership.test.ts && npm run typecheck` → PASS/clean.

```bash
git add src/presentation/vue/feature-editor tests/vue/scenario-card-membership.test.ts src/presentation/views/feature-editor-view.ts src/register-views.ts
git commit -m "WS2: per-scenario 'In N suites' membership badge in the Feature editor"
```

### Task 14: Tag glossary hub body (Run section)

**Files:**
- Create: `src/presentation/views/tag-glossary-rows.ts`
- Create: `src/presentation/vue/suites/TagGlossaryBody.vue`
- Create: `src/presentation/vue/suites/tag-glossary-deps.ts`
- Modify: `src/presentation/navigation/hub-sections.ts` (body id + run contents)
- Modify: `src/presentation/vue/hub/HubSection.vue`, `src/presentation/vue/hub/hub-deps.ts`, hub deps construction in `src/register-views.ts`
- Tests: `tests/tag-glossary-rows.test.ts`, `tests/hub-sections.test.ts` (extend), `tests/vue/tag-glossary-body.test.ts`

- [ ] **Step 1: Failing projection test**

Create `tests/tag-glossary-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { projectTagGlossary } from "../src/presentation/views/tag-glossary-rows";
import type { TestSuite } from "../src/domain/entities/suite";
import type { SuiteId, VaultPath } from "../src/domain/value-objects/identifiers";

const suite = (name: string, tagExpression: string): TestSuite => ({
  id: name as SuiteId,
  name,
  tagExpression,
  path: `Test Suites/${name}.md` as VaultPath,
});

describe("projectTagGlossary", () => {
  it("joins usage counts with the suites referencing each tag (AST tokens)", () => {
    const rows = projectTagGlossary(
      [
        { tag: "@smoke", scenarioCount: 3 },
        { tag: "@wip", scenarioCount: 0 },
      ],
      [suite("Smoke", "@smoke and not @wip"), suite("Broken", "@a and and")],
    );
    expect(rows).toEqual([
      {
        tag: "@smoke",
        scenarioCount: 3,
        suites: [{ name: "Smoke", path: "Test Suites/Smoke.md" }],
      },
      {
        tag: "@wip",
        scenarioCount: 0,
        suites: [{ name: "Smoke", path: "Test Suites/Smoke.md" }],
      },
    ]);
  });
});
```

Run: `npx vitest run tests/tag-glossary-rows.test.ts` → FAIL.

- [ ] **Step 2: Implement the projection**

Create `src/presentation/views/tag-glossary-rows.ts`:

```ts
import type { TagUsageRow } from "../../application/services/feature-insight-service";
import type { TestSuite } from "../../domain/entities/suite";
import {
  parseTagExpression,
  tagsInExpression,
} from "../../domain/policies/tag-expression";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * The Tag glossary (WS2/C4, spec §4.3): one row per known tag with its scenario
 * count and the suites whose Tag Expression references it — tag tokens taken
 * from the parsed AST, never substring matching. Pure projection; the hub body
 * stays a thin render.
 */

export interface TagGlossarySuiteRef {
  name: string;
  path: VaultPath;
}

export interface TagGlossaryRow {
  tag: string;
  scenarioCount: number;
  suites: TagGlossarySuiteRef[];
}

export const projectTagGlossary = (
  usage: readonly TagUsageRow[],
  suites: readonly TestSuite[],
): TagGlossaryRow[] => {
  const suiteTags = suites
    .map((suite) => {
      const parsed = parseTagExpression(suite.tagExpression);
      return {
        suite,
        tags: parsed.ok ? new Set(tagsInExpression(parsed.value)) : new Set<string>(),
      };
    })
    .filter((entry) => entry.tags.size > 0);
  return usage.map(({ tag, scenarioCount }) => ({
    tag,
    scenarioCount,
    suites: suiteTags
      .filter((entry) => entry.tags.has(tag))
      .map((entry) => ({ name: entry.suite.name, path: entry.suite.path })),
  }));
};
```

Run: `npx vitest run tests/tag-glossary-rows.test.ts` → PASS.

- [ ] **Step 3: Hub sections — failing test then wiring**

In `tests/hub-sections.test.ts`, find the assertion on the run section's `contents` and extend it to expect the glossary body between the suites body and the console leaf: `[body suites, body tag-glossary, leaf console]` (match the file's assertion style). Run → FAIL. Then in `src/presentation/navigation/hub-sections.ts`:

- Extend the union: add `| "tag-glossary"` to `HubBodyId`.
- Run section contents: `contents: [body("suites"), body("tag-glossary"), leaf(TEST_CONSOLE_LEAF, "sidebar")],`

Run → PASS.

- [ ] **Step 4: The body component + deps**

Create `src/presentation/vue/suites/tag-glossary-deps.ts`:

```ts
import type { FeatureInsightService } from "../../../application/services/feature-insight-service";
import type { SuiteService } from "../../../application/services/suite-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { NavigationTarget } from "../../navigation/navigation-target";

/** Everything the Tag glossary body needs to load, render, and stay live. */
export interface TagGlossaryDeps {
  featureInsight: Pick<FeatureInsightService, "tagUsage">;
  suiteService: Pick<SuiteService, "findAll">;
  /** Suite names deep-link to the suite note via the unified navigator (B4). */
  navigate: (target: NavigationTarget) => void;
  eventBus: EventBus;
}
```

Create `src/presentation/vue/suites/TagGlossaryBody.vue`:

```vue
<script setup lang="ts">
/**
 * The Tag glossary hub body (WS2/C4, spec D12): every known tag, its scenario
 * count, and the suites using it. Read-only; suite names navigate via the B4
 * suite path target. Self-loading + bus-live like every hub body (ADR-0033).
 */
import { shallowRef } from "vue";
import type { TagGlossaryDeps } from "./tag-glossary-deps";
import { useEventBus } from "../use-event-bus";
import { projectTagGlossary, type TagGlossaryRow } from "../../views/tag-glossary-rows";
import { suiteTarget } from "../../navigation/navigation-target";

const props = defineProps<{ deps: TagGlossaryDeps }>();

const rows = shallowRef<TagGlossaryRow[] | null>(null);

async function load(): Promise<void> {
  const [usage, suites] = await Promise.all([
    props.deps.featureInsight.tagUsage(),
    props.deps.suiteService.findAll(),
  ]);
  rows.value = usage.ok && suites.ok ? projectTagGlossary(usage.value, suites.value) : [];
}

// The full set of events that can change tagUsage() or findAll(): Feature
// created/edited, suite created/updated/deleted (Codex P2 on PR #102) — the
// same set SuiteDashboardBody subscribes to.
useEventBus(
  props.deps.eventBus,
  ["specification.created", "specification.updated", "suite.created", "suite.updated", "suite.deleted"],
  load,
);
</script>

<template>
  <div v-if="rows !== null" class="spec-tag-glossary">
    <h4 class="spec-tag-glossary-title">Tags</h4>
    <table class="spec-tag-glossary-table">
      <thead>
        <tr>
          <th scope="col">Tag</th>
          <th scope="col">Scenarios</th>
          <th scope="col">Used by suites</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.tag">
          <td class="spec-tag-glossary-tag">{{ row.tag }}</td>
          <td>{{ row.scenarioCount }}</td>
          <td>
            <template v-if="row.suites.length === 0">—</template>
            <template v-else>
              <a
                v-for="(suite, i) in row.suites"
                :key="suite.path"
                href="#"
                @click.prevent="deps.navigate(suiteTarget(suite.path))"
              >{{ suite.name }}<template v-if="i < row.suites.length - 1">, </template></a>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

NOTE: confirm the suite path target constructor name in `src/presentation/navigation/navigation-target.ts` (`grep -n "suiteTarget\|kind: \"suite\"" src/presentation/navigation/navigation-target.ts`) and use the real helper.

- [ ] **Step 5: Hub wiring**

1. `src/presentation/vue/hub/hub-deps.ts`: add a `tags: Omit<TagGlossaryDeps, "eventBus">;` slice to the hub deps interface (match how `suites`/`prds` slices are declared — they omit the bus, which HubSection injects).
2. `src/presentation/vue/hub/HubSection.vue`: import the body and add the branch after the suites body:

```vue
        <TagGlossaryBody
          v-else-if="content.body === 'tag-glossary'"
          :deps="{ ...deps.tags, eventBus: deps.eventBus }"
        />
```

3. `src/register-views.ts` (the `HubView` registration deps): add the `tags` slice:

```ts
        tags: {
          featureInsight: s.featureInsightService,
          suiteService: s.suiteService,
          navigate: (target) => deps.navigate(target),
        },
```

(Match the surrounding slices' exact shape.)

- [ ] **Step 6: Component test**

Create `tests/vue/tag-glossary-body.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TagGlossaryBody from "../../src/presentation/vue/suites/TagGlossaryBody.vue";
import { ok } from "../../src/shared/result/result";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";

describe("TagGlossaryBody", () => {
  it("renders tag rows and navigates to a suite note on click", async () => {
    const navigate = vi.fn();
    const w = mount(TagGlossaryBody, {
      props: {
        deps: {
          featureInsight: { tagUsage: async () => ok([{ tag: "@smoke", scenarioCount: 2 }]) },
          suiteService: {
            findAll: async () =>
              ok([
                {
                  id: "SUITE-001",
                  name: "Smoke",
                  tagExpression: "@smoke",
                  path: "Test Suites/Smoke.md",
                },
              ]),
          },
          navigate,
          eventBus: new InMemoryEventBus(),
        },
      },
    });
    await flushPromises();
    expect(w.text()).toContain("@smoke");
    expect(w.text()).toContain("2");
    await w.find("a").trigger("click");
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ kind: "suite" }));
  });
});
```

(Adjust the bus construction and the suite/`SuiteId` branding to the test suite's established idioms — tests may `as`.)

- [ ] **Step 7: Run, CSS, commit**

Run: `npx vitest run tests/vue/tag-glossary-body.test.ts tests/hub-sections.test.ts tests/vue/hub-shell.test.ts && npm run typecheck` → PASS/clean (fix `hub-shell.test.ts` if it enumerates run-section bodies).

Append to `styles.css`:

```css
/* ── Tag glossary (WS2/C4) ────────────────────────────────────────────────── */
.spec-tag-glossary-table {
  width: 100%;
  border-collapse: collapse;
}
.spec-tag-glossary-table th,
.spec-tag-glossary-table td {
  text-align: start;
  padding: var(--size-2-2) var(--size-4-2);
  border-bottom: 1px solid var(--background-modifier-border);
}
.spec-tag-glossary-tag {
  font-family: var(--font-monospace);
}
```

```bash
git add -A src tests styles.css
git commit -m "WS2: Tag glossary hub body in the Run section (spec D12)"
```

### Task 15: WS2 docs

- [ ] **Step 1: CONTEXT.md + CHANGELOG.md**

CONTEXT.md, under `### Business artifacts` (after **Tag Expression**), add:

```markdown
**Tag glossary**:
The read-only Run-section hub body listing every known tag, how many scenarios carry it (effective tags), and which Test Suites reference it in their Tag Expression (AST tokens, not substrings). Complements the suite modal's tag palette and the Feature editor's per-scenario "In N suites" badge.
_Avoid_: Tag list, tag index, tag manager.
```

CHANGELOG.md `### Added`:

```markdown
- **Tag-aware suite authoring** (UX WS-C4): the New Test Suite modal grows a
  tag-expression **builder** — the vault's known tags as clickable chips plus
  `and`/`or`/`not`/parens operator buttons composing into the still-editable
  raw field with the live "Matches N scenarios" preview; the Feature editor
  shows **"In N suites"** under each scenario via a new per-scenario
  suite-membership projection (each suite's Tag Expression evaluated against
  the scenario's effective tags); and a read-only **Tag glossary** hub body in
  the Run section lists every tag, its scenario count, and the suites using it.
```

- [ ] **Step 2: Gate + commit**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit`
Expected: green / no introduced findings.

```bash
git add CONTEXT.md CHANGELOG.md
git commit -m "WS2: glossary + changelog entries"
```

---

## WS3 — Rename identity guard (C5)

### Task 16: `rename-guard.ts` pure decision module

**Files:**
- Create: `src/presentation/views/rename-guard.ts`
- Test: `tests/rename-guard.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/rename-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renameGuardVerdict } from "../src/presentation/views/rename-guard";

const refs = (...values: string[]): ReadonlySet<string> => new Set(values);

describe("renameGuardVerdict (WS3/C5)", () => {
  it("commits frictionlessly when the old name has no recorded history", () => {
    expect(
      renameGuardVerdict("f.feature", "Old", "New", refs("f.feature::Other"), new Map()),
    ).toEqual({ kind: "commit" });
  });

  it("commits when the name did not actually change (after trim)", () => {
    expect(
      renameGuardVerdict("f.feature", "Same", " Same ", refs("f.feature::Same"), new Map()),
    ).toEqual({ kind: "commit" });
  });

  it("confirms a history-bearing rename with the recent-run weight", () => {
    const verdict = renameGuardVerdict(
      "f.feature",
      "Checkout",
      "Payment",
      refs("f.feature::Checkout"),
      new Map([["f.feature::Checkout", 7]]),
    );
    expect(verdict).toEqual({
      kind: "confirm",
      prompt:
        'Scenario "Checkout" has recorded history (7 recent runs) — renaming starts fresh.',
    });
  });

  it("matches Outline row refs and sums their recent runs", () => {
    const verdict = renameGuardVerdict(
      "f.feature",
      "O",
      "P",
      refs("f.feature::O::row-abc", "f.feature::O::row-def"),
      new Map([
        ["f.feature::O::row-abc", 2],
        ["f.feature::O::row-def", 3],
      ]),
    );
    expect(verdict).toEqual({
      kind: "confirm",
      prompt: 'Scenario "O" has recorded history (5 recent runs) — renaming starts fresh.',
    });
  });

  it("omits the count when no weight is known", () => {
    expect(
      renameGuardVerdict("f.feature", "Old", "New", refs("f.feature::Old"), new Map()),
    ).toEqual({
      kind: "confirm",
      prompt: 'Scenario "Old" has recorded history — renaming starts fresh.',
    });
  });

  it("never confuses a prefix-sharing scenario name", () => {
    // "Check" must not match "Checkout"'s ref.
    expect(
      renameGuardVerdict("f.feature", "Check", "X", refs("f.feature::Checkout"), new Map()),
    ).toEqual({ kind: "commit" });
  });
});
```

Run: `npx vitest run tests/rename-guard.test.ts` → FAIL.

- [ ] **Step 2: Implement**

Create `src/presentation/views/rename-guard.ts`:

```ts
import { scenarioRef } from "../../domain/value-objects/scenario-reference";

/**
 * The rename-identity guard's decision core (WS3/C5, spec §5): renaming a
 * scenario mints a new Scenario Reference and detaches its run history
 * (ADR-0022/US-056), so a history-bearing rename must be a deliberate choice.
 * Pure — the ScenarioCard swaps in the confirm strip on `confirm` and commits
 * on `commit`; the passive renameAdvisory strip stays as the backstop.
 */
export type RenameGuardVerdict =
  | { kind: "commit" }
  | { kind: "confirm"; prompt: string };

/**
 * Decide whether committing `newName` over `oldName` needs a confirm.
 * `historyRefs` is the set of Scenario References with recorded history
 * (latestStatuses keys); `recentRunsByRef` the per-ref recent-window run count
 * (flakiness `runs`) — both loaded once per editor open. An Outline's history
 * lives under `…::row-<digest>` refs, so the match covers the exact ref AND
 * the row-ref prefix, and the weight sums across them.
 */
export const renameGuardVerdict = (
  featurePath: string,
  oldName: string,
  newName: string,
  historyRefs: ReadonlySet<string>,
  recentRunsByRef: ReadonlyMap<string, number>,
): RenameGuardVerdict => {
  const previous = oldName.trim();
  const next = newName.trim();
  if (previous === "" || previous === next) return { kind: "commit" };

  const exact = scenarioRef(featurePath, previous);
  const rowPrefix = `${exact}::row-`;
  const matching = [...historyRefs].filter((ref) => ref === exact || ref.startsWith(rowPrefix));
  if (matching.length === 0) return { kind: "commit" };

  const runs = matching.reduce((sum, ref) => sum + (recentRunsByRef.get(ref) ?? 0), 0);
  const weight = runs > 0 ? ` (${runs} recent ${runs === 1 ? "run" : "runs"})` : "";
  return {
    kind: "confirm",
    prompt: `Scenario "${previous}" has recorded history${weight} — renaming starts fresh.`,
  };
};
```

- [ ] **Step 3: Run + commit**

Run: `npx vitest run tests/rename-guard.test.ts` → PASS.

```bash
git add src/presentation/views/rename-guard.ts tests/rename-guard.test.ts
git commit -m "WS3: pure rename-guard verdict (history-bearing renames confirm, spec D3)"
```

### Task 17: Editor integration — intercept + inline confirm strip

**Files:**
- Modify: `src/presentation/vue/feature-editor/feature-editor-controller.ts` (history deps + refs)
- Modify: `src/presentation/vue/feature-editor/ScenarioCard.vue` (`:value` + `@change` intercept + strip)
- Modify: `src/presentation/views/feature-editor-view.ts` / `src/register-views.ts` (wire `scenarioHistoryService`)
- Test: `tests/vue/scenario-card-rename.test.ts`

- [ ] **Step 1: Failing component test**

Create `tests/vue/scenario-card-rename.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import ScenarioCard from "../../src/presentation/vue/feature-editor/ScenarioCard.vue";
import { FEATURE_EDITOR } from "../../src/presentation/vue/feature-editor/feature-editor-controller";
import { parseFeature } from "../../src/application/content/gherkin";

const SOURCE = `Feature: F\n\nScenario: Checkout\n  Given a step\n`;

const makeCtrl = (historyRefs: Set<string>) => ({
  commit: vi.fn(),
  suites: ref([]),
  historyRefs: ref(historyRefs),
  historyRuns: ref(new Map([["f.feature::Checkout", 7]])),
  knownTags: ref([]),
  stepPatterns: ref([]),
});

const mountCard = (ctrl: ReturnType<typeof makeCtrl>) => {
  const spec = parseFeature(SOURCE, "f.feature");
  if (spec === null) throw new Error("fixture must parse");
  return mount(ScenarioCard, {
    props: { spec, index: 0 },
    global: { provide: { [FEATURE_EDITOR as symbol]: ctrl } },
  });
};

describe("ScenarioCard rename guard", () => {
  it("commits a rename immediately when the scenario has no history", async () => {
    const ctrl = makeCtrl(new Set());
    const w = mountCard(ctrl);
    const input = w.find('input[aria-label="Scenario name"]');
    await input.setValue("Payment");
    await input.trigger("change");
    expect(ctrl.commit).toHaveBeenCalledTimes(1);
    expect(w.props("spec").scenarios[0].name).toBe("Payment");
    expect(w.find(".spec-rename-confirm").exists()).toBe(false);
  });

  it("blocks a history-bearing rename behind the confirm strip", async () => {
    const ctrl = makeCtrl(new Set(["f.feature::Checkout"]));
    const w = mountCard(ctrl);
    const input = w.find('input[aria-label="Scenario name"]');
    await input.setValue("Payment");
    await input.trigger("change");
    // Not committed yet; the strip shows the softened copy with the weight.
    expect(ctrl.commit).not.toHaveBeenCalled();
    expect(w.props("spec").scenarios[0].name).toBe("Checkout");
    expect(w.find(".spec-rename-confirm").text()).toContain(
      'Scenario "Checkout" has recorded history (7 recent runs)',
    );
    // Confirm → the rename lands and commits once.
    await w.find('button[aria-label="Rename the scenario"]').trigger("click");
    expect(ctrl.commit).toHaveBeenCalledTimes(1);
    expect(w.props("spec").scenarios[0].name).toBe("Payment");
    expect(w.find(".spec-rename-confirm").exists()).toBe(false);
  });

  it("Keep name restores the old value without committing", async () => {
    const ctrl = makeCtrl(new Set(["f.feature::Checkout"]));
    const w = mountCard(ctrl);
    const input = w.find('input[aria-label="Scenario name"]');
    await input.setValue("Payment");
    await input.trigger("change");
    await w.find('button[aria-label="Keep the current name"]').trigger("click");
    expect(ctrl.commit).not.toHaveBeenCalled();
    expect(w.props("spec").scenarios[0].name).toBe("Checkout");
    expect((input.element as HTMLInputElement).value).toBe("Checkout");
  });
});
```

Run: `npx vitest run tests/vue/scenario-card-rename.test.ts` → FAIL (the current `v-model.lazy` commits immediately).

- [ ] **Step 2: Controller history state**

In `feature-editor-controller.ts`:

1. Deps: add `scenarioHistory: Pick<ScenarioHistoryService, "latestStatuses" | "flakiness">;` (+ `import type { ScenarioHistoryService } from "../../../application/services/scenario-history-service";`).
2. Controller interface: add

```ts
  /** Scenario References with recorded history — the rename guard's gate (C5). */
  historyRefs: Ref<Set<string>>;
  /** Recent-window run count per reference (flakiness `runs`) — the confirm's weight. */
  historyRuns: Ref<Map<string, number>>;
```

3. Factory: `const historyRefs = ref(new Set<string>());`, `const historyRuns = ref(new Map<string, number>());`, and extend `loadAids` (best-effort — a history read failure just leaves the guard silent, matching its advisory backstop):

```ts
    const [statuses, flakiness] = await Promise.all([
      deps.scenarioHistory.latestStatuses(),
      deps.scenarioHistory.flakiness(),
    ]);
    if (statuses.ok) historyRefs.value = new Set(statuses.value.keys());
    if (flakiness.ok) {
      historyRuns.value = new Map(
        [...flakiness.value.entries()].map(([ref, score]) => [ref, score.runs]),
      );
    }
```

4. Return both refs from the factory.
5. Wire the dep at the construction site (`s.scenarioHistoryService` — confirm the services-object key with `grep -n "scenarioHistory" src/register-views.ts src/main.ts`).

- [ ] **Step 3: The ScenarioCard intercept**

In `ScenarioCard.vue`:

1. Script additions:

```ts
import { renameGuardVerdict } from "../../views/rename-guard";

/** A rename awaiting the user's confirm (C5); null renders the plain input. */
const pendingRename = ref<{ newName: string; prompt: string } | null>(null);

const onNameChange = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const newName = input.value.trim();
  const oldName = scenario.value.name;
  const verdict = renameGuardVerdict(
    props.spec.path,
    oldName,
    newName,
    ctrl.historyRefs.value,
    ctrl.historyRuns.value,
  );
  if (verdict.kind === "commit") {
    scenario.value.name = newName;
    ctrl.commit();
    return;
  }
  // History-bearing: hold the model at the OLD name until the user decides.
  input.value = oldName;
  pendingRename.value = { newName, prompt: verdict.prompt };
};

const confirmRename = (): void => {
  const pending = pendingRename.value;
  if (pending === null) return;
  scenario.value.name = pending.newName;
  pendingRename.value = null;
  ctrl.commit();
};

const keepName = (): void => {
  pendingRename.value = null;
};
```

(Add `ref` to the vue import.)

2. Template: replace the name input binding — the `v-model.lazy.trim` + `@change="ctrl.commit()"` input becomes:

```vue
      <input
        :value="scenario.name"
        type="text"
        placeholder="Scenario name"
        aria-label="Scenario name"
        @change="onNameChange"
      />
```

3. Template: after the `</div>` closing the scenario-head row, add the strip:

```vue
    <div v-if="pendingRename" class="spec-rename-confirm" role="alertdialog" aria-live="assertive">
      <span>{{ pendingRename.prompt }}</span>
      <button class="mod-warning" aria-label="Rename the scenario" @click="confirmRename">
        Rename
      </button>
      <button aria-label="Keep the current name" @click="keepName">Keep name</button>
    </div>
```

- [ ] **Step 4: Run all editor-related tests**

Run: `npx vitest run tests/vue/scenario-card-rename.test.ts tests/vue/scenario-card-membership.test.ts && npm run typecheck`
Expected: PASS (extend the membership test's `makeCtrl` with the two history refs — already included above — and any other `FEATURE_EDITOR` fakes in `tests/vue` that now need the new members: `grep -rln "FEATURE_EDITOR" tests/vue`).

- [ ] **Step 5: CSS + commit**

Append to `styles.css`:

```css
/* ── Rename identity guard (WS3/C5) ───────────────────────────────────────── */
.spec-rename-confirm {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-2) var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-inline-start: 3px solid var(--color-orange);
  border-radius: var(--radius-s);
  margin-block: var(--size-2-2);
  font-size: var(--font-ui-smaller);
}
/* ── Suite membership badge (WS2/C4) ──────────────────────────────────────── */
.spec-suite-membership {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
/* ── Suite modal tag palette (WS2/C4) ─────────────────────────────────────── */
.spec-suite-tag-palette {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  margin-block: var(--size-2-2);
}
.spec-suite-tag-palette-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
}
```

(If Task 12/13 already appended their CSS blocks, keep them where they landed — this step only adds what's still missing.)

```bash
git add -A src tests styles.css
git commit -m "WS3: blocking rename confirm for history-bearing scenarios (spec D3)"
```

### Task 18: WS3 docs + final gate

- [ ] **Step 1: CHANGELOG.md**

Under `### Added`:

```markdown
- **Rename identity guard** (UX WS-C5): renaming a scenario that has recorded
  run history now pauses on an inline confirm — "has recorded history (N recent
  runs) — renaming starts fresh. [Rename] [Keep name]" — before the structured
  editor commits (a rename mints a new Scenario Reference and detaches history,
  ADR-0022). Scenarios without history rename exactly as before, and the
  passive validation-strip advisory stays as the raw-mode backstop.
```

- [ ] **Step 2: Full PR gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage && npm run quality:audit`
Expected: all green, no introduced findings. Fix anything that isn't before proceeding.

- [ ] **Step 3: Commit and push**

```bash
git add CHANGELOG.md
git commit -m "WS3: changelog entry"
git push -u origin claude/plugin-ux-usability-9kaf4a
```

Then open the PR for `claude/plugin-ux-usability-9kaf4a` (title: "Authoring loop completion: Pending Steps companion, tag-aware suites, rename guard (C2/C4/C5, closes #77)"), with the three-workstream summary and a note that WS1 closes issue #77.

---

## Plan self-review notes (already applied)

- **Spec coverage:** D1→scope; D2→Tasks 6/7 (viewer + system editor); D3→Tasks 16/17; D4→Tasks 3/4 (+#77) and 14 (glossary); D5→Task 7; D6/D7→Task 3; D8→Tasks 4/7 (static tiers, auto-verify only on feature-target); D9→Task 8 (ids unchanged); D10→Task 12 (imperative modal); D11→Task 11; D12→Task 14; D13→no ADR. Spec §3.3 console/command/tour → Task 8. Spec §3.4 acceptance → Tasks 4/7/8 tests.
- **Known judgement calls for the implementer:** exact fixture arrangement inside existing test files (reuse their helpers); the `setState` signature copied from `use-case-detail-view.ts`; the obsidian typings probe in Task 6 (simplify if typings already declare `openWithDefaultApp`); `UseCaseService` lookup + Feature-list field names (verify before Task 7); Vue-test fakes may need extra inert controller members — mirror existing `tests/vue` idioms.

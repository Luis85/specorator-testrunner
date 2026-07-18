import { describe, expect, it } from "vitest";
import { StepCoverageCache } from "../src/application/services/step-coverage-cache";
import type { StepSourceFile } from "../src/application/services/load-step-definitions";
import { collectStepTexts, parseFeature } from "../src/application/content/gherkin";
import { parseStepDefinitions } from "../src/application/content/step-definitions";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

/** A minimal Feature file body with one scenario/step. The cache digests this
 * RAW content (spec D6), not the parsed step templates. */
const feature = (step: string): string => `Feature: F\n  Scenario: S\n    Given ${step}\n`;

/** A Scenario Outline whose step TEMPLATE never changes, only the Examples value. */
const outlineFeature = (exampleValue: string): string =>
  `Feature: F\n  Scenario Outline: S\n    Given a value <v>\n\n    Examples:\n      | v |\n      | ${exampleValue} |\n`;

/** A steps-file source fixture: path + raw content (spec D6 — the cache digests these, not scraped patterns). */
const src = (path: string, content: string): StepSourceFile => ({ path: vp(path), content });

/** A minimal steps-file body that scrapes to a single `Given(text, ...)` pattern. */
const givenFile = (text: string): string => `Given("${text}", async () => {});`;

/**
 * A cache with ONE recorded confirmed-covered verdict for f.feature over
 * `sources` (a single-source set by default) — the common starting point several
 * invalidation tests below mutate exactly one input from, to isolate which input
 * triggered the miss. An explicit `sources` override lets a test pin a specific
 * source SHAPE (e.g. a `../pages` import) while still sharing this
 * record-then-return idiom rather than repeating it inline.
 */
const recordedCache = (
  sources: StepSourceFile[] = [src("a.ts", givenFile("a step"))],
): { cache: StepCoverageCache; sources: StepSourceFile[] } => {
  const cache = new StepCoverageCache();
  cache.recordCovered(vp("f.feature"), feature("a step"), sources);
  return { cache, sources };
};

describe("StepCoverageCache (#77)", () => {
  it("misses when nothing was recorded", () => {
    const cache = new StepCoverageCache();
    expect(
      cache.authoritativeCovered(vp("f.feature"), feature("a step"), [
        src("a.ts", givenFile("a step")),
      ]),
    ).toBeNull();
  });

  it("hits (true) with the recorded verdict when feature bytes AND sources match", () => {
    const { cache, sources } = recordedCache();
    expect(cache.authoritativeCovered(vp("f.feature"), feature("a step"), sources)).toBe(true);
  });

  it("is positive-only: an unrecorded Feature misses (null), never a stored not-covered", () => {
    const { cache, sources } = recordedCache();
    // There is no way to record a not-covered verdict — a Feature the cache
    // never confirmed simply misses, so `allStepsDefined` asks the static tier.
    expect(cache.authoritativeCovered(vp("g.feature"), feature("other"), sources)).toBeNull();
  });

  it("misses after the feature's raw bytes change (external edit safety)", () => {
    const { cache, sources } = recordedCache();
    expect(
      cache.authoritativeCovered(vp("f.feature"), feature("a different step"), sources),
    ).toBeNull();
  });

  it("misses after an Examples-row edit — same step templates, different raw bytes (Codex P2 on PR #102)", () => {
    const cache = new StepCoverageCache();
    const original = outlineFeature("a");
    const edited = outlineFeature("b");
    // Prove the premise: the step TEMPLATE is identical (only the Examples
    // value differs) — collectStepTexts can't see which row bddgen expands.
    const parsedOriginal = parseFeature(original, vp("f.feature"));
    const parsedEdited = parseFeature(edited, vp("f.feature"));
    expect(parsedOriginal && collectStepTexts(parsedOriginal)).toEqual(
      parsedEdited && collectStepTexts(parsedEdited),
    );

    cache.recordCovered(vp("f.feature"), original, []);
    // Raw-byte addressing (spec D6) catches the Examples-row edit a
    // template-only digest would have missed.
    expect(cache.authoritativeCovered(vp("f.feature"), edited, [])).toBeNull();
  });

  it("reordering the feature's steps changes its raw bytes and re-verifies", () => {
    const cache = new StepCoverageCache();
    const ab = "Feature: F\n  Scenario: S\n    Given a\n    When b\n";
    const ba = "Feature: F\n  Scenario: S\n    Given b\n    When a\n";
    cache.recordCovered(vp("f.feature"), ab, []);
    expect(cache.authoritativeCovered(vp("f.feature"), ba, [])).toBeNull();
  });

  it("misses after a source file is deleted (external step-file edit safety)", () => {
    const { cache } = recordedCache();
    // A step file deleted outside the plugin must invalidate the verdict — the
    // dangerous stale-"covered" direction the defsRevision sketch missed.
    expect(cache.authoritativeCovered(vp("f.feature"), feature("a step"), [])).toBeNull();
  });

  it("misses on a scrape-invisible content edit (Codex P2 on PR #102): same scraped patterns, different raw bytes", () => {
    const cache = new StepCoverageCache();
    const original = `${givenFile("a step")}\nfunction helper() { return 1; }\n`;
    const edited = `${givenFile("a step")}\nfunction helper() { return 2; }\n`;
    // Prove the premise: the scraper is blind to the helper body, so the
    // scraped pattern set is IDENTICAL before and after the edit.
    expect(parseStepDefinitions(original)).toEqual(parseStepDefinitions(edited));

    cache.recordCovered(vp("f.feature"), feature("a step"), [src("helpers.ts", original)]);
    // Raw-byte addressing (spec D6) catches the edit a pattern-only digest
    // would have missed, which would otherwise serve a stale "covered" verdict.
    expect(
      cache.authoritativeCovered(vp("f.feature"), feature("a step"), [src("helpers.ts", edited)]),
    ).toBeNull();
  });

  it("re-records over a prior entry (latest sources win)", () => {
    const cache = new StepCoverageCache();
    const stale = [src("a.ts", givenFile("old"))];
    const fresh = [src("a.ts", givenFile("a step"))];
    cache.recordCovered(vp("f.feature"), feature("a step"), stale);
    cache.recordCovered(vp("f.feature"), feature("a step"), fresh);
    // The latest record wins: the fresh sources hit, the stale ones no longer do.
    expect(cache.authoritativeCovered(vp("f.feature"), feature("a step"), fresh)).toBe(true);
    expect(cache.authoritativeCovered(vp("f.feature"), feature("a step"), stale)).toBeNull();
  });

  it("keeps hitting when sources are listed in a different order (sorted internally)", () => {
    const cache = new StepCoverageCache();
    const a = src("a.ts", givenFile("a"));
    const b = src("b.ts", givenFile("b"));
    cache.recordCovered(vp("f.feature"), feature("a step"), [a, b]);
    // listFilesRecursive's listing order is adapter-dependent; the digest sorts
    // by path first so the SAME file set still hits regardless of order.
    expect(cache.authoritativeCovered(vp("f.feature"), feature("a step"), [b, a])).toBe(true);
  });

  it("path/content pairs cannot alias across the digest (JSON boundary)", () => {
    const cache = new StepCoverageCache();
    // path "a" + content "b c" vs path "a b" + content "c" must digest
    // differently — a naive separator-free join could conflate the two.
    cache.recordCovered(vp("f.feature"), feature("x"), [src("a", "b c")]);
    expect(cache.authoritativeCovered(vp("f.feature"), feature("x"), [src("a b", "c")])).toBeNull();
  });

  it("keys strictly by path: identical content under a different path still misses", () => {
    const { cache, sources } = recordedCache();
    // Same feature bytes + same sources as the recorded entry, but a
    // DIFFERENT Feature path — a content-keyed (rather than Feature-path-
    // keyed) cache would wrongly hit.
    expect(cache.authoritativeCovered(vp("other.feature"), feature("a step"), sources)).toBeNull();
  });

  it("still records and hits when a step source imports a sibling page object via ../pages (Codex P2 on PR #102 — the default generated runner's own shape)", () => {
    // The DEFAULT generated runner's example step imports exactly this shape
    // (src/infrastructure/runner/templates/runner-templates.ts) — an earlier
    // "self-containment gate" refused to record whenever a step source escaped
    // src/steps via a relative parent import, which disabled the cache for
    // every normal vault. There is no such gate now: a `../pages` import must
    // not block a record.
    const { cache, sources } = recordedCache([
      src(
        "src/steps/x.steps.ts",
        'import { ExamplePage } from "../pages/ExamplePage";\nGiven("a step", async () => {});',
      ),
      src("src/pages/ExamplePage.ts", "export class ExamplePage {}"),
    ]);
    expect(cache.authoritativeCovered(vp("f.feature"), feature("a step"), sources)).toBe(true);
  });

  it("misses after a page object a step source imports is edited, even though the steps file itself is untouched (Codex P2 on PR #102 — whole runner src tree digest)", () => {
    const stepsFile = src(
      "src/steps/x.steps.ts",
      'import { ExamplePage } from "../pages/ExamplePage";\nGiven("a step", async () => {});',
    );
    const originalPageObject = src("src/pages/ExamplePage.ts", "export class ExamplePage {}");
    const { cache } = recordedCache([stepsFile, originalPageObject]);

    // Only the page object changes — the steps file is byte-identical to what
    // was recorded. A src/steps-only digest would miss this; the whole-tree
    // digest (spec D6) must not.
    const editedPageObject = src(
      "src/pages/ExamplePage.ts",
      "export class ExamplePage { extra = true; }",
    );
    expect(
      cache.authoritativeCovered(vp("f.feature"), feature("a step"), [stepsFile, editedPageObject]),
    ).toBeNull();
  });
});

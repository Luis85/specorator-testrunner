import { describe, expect, it } from "vitest";
import { StepCoverageCache } from "../src/application/services/step-coverage-cache";
import type { StepSourceFile } from "../src/application/services/load-step-definitions";
import { parseStepDefinitions } from "../src/application/content/step-definitions";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

/** A steps-file source fixture: path + raw content (spec D6 — the cache digests these, not scraped patterns). */
const src = (path: string, content: string): StepSourceFile => ({ path: vp(path), content });

/** A minimal steps-file body that scrapes to a single `Given(text, ...)` pattern. */
const givenFile = (text: string): string => `Given("${text}", async () => {});`;

/**
 * A cache with ONE recorded true verdict for f.feature over a single-source
 * `sources` set — the common starting point several invalidation tests below
 * mutate exactly one input from, to isolate which input triggered the miss.
 */
const recordedCache = (): { cache: StepCoverageCache; sources: StepSourceFile[] } => {
  const cache = new StepCoverageCache();
  const sources = [src("a.ts", givenFile("a step"))];
  cache.record(vp("f.feature"), ["a step"], sources, true);
  return { cache, sources };
};

describe("StepCoverageCache (#77)", () => {
  it("misses when nothing was recorded", () => {
    const cache = new StepCoverageCache();
    expect(
      cache.authoritativeCovered(vp("f.feature"), ["a step"], [src("a.ts", givenFile("a step"))]),
    ).toBeNull();
  });

  it("hits with the recorded verdict when feature steps AND sources match", () => {
    const { cache, sources } = recordedCache();
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], sources)).toBe(true);
    cache.record(vp("g.feature"), ["other"], sources, false);
    expect(cache.authoritativeCovered(vp("g.feature"), ["other"], sources)).toBe(false);
  });

  it("misses after the feature's steps change (external edit safety)", () => {
    const { cache, sources } = recordedCache();
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step", "new"], sources)).toBeNull();
  });

  it("misses after a source file is deleted (external step-file edit safety)", () => {
    const { cache } = recordedCache();
    // A step file deleted outside the plugin must invalidate the verdict — the
    // dangerous stale-"covered" direction the defsRevision sketch missed.
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], [])).toBeNull();
  });

  it("misses on a scrape-invisible content edit (Codex P2 on PR #102): same scraped patterns, different raw bytes", () => {
    const cache = new StepCoverageCache();
    const original = `${givenFile("a step")}\nfunction helper() { return 1; }\n`;
    const edited = `${givenFile("a step")}\nfunction helper() { return 2; }\n`;
    // Prove the premise: the scraper is blind to the helper body, so the
    // scraped pattern set is IDENTICAL before and after the edit.
    expect(parseStepDefinitions(original)).toEqual(parseStepDefinitions(edited));

    cache.record(vp("f.feature"), ["a step"], [src("helpers.ts", original)], true);
    // Raw-byte addressing (spec D6) catches the edit a pattern-only digest
    // would have missed, which would otherwise serve a stale "covered" verdict.
    expect(
      cache.authoritativeCovered(vp("f.feature"), ["a step"], [src("helpers.ts", edited)]),
    ).toBeNull();
  });

  it("re-records over a prior entry", () => {
    const cache = new StepCoverageCache();
    cache.record(vp("f.feature"), ["a step"], [], false);
    const sources = [src("a.ts", givenFile("a step"))];
    cache.record(vp("f.feature"), ["a step"], sources, true);
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], sources)).toBe(true);
  });

  it("step ORDER matters (a reordered feature re-verifies)", () => {
    const cache = new StepCoverageCache();
    const sources = [src("a.ts", givenFile("a step"))];
    cache.record(vp("f.feature"), ["a", "b"], sources, true);
    expect(cache.authoritativeCovered(vp("f.feature"), ["b", "a"], sources)).toBeNull();
  });

  it("keeps hitting when sources are listed in a different order (sorted internally)", () => {
    const cache = new StepCoverageCache();
    const a = src("a.ts", givenFile("a"));
    const b = src("b.ts", givenFile("b"));
    cache.record(vp("f.feature"), ["a step"], [a, b], true);
    // listFilesRecursive's listing order is adapter-dependent; the digest sorts
    // by path first so the SAME file set still hits regardless of order.
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], [b, a])).toBe(true);
  });

  it("path/content pairs cannot alias across the digest (JSON boundary)", () => {
    const cache = new StepCoverageCache();
    // path "a" + content "b c" vs path "a b" + content "c" must digest
    // differently — a naive separator-free join could conflate the two.
    cache.record(vp("f.feature"), ["x"], [src("a", "b c")], true);
    expect(cache.authoritativeCovered(vp("f.feature"), ["x"], [src("a b", "c")])).toBeNull();
  });

  it("keys strictly by path: identical content under a different path still misses", () => {
    const { cache, sources } = recordedCache();
    // Same stepTexts + same sources as the recorded entry, but a DIFFERENT
    // Feature path — a content-keyed (rather than Feature-path-keyed) cache
    // would wrongly hit.
    expect(cache.authoritativeCovered(vp("other.feature"), ["a step"], sources)).toBeNull();
  });
});

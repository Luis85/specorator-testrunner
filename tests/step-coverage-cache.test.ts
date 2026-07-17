import { describe, expect, it } from "vitest";
import { StepCoverageCache } from "../src/application/services/step-coverage-cache";
import type { StepDefinitionPattern } from "../src/application/content/step-definitions";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const defs = (...sources: string[]): StepDefinitionPattern[] =>
  sources.map((source) => ({ kind: "expression", source }));

describe("StepCoverageCache (#77)", () => {
  it("misses when nothing was recorded", () => {
    const cache = new StepCoverageCache();
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], defs("a step"))).toBeNull();
  });

  it("hits with the recorded verdict when feature steps AND definitions match", () => {
    const cache = new StepCoverageCache();
    cache.record(vp("f.feature"), ["a step"], defs("a step"), true);
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], defs("a step"))).toBe(true);
    cache.record(vp("g.feature"), ["other"], defs("a step"), false);
    expect(cache.authoritativeCovered(vp("g.feature"), ["other"], defs("a step"))).toBe(false);
  });

  it("misses after the feature's steps change (external edit safety)", () => {
    const cache = new StepCoverageCache();
    cache.record(vp("f.feature"), ["a step"], defs("a step"), true);
    expect(
      cache.authoritativeCovered(vp("f.feature"), ["a step", "new"], defs("a step")),
    ).toBeNull();
  });

  it("misses after the definition set changes (external step-file edit safety)", () => {
    const cache = new StepCoverageCache();
    cache.record(vp("f.feature"), ["a step"], defs("a step"), true);
    // A definition deleted outside the plugin must invalidate the verdict —
    // the dangerous stale-"covered" direction the defsRevision sketch missed.
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], [])).toBeNull();
    // Flags/kind participate in the digest too.
    const regex: StepDefinitionPattern[] = [{ kind: "regex", source: "a step", flags: "i" }];
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], regex)).toBeNull();
  });

  it("re-records over a prior entry", () => {
    const cache = new StepCoverageCache();
    cache.record(vp("f.feature"), ["a step"], defs(), false);
    cache.record(vp("f.feature"), ["a step"], defs("a step"), true);
    expect(cache.authoritativeCovered(vp("f.feature"), ["a step"], defs("a step"))).toBe(true);
  });

  it("step ORDER matters (a reordered feature re-verifies)", () => {
    const cache = new StepCoverageCache();
    cache.record(vp("f.feature"), ["a", "b"], defs("a", "b"), true);
    expect(cache.authoritativeCovered(vp("f.feature"), ["b", "a"], defs("a", "b"))).toBeNull();
  });

  it("pattern fields cannot alias across the digest (source/flags boundary)", () => {
    const cache = new StepCoverageCache();
    // source "a b" + no flags vs source "a" + flags "b" must digest differently.
    cache.record(vp("f.feature"), ["x"], [{ kind: "expression", source: "a b" }], true);
    expect(
      cache.authoritativeCovered(
        vp("f.feature"),
        ["x"],
        [{ kind: "expression", source: "a", flags: "b" }],
      ),
    ).toBeNull();
  });

  it("keys strictly by path: identical content under a different path still misses", () => {
    const cache = new StepCoverageCache();
    cache.record(vp("f.feature"), ["a step"], defs("a step"), true);
    // Same stepTexts + same definitions as the recorded entry, but a DIFFERENT
    // path — a content-keyed (rather than path-keyed) cache would wrongly hit.
    expect(cache.authoritativeCovered(vp("other.feature"), ["a step"], defs("a step"))).toBeNull();
  });
});

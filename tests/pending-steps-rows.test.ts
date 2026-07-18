import { describe, expect, it } from "vitest";
import {
  pendingStepsTargetForRun,
  projectPendingFeature,
  readPersistedPendingStepsTarget,
} from "../src/presentation/views/pending-steps-rows";
import type { StepDefinitionPattern } from "../src/application/content/step-definitions";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";

const defs = (...sources: string[]): StepDefinitionPattern[] =>
  sources.map((source) => ({ kind: "expression", source }));

describe("projectPendingFeature", () => {
  it("projects the static tier: missing list, counts, progress text", () => {
    const group = projectPendingFeature(
      unsafeVaultPath("Specifications/features/UC-001-happy-path.feature"),
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
    const group = projectPendingFeature(unsafeVaultPath("f.feature"), ["a", "b"], defs(), ["b"]);
    expect(group.tier).toBe("bddgen");
    expect(group.missing).toEqual(["b"]);
    expect(group.definedSteps).toBe(1);
    expect(group.complete).toBe(false);
  });

  it("is complete when bddgen reports nothing missing", () => {
    const group = projectPendingFeature(unsafeVaultPath("f.feature"), ["a"], defs(), []);
    expect(group.complete).toBe(true);
    expect(group.progressText).toBe("1 of 1 steps defined");
  });

  it("a step-less feature is never complete", () => {
    expect(projectPendingFeature(unsafeVaultPath("f.feature"), [], defs(), null).complete).toBe(
      false,
    );
  });

  it("counts repeated step texts per occurrence and dedupes missing first-seen", () => {
    const group = projectPendingFeature(
      unsafeVaultPath("f.feature"),
      ["a", "a", "b"],
      defs("b"),
      null,
    );
    expect(group).toMatchObject({ totalSteps: 3, definedSteps: 1, missing: ["a"] });
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
    // Pins the smart-constructor rejection branch: a hand-edited/sync-
    // corrupted workspace.json carrying an unsafe featurePath (here, an
    // escape via "..") must fall back to null, not a branded-but-unsafe path.
    expect(
      readPersistedPendingStepsTarget({ target: { kind: "feature", featurePath: "../escape" } }),
    ).toBeNull();
  });
});

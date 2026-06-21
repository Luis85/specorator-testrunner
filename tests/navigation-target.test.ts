import { describe, expect, it } from "vitest";
import {
  artifactTarget,
  evidenceTarget,
  featureTarget,
  runTarget,
  suiteTarget,
} from "../src/presentation/navigation/navigation-target";
import type { VaultPath } from "../src/domain/value-objects/identifiers";

const path = (p: string): VaultPath => p as unknown as VaultPath;

describe("navigation-target constructors", () => {
  it("builds an artifact (id) target", () => {
    expect(artifactTarget("UC-021")).toEqual({ kind: "artifact", id: "UC-021" });
  });

  it("builds feature/suite/evidence (path) targets", () => {
    expect(featureTarget(path("a.feature"))).toEqual({ kind: "feature", path: path("a.feature") });
    expect(suiteTarget(path("Smoke.md"))).toEqual({ kind: "suite", path: path("Smoke.md") });
    expect(evidenceTarget(path("ev.md"))).toEqual({ kind: "evidence", path: path("ev.md") });
  });

  it("builds a run (id) target", () => {
    expect(runTarget("RUN-001")).toEqual({ kind: "run", runId: "RUN-001" });
  });
});

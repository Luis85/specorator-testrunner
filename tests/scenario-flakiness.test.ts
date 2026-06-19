import { describe, expect, it } from "vitest";
import {
  computeFlakiness,
  FLAKY_SCORE,
  type ScenarioFlakiness,
} from "../src/domain/policies/scenario-flakiness";
import type { ScenarioLatestStatus } from "../src/domain/policies/use-case-automation-policy";

const seq = (...statuses: ScenarioLatestStatus[]): ScenarioLatestStatus[] => statuses;

describe("computeFlakiness", () => {
  it("treats an empty window as unknown with a zero score", () => {
    expect(computeFlakiness(seq())).toEqual<ScenarioFlakiness>({
      runs: 0,
      transitions: 0,
      flips: 0,
      score: 0,
      band: "unknown",
    });
  });

  it("treats a single pass/fail result as unknown (cannot judge flakiness)", () => {
    expect(computeFlakiness(seq("passed"))).toMatchObject({ runs: 1, band: "unknown", score: 0 });
    expect(computeFlakiness(seq("failed"))).toMatchObject({ runs: 1, band: "unknown", score: 0 });
  });

  it("classifies an all-passed window as stable", () => {
    expect(computeFlakiness(seq("passed", "passed", "passed"))).toMatchObject({
      runs: 3,
      transitions: 2,
      flips: 0,
      score: 0,
      band: "stable",
    });
  });

  it("classifies an all-failed window as stable (steadily red is not flaky)", () => {
    expect(computeFlakiness(seq("failed", "failed"))).toMatchObject({
      flips: 0,
      score: 0,
      band: "stable",
    });
  });

  it("classifies a strictly alternating window as maximally flaky", () => {
    expect(computeFlakiness(seq("passed", "failed", "passed", "failed"))).toMatchObject({
      runs: 4,
      transitions: 3,
      flips: 3,
      score: 1,
      band: "flaky",
    });
  });

  it("classifies a single flip in a long stable window as suspect with a low score", () => {
    // P P P P P F over 6 results: 1 flip / 5 transitions = 0.2 < FLAKY_SCORE.
    const result = computeFlakiness(
      seq("passed", "passed", "passed", "passed", "passed", "failed"),
    );
    expect(result.flips).toBe(1);
    expect(result.score).toBeCloseTo(0.2);
    expect(result.score).toBeLessThan(FLAKY_SCORE);
    expect(result.band).toBe("suspect");
  });

  it("drops skipped results: they neither flip nor stabilise", () => {
    // The pass/fail subsequence is P F → 1 flip over 1 transition = flaky.
    expect(computeFlakiness(seq("passed", "skipped", "skipped", "failed"))).toMatchObject({
      runs: 2,
      transitions: 1,
      flips: 1,
      score: 1,
      band: "flaky",
    });
  });

  it("treats an all-skipped window as unknown", () => {
    expect(computeFlakiness(seq("skipped", "skipped"))).toMatchObject({
      runs: 0,
      band: "unknown",
    });
  });

  it("counts flips reversal-invariantly (window order does not change the score)", () => {
    const forward = computeFlakiness(seq("passed", "passed", "failed"));
    const reversed = computeFlakiness(seq("failed", "passed", "passed"));
    expect(reversed.score).toBe(forward.score);
    expect(reversed.flips).toBe(forward.flips);
    expect(reversed.band).toBe(forward.band);
  });

  it("classifies exactly at the flaky threshold as flaky", () => {
    // P F P: 2 flips / 2 transitions = 1.0 — comfortably flaky.
    // P P F P: 2 flips / 3 transitions ≈ 0.67 >= 0.5 — flaky.
    expect(computeFlakiness(seq("passed", "passed", "failed", "passed")).band).toBe("flaky");
  });
});

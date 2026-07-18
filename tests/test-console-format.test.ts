import { describe, expect, it } from "vitest";
import {
  extractRunSummary,
  formatElapsed,
  formatOutputLine,
  formatStatusBanner,
  summaryHint,
} from "../src/presentation/views/test-console-format";

describe("test-console-format", () => {
  it("passes stdout lines through unchanged", () => {
    expect(formatOutputLine("stdout", "Running tests")).toBe("Running tests");
  });

  it("prefixes stderr lines so they are visually distinct", () => {
    expect(formatOutputLine("stderr", "boom")).toBe("[stderr] boom");
  });

  it("renders a terminal banner with a one-decimal duration", () => {
    expect(formatStatusBanner("passed", 1500)).toBe("Run passed (1.5s)");
    expect(formatStatusBanner("failed", 2000)).toBe("Run failed (2.0s)");
    expect(formatStatusBanner("errored", 500)).toBe("Run errored (0.5s)");
    expect(formatStatusBanner("cancelled", 3000)).toBe("Run cancelled (3.0s)");
  });

  it("omits the duration suffix when unknown", () => {
    expect(formatStatusBanner("passed")).toBe("Run passed");
  });

  it("renders in-progress and queued banners", () => {
    expect(formatStatusBanner("running")).toBe("Run in progress…");
    expect(formatStatusBanner("queued")).toBe("Run queued");
  });

  it("formats elapsed time as mm:ss, padded", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(9_000)).toBe("00:09");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(600_000)).toBe("10:00");
  });

  it("floors partial seconds and clamps negatives to zero", () => {
    expect(formatElapsed(1_999)).toBe("00:01");
    expect(formatElapsed(-500)).toBe("00:00");
  });

  it("does not cap minutes at 60 for long runs", () => {
    expect(formatElapsed(75 * 60_000 + 9_000)).toBe("75:09");
  });
});

describe("extractRunSummary / summaryHint (playwright-bdd live console)", () => {
  it("recognizes Playwright's list-reporter summary counts and nothing else", () => {
    expect(extractRunSummary("1 passed (2.0s)")).toBe("1 passed (2.0s)");
    expect(extractRunSummary("  3 failed  ")).toBe("3 failed");
    expect(extractRunSummary("2 flaky")).toBe("2 flaky");
    expect(extractRunSummary("5 skipped")).toBe("5 skipped");
    expect(extractRunSummary("1 interrupted")).toBe("1 interrupted");
    expect(extractRunSummary("4 did not run")).toBe("4 did not run");
    expect(extractRunSummary("Running 3 tests using 2 workers")).toBeNull();
    expect(extractRunSummary("✓  1 [chromium] › UC-001.feature:3:1 › Demo (1.2s)")).toBeNull();
    expect(extractRunSummary("> playwright test")).toBeNull();
  });

  it("surfaces playwright-bdd's missing-step header so the banner shows it", () => {
    expect(extractRunSummary("Missing step definitions: 2")).toBe("Missing step definitions: 2");
    expect(extractRunSummary("  Missing step definitions: 1  ")).toBe(
      "Missing step definitions: 1",
    );
  });

  it("hints at the step-definition flow only when steps are missing", () => {
    expect(summaryHint(["Missing step definitions: 2", "1 failed"])).toBe(
      "Some steps have no step definition — open Pending Steps to generate and implement them.",
    );
    expect(summaryHint(["1 failed", "2 passed (3.0s)"])).toBeNull();
    expect(summaryHint(["Missing step definitions: 0"])).toBeNull();
    expect(summaryHint([])).toBeNull();
  });
});

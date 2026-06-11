import { describe, expect, it } from "vitest";
import {
  extractCucumberSummary,
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

describe("extractCucumberSummary / summaryHint (testvault demo-run feedback)", () => {
  it("recognizes Cucumber's end-of-run summary lines and nothing else", () => {
    expect(extractCucumberSummary("1 scenario (1 undefined)")).toBe("1 scenario (1 undefined)");
    expect(extractCucumberSummary("  3 steps (1 failed, 2 skipped)  ")).toBe(
      "3 steps (1 failed, 2 skipped)",
    );
    expect(extractCucumberSummary("12 scenarios (12 passed)")).toBe("12 scenarios (12 passed)");
    expect(extractCucumberSummary("Failures:")).toBeNull();
    expect(extractCucumberSummary("0m00.005s (executing steps: 0m00.000s)")).toBeNull();
    expect(extractCucumberSummary("> node --import tsx …")).toBeNull();
  });

  it("hints at the step-definition flow only when steps were undefined", () => {
    expect(summaryHint(["1 scenario (1 undefined)", "3 steps (3 undefined)"])).toContain(
      "Generate step definitions",
    );
    expect(summaryHint(["1 scenario (1 failed)", "3 steps (1 failed, 2 skipped)"])).toBeNull();
    expect(summaryHint([])).toBeNull();
  });
});

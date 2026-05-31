import { describe, expect, it } from "vitest";
import {
  formatOutputLine,
  formatStatusBanner,
  statusModifier,
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

  it("uses the status as the CSS modifier", () => {
    expect(statusModifier("failed")).toBe("failed");
  });
});

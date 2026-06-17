import { describe, expect, it } from "vitest";
import { importReportNotice } from "../src/presentation/commands/register-run-commands";

describe("importReportNotice", () => {
  it("imported → names the evidence path", () => {
    expect(importReportNotice({ kind: "imported", evidencePath: "Test Evidence/RUN-1.md" })).toBe(
      "Evidence written to Test Evidence/RUN-1.md",
    );
  });

  it("recorded → notes evidence Markdown is disabled", () => {
    expect(importReportNotice({ kind: "recorded" })).toContain(
      "evidence Markdown generation is disabled",
    );
  });

  it("no-run → nothing to import yet", () => {
    expect(importReportNotice({ kind: "no-run" })).toBe("No Test Run to import a report for yet.");
  });

  it("no-report → run finished without a report", () => {
    expect(importReportNotice({ kind: "no-report" })).toContain("no report to import");
  });

  it("run-in-progress → defers to after the run finishes", () => {
    expect(importReportNotice({ kind: "run-in-progress", activeRunId: "RUN-1" })).toContain(
      "in progress",
    );
  });

  it("ineligible → names the run status", () => {
    expect(importReportNotice({ kind: "ineligible", status: "errored" })).toBe(
      "The last run (errored) produced no report to import.",
    );
  });
});

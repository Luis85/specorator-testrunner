import { describe, expect, it } from "vitest";
import {
  parseScenarioEvidenceBlock,
  renderScenarioEvidenceBlock,
  SCENARIO_BLOCK_FENCE,
  type ScenarioEvidenceEntry,
} from "../src/application/content/scenario-evidence-block";

describe("scenario-evidence-block (US-057 minimal US-060 slice)", () => {
  const entries: ScenarioEvidenceEntry[] = [
    { ref: "Specifications/features/UC-001.feature::Login", status: "passed", durationMs: 12 },
    { ref: "Specifications/features/UC-001.feature::Logout", status: "failed" },
  ];

  it("renders a fenced testrunner-scenarios block", () => {
    const block = renderScenarioEvidenceBlock(entries);
    expect(block.startsWith("```" + SCENARIO_BLOCK_FENCE)).toBe(true);
    expect(block.trimEnd().endsWith("```")).toBe(true);
  });

  it("renders nothing for an empty set (block omitted)", () => {
    expect(renderScenarioEvidenceBlock([])).toBe("");
  });

  it("round-trips render → parse, preserving ref/status/durationMs", () => {
    const note = `# Evidence\n\n## Scenarios\n\n${renderScenarioEvidenceBlock(entries)}\n\n## Artifacts\n`;
    expect(parseScenarioEvidenceBlock(note)).toEqual(entries);
  });

  it("omits durationMs when absent rather than emitting undefined", () => {
    const parsed = parseScenarioEvidenceBlock(renderScenarioEvidenceBlock(entries));
    expect(parsed[1]).toEqual({
      ref: "Specifications/features/UC-001.feature::Logout",
      status: "failed",
    });
    expect("durationMs" in parsed[1]).toBe(false);
  });

  it("returns [] when no block is present", () => {
    expect(parseScenarioEvidenceBlock("# Just a note\n\nno block here")).toEqual([]);
  });

  it("returns [] for malformed JSON inside the fence (degrades, never throws)", () => {
    const note = "```" + SCENARIO_BLOCK_FENCE + "\n{ not json ]\n```";
    expect(parseScenarioEvidenceBlock(note)).toEqual([]);
  });

  it("drops entries missing a ref or with an invalid status", () => {
    const note =
      "```" +
      SCENARIO_BLOCK_FENCE +
      "\n" +
      JSON.stringify([
        { ref: "a::b", status: "passed" },
        { status: "passed" }, // no ref
        { ref: "c::d", status: "exploded" }, // bad status
        { ref: "e::f", status: "skipped" },
      ]) +
      "\n```";
    expect(parseScenarioEvidenceBlock(note)).toEqual([
      { ref: "a::b", status: "passed" },
      { ref: "e::f", status: "skipped" },
    ]);
  });

  it("tolerates CRLF line endings", () => {
    const note = (
      "```" +
      SCENARIO_BLOCK_FENCE +
      '\n[{"ref":"a::b","status":"passed"}]\n```'
    ).replace(/\n/g, "\r\n");
    expect(parseScenarioEvidenceBlock(note)).toEqual([{ ref: "a::b", status: "passed" }]);
  });
});

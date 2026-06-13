/**
 * Shared Cucumber JSON report fixtures and assertion helpers reused by both
 * the parser unit tests and the report-import-service integration tests.
 */
import { expect } from "vitest";
import type { EvidenceArtifact } from "../src/domain/entities/evidence";

/**
 * A representative Cucumber-JS JSON report: one passed scenario, one failed
 * (with an error_message + an image embedding), one all-skipped, one undefined
 * step (exits non-zero → failed), and a background element that must be ignored.
 */
export const REPRESENTATIVE_REPORT = JSON.stringify([
  {
    name: "Checkout",
    uri: "features/UC-001-checkout.feature",
    elements: [
      {
        name: "Successful checkout",
        type: "scenario",
        steps: [
          { result: { status: "passed", duration: 1_000_000 } },
          { result: { status: "passed", duration: 2_000_000 } },
        ],
      },
      {
        name: "Declined card",
        type: "scenario",
        steps: [
          { result: { status: "passed", duration: 1_000_000 } },
          {
            result: { status: "failed", duration: 3_000_000, error_message: "card declined" },
            embeddings: [{ mime_type: "image/png", data: "base64==" }],
          },
        ],
      },
      {
        name: "All skipped",
        type: "scenario",
        steps: [{ result: { status: "skipped" } }, { result: { status: "skipped" } }],
      },
      {
        name: "Undefined step",
        type: "scenario",
        steps: [
          { result: { status: "passed", duration: 1_000_000 } },
          { result: { status: "undefined" } },
        ],
      },
      // Backgrounds carry no independent result and must be ignored.
      { name: "setup", type: "background", steps: [{ result: { status: "passed" } }] },
    ],
  },
]);

/** Asserts that artifact references are vault-relative (links, never copied bytes). */
export const assertArtifactReferences = (artifacts: EvidenceArtifact[], prefix: string): void => {
  const types = artifacts.map((a) => a.type);
  expect(types).toContain("report");
  expect(types).toContain("screenshot");
  // References only — into .testrunner/reports, never copied bytes.
  for (const artifact of artifacts) {
    expect(artifact.path.startsWith(prefix)).toBe(true);
  }
};

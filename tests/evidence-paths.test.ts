import { describe, expect, it } from "vitest";
import { evidenceRunFolder } from "../src/application/services/evidence-paths";
import type { TestRun } from "../src/domain/entities/test-run";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const run = (overrides: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-1",
  scope: "all",
  target: "all",
  status: "passed",
  startedAt: "2026-03-09T10:00:00.000Z",
  finishedAt: "2026-03-09T10:01:00.000Z",
  command: "npm run test",
  workingDirectory: vp(".testrunner"),
  reportPaths: {},
  ...overrides,
});

const fixedNow = () => new Date("2099-12-31T00:00:00.000Z");

describe("evidenceRunFolder", () => {
  it("buckets a run under <root>/YYYY/MM/<runId> from startedAt (UTC, zero-padded month)", () => {
    expect(evidenceRunFolder(vp("Test Evidence"), run(), fixedNow)).toBe(
      "Test Evidence/2026/03/RUN-1",
    );
  });

  it("falls back to now() when startedAt is not a valid date", () => {
    expect(evidenceRunFolder(vp("Test Evidence"), run({ startedAt: "not-a-date" }), fixedNow)).toBe(
      "Test Evidence/2099/12/RUN-1",
    );
  });
});

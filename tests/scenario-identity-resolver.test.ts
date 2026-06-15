import { describe, expect, it, vi } from "vitest";
import { ScenarioIdentityResolver } from "../src/application/services/scenario-identity-resolver";
import type { ParsedReport, ScenarioResult } from "../src/application/ports/report-parser";
import { ok, err } from "../src/shared/result/result";
import { appError } from "../src/shared/errors/errors";
import { rowDigest } from "../src/domain/value-objects/scenario-reference";

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const warnOf = (log: ReturnType<typeof logger>): ReturnType<typeof vi.fn> =>
  (log as unknown as { warn: ReturnType<typeof vi.fn> }).warn;

const fsWith = (files: Record<string, string>) =>
  ({
    readFile: async (path: string) =>
      path in files ? ok(files[path]) : err(appError("REPORT_NOT_FOUND", `missing ${path}`)),
  }) as never;

const report = (scenarioResults: ScenarioResult[]): ParsedReport => ({
  result: { total: scenarioResults.length, passed: 0, failed: 0, skipped: 0 },
  scenarioResults,
  artifacts: [],
});

// playwright-bdd writes the feature uri relative to the runner config dir, so a
// vault feature surfaces in the report with a leading `../` (one per runner level).
const FEATURE = "Specifications/features/UC-001-login.feature";
const URI = "../Specifications/features/UC-001-login.feature";

const row = (over: Partial<ScenarioResult> = {}): ScenarioResult => ({
  feature: "F",
  featureUri: URI,
  scenario: "Login",
  status: "passed",
  ...over,
});

const OUTLINE = [
  "Feature: F",
  "  Scenario Outline: Login as <role>",
  "    Given I am <role>",
  "    Examples:",
  "      | role  |",
  "      | admin |",
  "      | user  |",
  "",
].join("\n");

describe("ScenarioIdentityResolver", () => {
  it("attaches a plain scenario reference from featureUri + name", async () => {
    const resolver = new ScenarioIdentityResolver(
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    const out = await resolver.enrich(report([row()]));
    expect(out.scenarioResults[0]?.scenarioRef).toBe(`${FEATURE}::Login`);
  });

  it("attaches content-stable references to Outline rows, matched by expanded name", async () => {
    const resolver = new ScenarioIdentityResolver(fsWith({ [FEATURE]: OUTLINE }), logger());
    const out = await resolver.enrich(
      report([
        row({ scenario: "Login as user", line: 7 }), // report carries the EXPANDED pickle name
        row({ scenario: "Login as admin", line: 6 }),
      ]),
    );
    const refByLine = Object.fromEntries(out.scenarioResults.map((r) => [r.line, r.scenarioRef]));
    expect(refByLine[6]).toBe(`${FEATURE}::Login as <role>::row-${rowDigest([["role", "admin"]])}`);
    expect(refByLine[7]).toBe(`${FEATURE}::Login as <role>::row-${rowDigest([["role", "user"]])}`);
  });

  it("leaves the ref undefined and warns when the feature is unreadable", async () => {
    const log = logger();
    const resolver = new ScenarioIdentityResolver(fsWith({}), log);
    const out = await resolver.enrich(report([row()]));
    expect(out.scenarioResults[0]?.scenarioRef).toBeUndefined();
    expect(warnOf(log)).toHaveBeenCalled();
  });

  it("falls back to a provisional row key when report rows exceed feature rows", async () => {
    const text = [
      "Feature: F",
      "  Scenario Outline: O",
      "    Given <a>",
      "    Examples:",
      "      | a |",
      "      | 1 |",
      "",
    ].join("\n");
    const resolver = new ScenarioIdentityResolver(fsWith({ [FEATURE]: text }), logger());
    const out = await resolver.enrich(
      report([row({ scenario: "O", line: 6 }), row({ scenario: "O", line: 99 })]),
    );
    const refs = out.scenarioResults.map((r) => r.scenarioRef);
    expect(refs.some((r) => r === `${FEATURE}::O::row-1`)).toBe(true);
  });

  it("does not mutate the input report's results", async () => {
    const input = report([row()]);
    const resolver = new ScenarioIdentityResolver(
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    await resolver.enrich(input);
    expect(input.scenarioResults[0]?.scenarioRef).toBeUndefined();
  });

  it("returns the report unenriched (no throw) when reading a feature rejects", async () => {
    const log = logger();
    const throwingFs = {
      readFile: async () => {
        throw new Error("io boom");
      },
    } as never;
    const resolver = new ScenarioIdentityResolver(throwingFs, log);
    const input = report([row()]);
    const out = await resolver.enrich(input);
    expect(out.scenarioResults[0]?.scenarioRef).toBeUndefined();
    expect(warnOf(log)).toHaveBeenCalled();
  });

  it("resolves from the run-start snapshot, not the edited live feature (codex)", async () => {
    // The live vault file was edited mid-run (Login renamed to Signin), but the
    // run executed the snapshot's content. The ref must reflect what ran.
    const liveFs = fsWith({ [FEATURE]: "Feature: F\n  Scenario: Signin\n    Given x\n" });
    const snapshot = { [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" };
    const resolver = new ScenarioIdentityResolver(liveFs, logger());
    const out = await resolver.enrich(report([row({ scenario: "Login" })]), snapshot);
    expect(out.scenarioResults[0]?.scenarioRef).toBe(`${FEATURE}::Login`);
  });

  it("falls back to the live feature when the snapshot lacks the path", async () => {
    const resolver = new ScenarioIdentityResolver(
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    // Snapshot exists but for a different feature -> live read for FEATURE.
    const out = await resolver.enrich(report([row()]), {
      "Specifications/features/other.feature": "",
    });
    expect(out.scenarioResults[0]?.scenarioRef).toBe(`${FEATURE}::Login`);
  });

  it("preserves nested feature subfolders, independent of featureFilesPath (codex P2)", async () => {
    const NESTED = "Specifications/features/auth/login.feature";
    const resolver = new ScenarioIdentityResolver(
      fsWith({ [NESTED]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    const out = await resolver.enrich(
      report([row({ featureUri: "../Specifications/features/auth/login.feature" })]),
    );
    expect(out.scenarioResults[0]?.scenarioRef).toBe(`${NESTED}::Login`);
  });

  it("still resolves a distinguishing-named Outline row when a tag filter drops siblings", async () => {
    const resolver = new ScenarioIdentityResolver(fsWith({ [FEATURE]: OUTLINE }), logger());
    // Suite run generated only the `user` row; its expanded name still matches.
    const out = await resolver.enrich(report([row({ scenario: "Login as user", line: 7 })]));
    expect(out.scenarioResults[0]?.scenarioRef).toBe(
      `${FEATURE}::Login as <role>::row-${rowDigest([["role", "user"]])}`,
    );
  });

  it("skips refs (no merge) for a Feature with identity collisions run without validation (codex)", async () => {
    // Two scenarios share a name -> they'd mint the SAME ::Login ref and merge
    // history. Validation isn't enforced before a run, so the resolver refuses.
    const text = "Feature: F\n  Scenario: Login\n    Given x\n  Scenario: Login\n    Given y\n";
    const log = logger();
    const resolver = new ScenarioIdentityResolver(fsWith({ [FEATURE]: text }), log);
    const out = await resolver.enrich(
      report([row({ scenario: "Login", line: 2 }), row({ scenario: "Login", line: 4 })]),
    );
    expect(out.scenarioResults.every((r) => r.scenarioRef === undefined)).toBe(true);
    expect(warnOf(log)).toHaveBeenCalled();
  });

  it("uses a provisional key (no mis-attribution) when a filter drops same-named outline rows (codex P1)", async () => {
    const text = [
      "Feature: F",
      "  Scenario Outline: Login", // name omits the varying param -> rows share matchName
      "    Given I am <role>",
      "    Examples:",
      "      | role  |",
      "      | admin |",
      "      | user  |",
      "",
    ].join("\n");
    const log = logger();
    const resolver = new ScenarioIdentityResolver(fsWith({ [FEATURE]: text }), log);
    // Only the second row ran; report has ONE "Login" row.
    const out = await resolver.enrich(report([row({ scenario: "Login", line: 7 })]));
    // Must NOT receive the first (admin) row's content digest.
    expect(out.scenarioResults[0]?.scenarioRef).not.toBe(
      `${FEATURE}::Login::row-${rowDigest([["role", "admin"]])}`,
    );
    expect(out.scenarioResults[0]?.scenarioRef).toBe(`${FEATURE}::Login::row-0`);
    expect(warnOf(log)).toHaveBeenCalled();
  });
});

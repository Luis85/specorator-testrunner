import { describe, expect, it, vi } from "vitest";
import { ScenarioIdentityResolver } from "../src/application/services/scenario-identity-resolver";
import type { ParsedReport, ScenarioResult } from "../src/application/ports/report-parser";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { ok, err } from "../src/shared/result/result";
import { appError } from "../src/shared/errors/errors";
import { rowDigest } from "../src/domain/value-objects/scenario-reference";

const settings = (featureFilesPath = "Specifications/features") =>
  ({ load: async () => ({ paths: { featureFilesPath: vp(featureFilesPath) } }) }) as never;

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

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

const FEATURE = "Specifications/features/UC-001-login.feature";

describe("ScenarioIdentityResolver", () => {
  it("attaches a plain scenario reference from featureUri + name", async () => {
    const resolver = new ScenarioIdentityResolver(
      settings(),
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    const out = await resolver.enrich(
      report([
        {
          feature: "F",
          featureUri: "features/UC-001-login.feature",
          scenario: "Login",
          status: "passed",
        },
      ]),
    );
    expect(out.scenarioResults[0]?.scenarioRef).toBe(`${FEATURE}::Login`);
  });

  it("attaches content-stable references to Outline rows by line order", async () => {
    const text = [
      "Feature: F",
      "  Scenario Outline: Login as <role>",
      "    Given I am <role>",
      "    Examples:",
      "      | role  |",
      "      | admin |",
      "      | user  |",
      "",
    ].join("\n");
    const resolver = new ScenarioIdentityResolver(
      settings(),
      fsWith({ [FEATURE]: text }),
      logger(),
    );
    const out = await resolver.enrich(
      report([
        {
          feature: "F",
          featureUri: "features/UC-001-login.feature",
          scenario: "Login as <role>",
          status: "passed",
          line: 7,
        },
        {
          feature: "F",
          featureUri: "features/UC-001-login.feature",
          scenario: "Login as <role>",
          status: "passed",
          line: 6,
        },
      ]),
    );
    const refByLine = Object.fromEntries(out.scenarioResults.map((r) => [r.line, r.scenarioRef]));
    expect(refByLine[6]).toBe(`${FEATURE}::Login as <role>::row-${rowDigest([["role", "admin"]])}`);
    expect(refByLine[7]).toBe(`${FEATURE}::Login as <role>::row-${rowDigest([["role", "user"]])}`);
  });

  it("leaves the ref undefined and warns when the feature is unreadable", async () => {
    const log = logger();
    const resolver = new ScenarioIdentityResolver(settings(), fsWith({}), log);
    const out = await resolver.enrich(
      report([
        {
          feature: "F",
          featureUri: "features/UC-001-login.feature",
          scenario: "Login",
          status: "passed",
        },
      ]),
    );
    expect(out.scenarioResults[0]?.scenarioRef).toBeUndefined();
    expect((log as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
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
    const resolver = new ScenarioIdentityResolver(
      settings(),
      fsWith({ [FEATURE]: text }),
      logger(),
    );
    const out = await resolver.enrich(
      report([
        {
          feature: "F",
          featureUri: "features/UC-001-login.feature",
          scenario: "O",
          status: "passed",
          line: 6,
        },
        {
          feature: "F",
          featureUri: "features/UC-001-login.feature",
          scenario: "O",
          status: "passed",
          line: 99,
        },
      ]),
    );
    const refs = out.scenarioResults.map((r) => r.scenarioRef);
    expect(refs.some((r) => r === `${FEATURE}::O::row-1`)).toBe(true);
  });

  it("does not mutate the input report's results", async () => {
    const input = report([
      {
        feature: "F",
        featureUri: "features/UC-001-login.feature",
        scenario: "Login",
        status: "passed",
      },
    ]);
    const resolver = new ScenarioIdentityResolver(
      settings(),
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      logger(),
    );
    await resolver.enrich(input);
    expect(input.scenarioResults[0]?.scenarioRef).toBeUndefined();
  });

  it("returns the report unenriched (no throw) when settings cannot load", async () => {
    const log = logger();
    const failingSettings = {
      load: async () => {
        throw new Error("settings boom");
      },
    } as never;
    const resolver = new ScenarioIdentityResolver(
      failingSettings,
      fsWith({ [FEATURE]: "Feature: F\n  Scenario: Login\n    Given x\n" }),
      log,
    );
    const input = report([
      {
        feature: "F",
        featureUri: "features/UC-001-login.feature",
        scenario: "Login",
        status: "passed",
      },
    ]);
    const out = await resolver.enrich(input);
    expect(out.scenarioResults[0]?.scenarioRef).toBeUndefined();
    expect((log as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
  });
});

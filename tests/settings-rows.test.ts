import { describe, expect, it } from "vitest";
import type {
  CiReadinessResult,
  RunnerValidationResult,
} from "../src/application/services/environment-validation-service";
import type { RepairResult } from "../src/application/services/maintenance-service";
import {
  buildAuthEnv,
  checklistRow,
  ciReadinessRows,
  environmentNameProblem,
  isWorkflowAlreadyExistsError,
  repairFailureRow,
  repairRows,
  runnerValidationRows,
  settingsErrorMessages,
} from "../src/presentation/settings/settings-rows";
import { appError } from "../src/shared/errors/errors";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const validation = (over: Partial<RunnerValidationResult>): RunnerValidationResult => ({
  valid: true,
  nodeAvailable: true,
  packageManagerAvailable: true,
  runnerFolderExists: true,
  packageJsonExists: true,
  dependenciesInstalled: true,
  playwrightAvailable: true,
  browsersInstalled: true,
  issues: [],
  ...over,
});

const readiness = (over: Partial<CiReadinessResult>): CiReadinessResult => ({
  ready: true,
  missingItems: [],
  warnings: [],
  ...over,
});

describe("runnerValidationRows", () => {
  it("renders a single ✓ row when the environment is ready", () => {
    expect(runnerValidationRows(validation({}))).toEqual([
      { icon: "✓", status: "ok", text: "Environment is ready." },
    ]);
  });

  it("renders one row per issue, mapping severity onto the row status", () => {
    const rows = runnerValidationRows(
      validation({
        valid: false,
        issues: [
          { code: "NODE_MISSING", message: "Node.js is not available.", severity: "error" },
          { code: "SOMETHING", message: "Heads up.", severity: "warning" },
          { code: "FYI", message: "Just so you know.", severity: "info" },
        ],
      }),
    );
    expect(rows).toEqual([
      { icon: "✗", status: "error", text: "Node.js is not available." },
      { icon: "!", status: "warning", text: "Heads up." },
      { icon: "–", status: "info", text: "Just so you know." },
    ]);
  });

  it("still renders a generic ✗ row for a not-valid result without issues", () => {
    expect(runnerValidationRows(validation({ valid: false }))).toEqual([
      { icon: "✗", status: "error", text: "Environment is not ready." },
    ]);
  });
});

describe("repairRows", () => {
  const repair = (over: Partial<RepairResult>): RepairResult => ({
    repairedFiles: [vp(".testrunner/package.json")],
    reinstalledPackages: false,
    reinstalledBrowsers: true,
    ...over,
  });

  it("reports the repaired file count (singular)", () => {
    expect(repairRows(repair({}))[0]).toEqual(checklistRow("ok", "Repaired 1 runner file."));
  });

  it("reports the repaired file count (plural) and reinstalls", () => {
    const rows = repairRows(
      repair({
        repairedFiles: [vp("a"), vp("b")],
        reinstalledPackages: true,
        reinstalledBrowsers: true,
      }),
    );
    expect(rows).toEqual([
      checklistRow("ok", "Repaired 2 runner files."),
      checklistRow("ok", "Reinstalled npm dependencies."),
      checklistRow("ok", "Verified the Chromium browser installation."),
    ]);
  });

  it("marks skipped reinstalls as informational rather than success", () => {
    const rows = repairRows(repair({ reinstalledPackages: false, reinstalledBrowsers: false }));
    expect(rows[1]).toEqual(
      checklistRow("info", "Dependencies were intact; no reinstall was needed."),
    );
    expect(rows[2]).toEqual(checklistRow("info", "Browser installation was not re-run."));
  });
});

describe("repairFailureRow", () => {
  it("explains the busy refusal without leaking internals", () => {
    expect(repairFailureRow(appError("RUN_IN_PROGRESS", "busy")).text).toMatch(/in progress/);
    expect(repairFailureRow(appError("MAINTENANCE_IN_PROGRESS", "busy")).text).toMatch(
      /in progress/,
    );
  });

  it("carries the service message for other failures", () => {
    expect(repairFailureRow(appError("NPM_INSTALL_FAILED", "npm exploded"))).toEqual(
      checklistRow("error", "Repair failed: npm exploded"),
    );
  });
});

describe("ciReadinessRows", () => {
  it("renders ready ✓ followed by the advisory warnings", () => {
    expect(ciReadinessRows(readiness({ warnings: ["Set E2E_BASE_URL."] }))).toEqual([
      checklistRow("ok", "CI is ready."),
      checklistRow("warning", "Set E2E_BASE_URL."),
    ]);
  });

  it("renders one ✗ row per missing item plus warnings", () => {
    const rows = ciReadinessRows(
      readiness({
        ready: false,
        missingItems: ["Runner folder is missing.", "CI workflow not generated."],
        warnings: ["Node version is empty."],
      }),
    );
    expect(rows).toEqual([
      checklistRow("error", "Runner folder is missing."),
      checklistRow("error", "CI workflow not generated."),
      checklistRow("warning", "Node version is empty."),
    ]);
  });
});

describe("settingsErrorMessages", () => {
  it("extracts the field-level messages save() packs into details.errors", () => {
    const error = appError("SETTINGS_INVALID", "Settings failed validation.", {
      details: {
        errors: [
          { field: "sut.environments.staging.baseUrl", message: "bad URL", severity: "error" },
          {
            field: "sut.environments.staging.auth.env.MY-KEY",
            message: "bad key",
            severity: "error",
          },
        ],
      },
    });
    expect(settingsErrorMessages(error)).toEqual(["bad URL", "bad key"]);
  });

  it("falls back to the top-level message for malformed or missing details", () => {
    expect(settingsErrorMessages(appError("SETTINGS_INVALID", "It broke."))).toEqual(["It broke."]);
    expect(
      settingsErrorMessages(
        appError("SETTINGS_INVALID", "It broke.", { details: { errors: "nope" } }),
      ),
    ).toEqual(["It broke."]);
    expect(
      settingsErrorMessages(
        appError("SETTINGS_INVALID", "It broke.", { details: { errors: [42, null] } }),
      ),
    ).toEqual(["It broke."]);
  });
});

describe("isWorkflowAlreadyExistsError", () => {
  it("matches the pipeline service's never-clobber rejection", () => {
    expect(
      isWorkflowAlreadyExistsError(
        appError(
          "VALIDATION_FAILED",
          "A CI workflow already exists at .github/workflows/e2e.yml. Re-run with overwrite enabled to replace it.",
        ),
      ),
    ).toBe(true);
  });

  it("does not match other validation failures or other codes", () => {
    expect(
      isWorkflowAlreadyExistsError(appError("VALIDATION_FAILED", "Provider not supported.")),
    ).toBe(false);
    expect(isWorkflowAlreadyExistsError(appError("INIT_FAILED", "already exists"))).toBe(false);
  });
});

describe("environmentNameProblem", () => {
  it("accepts a fresh, non-empty name", () => {
    expect(environmentNameProblem("staging", ["demo"])).toBeUndefined();
  });

  it("rejects empty and whitespace-only names", () => {
    expect(environmentNameProblem("", ["demo"])).toMatch(/Enter a name/);
    expect(environmentNameProblem("   ", ["demo"])).toMatch(/Enter a name/);
  });

  it("rejects duplicates (after trimming)", () => {
    expect(environmentNameProblem(" demo ", ["demo"])).toMatch(/already exists/);
  });
});

describe("buildAuthEnv", () => {
  it("builds a record from the rows, trimming keys", () => {
    expect(
      buildAuthEnv([
        { key: " API_TOKEN ", value: "s3cret" },
        { key: "USER", value: "qa" },
      ]),
    ).toEqual({ API_TOKEN: "s3cret", USER: "qa" });
  });

  it("drops staged rows with an empty key but keeps empty values", () => {
    expect(
      buildAuthEnv([
        { key: "", value: "typed-before-key" },
        { key: "TOKEN", value: "" },
      ]),
    ).toEqual({ TOKEN: "" });
  });

  it("keeps INVALID keys so save() can reject them with an inline error", () => {
    expect(buildAuthEnv([{ key: "MY-KEY", value: "v" }])).toEqual({ "MY-KEY": "v" });
  });

  it("returns undefined when no row carries data, so auth is omitted entirely", () => {
    expect(buildAuthEnv([])).toBeUndefined();
    expect(buildAuthEnv([{ key: "  ", value: "x" }])).toBeUndefined();
  });

  it("lets a later duplicate key win, matching record assignment", () => {
    expect(
      buildAuthEnv([
        { key: "TOKEN", value: "old" },
        { key: "TOKEN", value: "new" },
      ]),
    ).toEqual({ TOKEN: "new" });
  });
});

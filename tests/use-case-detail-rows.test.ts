import { describe, expect, it } from "vitest";
import type {
  FeatureFileEntry,
  SpecificationValidationResult,
} from "../src/application/services/specification-service";
import type { UseCase } from "../src/domain/entities/use-case";
import {
  featureHealthLine,
  featureValidationRows,
  projectFeatureRows,
  projectUseCaseHeader,
  storyMapBacklinks,
  validateFeatureOutcome,
} from "../src/presentation/views/use-case-detail-rows";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { err, ok } from "../src/shared/result/result";
import { appError } from "../src/shared/errors/errors";

const useCase = (over: Partial<UseCase> = {}): UseCase => ({
  id: "UC-001",
  title: "Open Example",
  status: "specified",
  automationStatus: "implemented",
  featureFiles: [],
  suites: [],
  evidence: [],
  path: vp("Use Cases/UC-001 Open Example.md"),
  ...over,
});

const entry = (path: string): FeatureFileEntry => ({
  path: vp(path),
  label: path.replace(/^Features\//, ""),
});

describe("storyMapBacklinks", () => {
  const maps = [
    {
      id: "SM-002",
      title: "Beta",
      path: vp("Story Maps/SM-002/SM-002.md"),
      cards: [{ ref: "UC-001" }, { ref: undefined }],
    },
    {
      id: "SM-001",
      title: "Alpha",
      path: vp("Story Maps/SM-001/SM-001.md"),
      cards: [{ ref: "UC-001" }, { ref: "UC-009" }],
    },
    {
      id: "SM-003",
      title: "Gamma",
      path: vp("Story Maps/SM-003/SM-003.md"),
      cards: [{ ref: "UC-009" }],
    },
  ];

  it("returns the maps that reference the Use Case, sorted by id", () => {
    expect(storyMapBacklinks("UC-001", maps)).toEqual([
      { id: "SM-001", title: "Alpha", path: "Story Maps/SM-001/SM-001.md" },
      { id: "SM-002", title: "Beta", path: "Story Maps/SM-002/SM-002.md" },
    ]);
  });

  it("returns nothing when no map references the Use Case", () => {
    expect(storyMapBacklinks("UC-404", maps)).toEqual([]);
  });
});

describe("projectUseCaseHeader", () => {
  it("projects the header fields the detail view renders", () => {
    expect(projectUseCaseHeader(useCase())).toEqual({
      id: "UC-001",
      title: "Open Example",
      status: "specified",
      automationStatus: "implemented",
      path: vp("Use Cases/UC-001 Open Example.md"),
    });
  });
});

describe("projectFeatureRows", () => {
  it("keeps only the Features whose filename back-references this Use Case", () => {
    const rows = projectFeatureRows("UC-001", [
      entry("Features/UC-001-happy-path.feature"),
      entry("Features/UC-002-happy-path.feature"),
      entry("Features/UC-001-edge-cases.feature"),
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "UC-001-happy-path.feature",
      "UC-001-edge-cases.feature",
    ]);
  });

  it("excludes orphan files with no UC-NNN- prefix", () => {
    const rows = projectFeatureRows("UC-001", [entry("Features/archive-old.feature")]);
    expect(rows).toEqual([]);
  });

  it("matches the Use Case id case-insensitively via the filename prefix", () => {
    const rows = projectFeatureRows("UC-001", [entry("Features/uc-001-happy-path.feature")]);
    expect(rows).toHaveLength(1);
  });

  it("preserves the service's listing order", () => {
    const rows = projectFeatureRows("UC-001", [
      entry("Features/UC-001-b.feature"),
      entry("Features/UC-001-a.feature"),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["UC-001-b.feature", "UC-001-a.feature"]);
  });
});

describe("featureHealthLine (Wave F)", () => {
  const health = (over: Partial<Parameters<typeof featureHealthLine>[0]> = {}) => ({
    path: vp("Features/UC-001-happy-path.feature"),
    scenarioCount: 3,
    wipScenarioCount: 0,
    featureIsWip: false,
    quarantineScenarioCount: 0,
    featureIsQuarantined: false,
    ...over,
  });

  it("phrases the scenario count, singular and plural", () => {
    expect(featureHealthLine(health()).text).toBe("3 scenarios");
    expect(featureHealthLine(health({ scenarioCount: 1 })).text).toBe("1 scenario");
    expect(featureHealthLine(health({ scenarioCount: 0 })).text).toBe("0 scenarios");
  });

  it("appends the @wip count only when scenario-level @wip work exists", () => {
    expect(featureHealthLine(health({ wipScenarioCount: 2 })).text).toBe("3 scenarios (2 @wip)");
    expect(featureHealthLine(health({ wipScenarioCount: 0 })).text).toBe("3 scenarios");
  });

  it("appends the quarantine count, alone and alongside @wip (US-058)", () => {
    expect(featureHealthLine(health({ quarantineScenarioCount: 1 })).text).toBe(
      "3 scenarios (1 quarantined)",
    );
    expect(
      featureHealthLine(health({ wipScenarioCount: 2, quarantineScenarioCount: 1 })).text,
    ).toBe("3 scenarios (2 @wip, 1 quarantined)");
  });

  it("emits no badges for a Feature with no feature-level exclusion tags", () => {
    expect(featureHealthLine(health()).badges).toEqual([]);
  });

  it("emits the feature-level @wip badge with the KPI exclusion tooltip", () => {
    const badges = featureHealthLine(health({ featureIsWip: true })).badges;
    expect(badges).toHaveLength(1);
    expect(badges[0]?.text).toBe("@wip");
    expect(badges[0]?.cls).toBe("e2e-test-hub-wip-badge");
    expect(badges[0]?.tooltip).toContain("excluded from the KPI roll-up");
    // Internal decision ids (ADR-NNNN) stay out of user copy.
    expect(badges[0]?.tooltip).not.toContain("ADR-0017");
  });

  it("emits the feature-level @quarantine badge with the KPI exclusion tooltip (US-058)", () => {
    const badges = featureHealthLine(health({ featureIsQuarantined: true })).badges;
    expect(badges).toHaveLength(1);
    expect(badges[0]?.text).toBe("@quarantine");
    expect(badges[0]?.cls).toBe("e2e-test-hub-quarantine-badge");
    expect(badges[0]?.tooltip).toContain("excluded from the KPI roll-up");
  });

  it("emits both badges when a Feature is tagged @wip and @quarantine", () => {
    const badges = featureHealthLine(health({ featureIsWip: true, featureIsQuarantined: true }));
    expect(badges.badges.map((b) => b.text)).toEqual(["@wip", "@quarantine"]);
  });
});

describe("featureValidationRows", () => {
  it("renders a single ok row when the Feature is valid", () => {
    const result: SpecificationValidationResult = { valid: true, errors: [] };
    expect(featureValidationRows(result)).toEqual([
      { status: "ok", icon: "✓", text: "Feature Specification is valid." },
    ]);
  });

  it("renders one error row per structural error", () => {
    const result: SpecificationValidationResult = {
      valid: false,
      errors: [{ message: "Feature has no scenarios." }, { message: "Feature has no name." }],
    };
    const rows = featureValidationRows(result);
    expect(rows.map((r) => r.status)).toEqual(["error", "error"]);
    expect(rows.map((r) => r.text)).toEqual(["Feature has no scenarios.", "Feature has no name."]);
  });

  it("renders a generic error row when not valid but no errors are listed", () => {
    const rows = featureValidationRows({ valid: false, errors: [] });
    expect(rows).toEqual([
      { status: "error", icon: "✗", text: "Feature Specification is not valid." },
    ]);
  });
});

const featurePath = vp("Features/UC-001-happy-path.feature");

describe("validateFeatureOutcome", () => {
  it("projects a valid Feature to the ok row", async () => {
    const spec = { validate: async () => ok({ valid: true, errors: [] }) };
    expect(await validateFeatureOutcome(spec, featurePath)).toEqual([
      { status: "ok", icon: "✓", text: "Feature Specification is valid." },
    ]);
  });

  it("surfaces a service failure as an error row", async () => {
    const spec = { validate: async () => err(appError("VALIDATION_FAILED", "boom")) };
    expect(await validateFeatureOutcome(spec, featurePath)).toEqual([
      { status: "error", icon: "✗", text: "Validation failed: boom" },
    ]);
  });
});

describe("validateFeatureOutcome remains the only inline Feature-row action", () => {
  it("no longer exports detect/generate outcome helpers — the Pending Steps companion owns those flows (WS1/C2)", async () => {
    const mod = await import("../src/presentation/views/use-case-detail-rows");
    expect("detectMissingStepsOutcome" in mod).toBe(false);
    expect("generateStepDefinitionsOutcome" in mod).toBe(false);
    expect("missingStepsRows" in mod).toBe(false);
    expect("stepGenerationRows" in mod).toBe(false);
  });
});

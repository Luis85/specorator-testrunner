import { describe, expect, it } from "vitest";
import {
  countMatchingScenariosInFeature,
  DefaultFeatureInsightService,
  effectiveScenarioTags,
  projectFeatureHealth,
} from "../src/application/services/feature-insight-service";
import { parseFeature } from "../src/application/content/gherkin";
import type { FeatureFileEntry } from "../src/application/services/specification-service";
import type { FeatureSpecification } from "../src/domain/entities/specification";
import { parseTagExpression, type TagExpression } from "../src/domain/policies/tag-expression";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { ok, type Result } from "../src/shared/result/result";
import { FakeVaultFileSystem } from "./fakes";

const feature = (over: Partial<FeatureSpecification> = {}): FeatureSpecification => ({
  path: vp("Specifications/features/UC-001-happy-path.feature"),
  useCaseId: "UC-001",
  featureName: "Happy path",
  tags: [],
  scenarios: [],
  ...over,
});

const scenario = (name: string, tags: string[] = []) => ({ name, tags, steps: [] });

const expr = (expression: string): TagExpression => {
  const parsed = parseTagExpression(expression);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

describe("effectiveScenarioTags", () => {
  it("inherits feature-level tags into every scenario (Gherkin semantics)", () => {
    const f = feature({ tags: ["@smoke"], scenarios: [scenario("a", ["@fast"])] });
    expect(effectiveScenarioTags(f, f.scenarios[0])).toEqual(["@smoke", "@fast"]);
  });
});

describe("projectFeatureHealth", () => {
  it("counts scenarios and scenario-level @wip work", () => {
    const f = feature({
      scenarios: [scenario("a"), scenario("b", ["@wip"]), scenario("c", ["@WIP"])],
    });
    expect(projectFeatureHealth(f)).toEqual({
      path: f.path,
      scenarioCount: 3,
      wipScenarioCount: 2, // @wip matched case-insensitively, like ADR-0017
      featureIsWip: false,
      quarantineScenarioCount: 0,
    });
  });

  it("flags a feature-level @wip without folding it into the scenario count", () => {
    const f = feature({ tags: ["@wip"], scenarios: [scenario("a"), scenario("b")] });
    expect(projectFeatureHealth(f)).toEqual({
      path: f.path,
      scenarioCount: 2,
      wipScenarioCount: 0, // feature-level @wip is the badge, not the (M @wip) count
      featureIsWip: true,
      quarantineScenarioCount: 0,
    });
  });

  it("counts scenario-level @quarantine work, case-insensitively (US-058)", () => {
    const f = feature({
      scenarios: [scenario("a"), scenario("b", ["@quarantine"]), scenario("c", ["@QUARANTINE"])],
    });
    expect(projectFeatureHealth(f)).toMatchObject({
      scenarioCount: 3,
      quarantineScenarioCount: 2,
    });
  });

  it("counts @wip carried only on a runnable Examples block", () => {
    const f = parseFeature(
      `Feature: F

  Scenario Outline: O
    Given x

    @wip
    Examples:
      | a |
      | 1 |
`,
      vp("Specifications/features/UC-009-wip-block.feature"),
    );
    expect(f).not.toBeNull();
    if (!f) return;
    expect(projectFeatureHealth(f).wipScenarioCount).toBe(1);
  });
});

describe("countMatchingScenariosInFeature", () => {
  it("evaluates against effective tags, so feature-level tags count", () => {
    const f = feature({
      tags: ["@smoke"],
      scenarios: [scenario("a"), scenario("b", ["@wip"]), scenario("c", ["@slow"])],
    });
    expect(countMatchingScenariosInFeature(expr("@smoke"), f)).toBe(3);
    expect(countMatchingScenariosInFeature(expr("@smoke and not @wip"), f)).toBe(2);
    expect(countMatchingScenariosInFeature(expr("@slow"), f)).toBe(1);
    expect(countMatchingScenariosInFeature(expr("@regression"), f)).toBe(0);
  });
});

// ── service shell ────────────────────────────────────────────────────────────

const FEATURES_DIR = "Specifications/features";

const listFeaturesFrom = (fs: FakeVaultFileSystem) => ({
  async listFeatures(): Promise<Result<FeatureFileEntry[]>> {
    return ok(
      [...fs.files.keys()]
        .filter((path) => path.endsWith(".feature"))
        .map((path) => ({ path: vp(path), label: path.slice(FEATURES_DIR.length + 1) })),
    );
  },
});

const makeService = (files: Record<string, string>) => {
  const fs = new FakeVaultFileSystem();
  for (const [path, content] of Object.entries(files)) fs.files.set(path, content);
  return new DefaultFeatureInsightService(listFeaturesFrom(fs), fs);
};

const SMOKE_FEATURE = [
  "@smoke",
  "Feature: Login",
  "",
  "  Scenario: happy path",
  "    Given a user",
  "",
  "  @wip",
  "  Scenario: edge case",
  "    Given a user",
].join("\n");

const DEMO_FEATURE = [
  "Feature: Demo",
  "",
  "  @smoke @demo",
  "  Scenario: open example",
  "    Given the fixture",
].join("\n");

describe("DefaultFeatureInsightService.countMatchingScenarios", () => {
  it("sums matches across every Feature file (effective tags)", async () => {
    const service = makeService({
      [`${FEATURES_DIR}/UC-001-login.feature`]: SMOKE_FEATURE,
      [`${FEATURES_DIR}/UC-002-demo.feature`]: DEMO_FEATURE,
    });
    expect(await service.countMatchingScenarios("@smoke")).toEqual(ok(3));
    expect(await service.countMatchingScenarios("@smoke and not @wip")).toEqual(ok(2));
    expect(await service.countMatchingScenarios("@demo")).toEqual(ok(1));
    expect(await service.countMatchingScenarios("@nope")).toEqual(ok(0));
  });

  it("the empty expression matches every scenario (Cucumber semantics)", async () => {
    const service = makeService({
      [`${FEATURES_DIR}/UC-001-login.feature`]: SMOKE_FEATURE,
      [`${FEATURES_DIR}/UC-002-demo.feature`]: DEMO_FEATURE,
    });
    expect(await service.countMatchingScenarios("")).toEqual(ok(3));
  });

  it("returns the parse error for a malformed Tag Expression", async () => {
    const service = makeService({});
    const result = await service.countMatchingScenarios("@a and");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("ends unexpectedly");
    }
  });

  it("skips files that are not valid Gherkin (best-effort, like traceability)", async () => {
    const service = makeService({
      [`${FEATURES_DIR}/UC-001-login.feature`]: SMOKE_FEATURE,
      [`${FEATURES_DIR}/UC-009-broken.feature`]: "not gherkin at all",
    });
    expect(await service.countMatchingScenarios("@smoke")).toEqual(ok(2));
  });
});

describe("DefaultFeatureInsightService.scenarioCounter", () => {
  const makeCounting = (files: Record<string, string>) => {
    const fs = new FakeVaultFileSystem();
    for (const [path, content] of Object.entries(files)) fs.files.set(path, content);
    const lister = listFeaturesFrom(fs);
    let listCalls = 0;
    const counting = {
      listFeatures: () => {
        listCalls += 1;
        return lister.listFeatures();
      },
    };
    return { service: new DefaultFeatureInsightService(counting, fs), calls: () => listCalls };
  };

  it("loads the corpus ONCE for many expressions (review: was O(suites × features))", async () => {
    const { service, calls } = makeCounting({
      [`${FEATURES_DIR}/UC-001-login.feature`]: SMOKE_FEATURE,
      [`${FEATURES_DIR}/UC-002-demo.feature`]: DEMO_FEATURE,
    });

    const counter = await service.scenarioCounter();
    expect(counter.ok).toBe(true);
    if (!counter.ok) return;

    // One suites-explorer render: many suite rows, one corpus load.
    expect(counter.value("@smoke")).toEqual(ok(3));
    expect(counter.value("@smoke and not @wip")).toEqual(ok(2));
    expect(counter.value("@demo")).toEqual(ok(1));
    expect(calls()).toBe(1);
  });

  it("reports a malformed expression per call without failing the counter", async () => {
    const { service } = makeCounting({
      [`${FEATURES_DIR}/UC-001-login.feature`]: SMOKE_FEATURE,
    });
    const counter = await service.scenarioCounter();
    expect(counter.ok).toBe(true);
    if (!counter.ok) return;
    const malformed = counter.value("@a and");
    expect(malformed.ok).toBe(false);
    // The same counter still answers well-formed expressions afterwards.
    expect(counter.value("@smoke")).toEqual(ok(2));
  });
});

describe("DefaultFeatureInsightService.healthFor", () => {
  it("projects scenario count, @wip work, and the feature-level @wip flag", async () => {
    const path = `${FEATURES_DIR}/UC-001-login.feature`;
    const service = makeService({ [path]: SMOKE_FEATURE });
    expect(await service.healthFor(vp(path))).toEqual(
      ok({
        path: vp(path),
        scenarioCount: 2,
        wipScenarioCount: 1,
        featureIsWip: false,
        quarantineScenarioCount: 0,
      }),
    );
  });

  it("errors for an unreadable file and for a non-Feature file", async () => {
    const service = makeService({ [`${FEATURES_DIR}/UC-009-broken.feature`]: "no feature line" });
    const missing = await service.healthFor(vp(`${FEATURES_DIR}/UC-404-nope.feature`));
    expect(missing.ok).toBe(false);
    const broken = await service.healthFor(vp(`${FEATURES_DIR}/UC-009-broken.feature`));
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("listKnownTags", () => {
  it("unions feature, scenario and Examples tags, seeded with conventions, sorted", async () => {
    const fs = new FakeVaultFileSystem();
    const path = "Specifications/features/UC-001-a.feature";
    fs.files.set(
      path,
      `@feature-level
Feature: F

  @scenario-level
  Scenario Outline: S
    Given x

    @examples-level
    Examples:
      | a |
      | 1 |
`,
    );
    const service = new DefaultFeatureInsightService(
      { listFeatures: async () => ok([{ path: vp(path), label: "UC-001-a.feature" }]) },
      fs,
    );

    const result = await service.listKnownTags();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      "@examples-level",
      "@feature-level",
      "@quarantine",
      "@scenario-level",
      "@smoke",
      "@wip",
    ]);
  });

  it("skips unreadable/unparseable features (best-effort)", async () => {
    const fs = new FakeVaultFileSystem();
    fs.files.set("Specifications/features/UC-002-bad.feature", "not gherkin");
    const service = new DefaultFeatureInsightService(
      {
        listFeatures: async () =>
          ok([
            { path: vp("Specifications/features/UC-002-bad.feature"), label: "UC-002-bad.feature" },
            {
              path: vp("Specifications/features/UC-003-gone.feature"),
              label: "UC-003-gone.feature",
            },
          ]),
      },
      fs,
    );

    const result = await service.listKnownTags();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(["@quarantine", "@smoke", "@wip"]);
  });
});

describe("Examples-level tag matching (Cucumber per-row semantics)", () => {
  const feature = parseFeature(
    `Feature: F

  Scenario Outline: O
    Given x

    @set-1
    Examples: first
      | a |
      | 1 |

    @set-2
    Examples: second
      | a |
      | 2 |
`,
    vp("Specifications/features/UC-001-o.feature"),
  );

  it("matches a tag that lives only on an Examples block", () => {
    expect(feature).not.toBeNull();
    if (!feature) return;
    const expression = parseTagExpression("@set-1");
    expect(expression.ok).toBe(true);
    if (!expression.ok) return;
    expect(countMatchingScenariosInFeature(expression.value, feature)).toBe(1);
  });

  it("does not union tags ACROSS blocks (each block is its own set)", () => {
    expect(feature).not.toBeNull();
    if (!feature) return;
    const expression = parseTagExpression("@set-1 and @set-2");
    expect(expression.ok).toBe(true);
    if (!expression.ok) return;
    expect(countMatchingScenariosInFeature(expression.value, feature)).toBe(0);
  });

  it("ignores Examples blocks without rows (nothing would execute)", () => {
    const rowless = parseFeature(
      `Feature: F

  Scenario Outline: O
    Given x

    @slow
    Examples: empty
      | a |
`,
      vp("Specifications/features/UC-002-rowless.feature"),
    );
    expect(rowless).not.toBeNull();
    if (!rowless) return;
    const expression = parseTagExpression("@slow");
    expect(expression.ok).toBe(true);
    if (!expression.ok) return;
    expect(countMatchingScenariosInFeature(expression.value, rowless)).toBe(0);
  });

  it("an Outline with no Examples matches nothing, even feature-level tags", () => {
    const bare = parseFeature(
      `@tagged
Feature: F

  Scenario Outline: O
    Given x
`,
      vp("Specifications/features/UC-003-bare.feature"),
    );
    expect(bare).not.toBeNull();
    if (!bare) return;
    const expression = parseTagExpression("@tagged");
    expect(expression.ok).toBe(true);
    if (!expression.ok) return;
    expect(countMatchingScenariosInFeature(expression.value, bare)).toBe(0);
  });
});

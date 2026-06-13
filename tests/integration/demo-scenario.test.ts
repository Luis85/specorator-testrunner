import { describe, expect, it } from "vitest";
import {
  buildDemoUseCaseNote,
  DEMO_FEATURE_CONTENT,
  DEMO_FEATURE_FILE_NAME,
  DEMO_SUITE_IDS,
  DEMO_USE_CASE_ID,
  DEMO_USE_CASE_TITLE,
} from "../../src/application/content/demo-content";
import { parseFeature } from "../../src/application/content/gherkin";
import { DefaultSettingsService } from "../../src/application/services/settings-service";
import { DefaultSuiteService } from "../../src/application/services/suite-service";
import { DefaultUseCaseService } from "../../src/application/services/use-case-service";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/settings";
import { DefaultPathSafetyPolicy } from "../../src/domain/policies/path-safety-policy";
import { joinVaultPath } from "../../src/shared/utils/vault-path";
import {
  FakeDataStore,
  FakePrdLookup,
  FakeVaultFileSystem,
  recordingEventBus,
  silentLogger,
} from "../fakes";

/**
 * US-049 — Validate Demo Scenario (FEAT-028, UC-001).
 *
 * The "fresh installation succeeds" acceptance criterion means the demo assets
 * the Initialization Wizard ships must be valid end-to-end at the domain level,
 * not just well-formed strings. This wires the demo content through the SAME
 * real services a fresh install drives — `parseFeature`, `UseCaseService`'s
 * frontmatter mapping (via `findAll`), and `SuiteService.resolveTagExpression` —
 * over a `FakeVaultFileSystem`. It catches drift between the shipped demo
 * content and the parsers/services that must understand it (e.g. a demo tag
 * rename, a frontmatter key change, or a Gherkin keyword the parser rejects)
 * before a user ever opens the vault.
 */

const FEATURE_PATH = joinVaultPath(DEFAULT_SETTINGS.paths.featureFilesPath, DEMO_FEATURE_FILE_NAME);

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const useCases = new DefaultUseCaseService(settings, fs, bus, silentLogger, new FakePrdLookup());
  const suites = new DefaultSuiteService(settings, fs, bus);
  return { fs, useCases, suites };
};

describe("US-049 demo scenario: shipped demo content is valid end-to-end", () => {
  it("demo .feature parses via parseFeature and back-references the demo Use Case", () => {
    const feature = parseFeature(DEMO_FEATURE_CONTENT, FEATURE_PATH);
    expect(feature, "demo feature did not parse").not.toBeNull();
    if (!feature) return;
    // The filename carries the UC back-reference; the parser derives it.
    expect(feature.useCaseId).toBe(DEMO_USE_CASE_ID);
    expect(feature.featureName).toBe(DEMO_USE_CASE_TITLE);
    // The demo must carry @smoke so the Smoke suite tag expression selects it.
    expect(feature.tags).toContain("@smoke");
    expect(feature.scenarios.length).toBeGreaterThan(0);
    // Every scenario must have at least one Given/When/Then step or a run does
    // nothing.
    for (const scenario of feature.scenarios) {
      expect(scenario.steps.length, scenario.name).toBeGreaterThan(0);
    }
  });

  it("demo Use Case note round-trips through UseCaseService's frontmatter mapping", async () => {
    const { fs, useCases } = build();
    const ucPath = joinVaultPath(
      DEFAULT_SETTINGS.paths.useCasesPath,
      `${DEMO_USE_CASE_ID} ${DEMO_USE_CASE_TITLE}.md`,
    );
    await fs.createFile(ucPath, buildDemoUseCaseNote(FEATURE_PATH));

    const all = await useCases.findAll();
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const demo = all.value.find((uc) => uc.id === DEMO_USE_CASE_ID);
    expect(demo, "demo Use Case not indexed by findAll").toBeTruthy();
    if (!demo) return;
    expect(demo.title).toBe(DEMO_USE_CASE_TITLE);
    // The note's feature_file must resolve into the parsed featureFiles list so
    // the demo links to the feature the wizard also wrote.
    expect(demo.featureFiles).toContain(FEATURE_PATH);
    // The demo Use Case must declare the smoke suite it belongs to.
    expect(demo.suites).toEqual([...DEMO_SUITE_IDS]);
  });

  it("demo @smoke tag resolves into the Smoke suite's tag expression", async () => {
    const { suites } = build();
    // A fresh install also creates the default suites; resolveTagExpression must
    // return the exact `--tags` argument a Smoke run uses.
    const created = await suites.createDefaults();
    expect(created.ok).toBe(true);

    const resolved = await suites.resolveTagExpression(DEMO_SUITE_IDS[0]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toBe("@smoke");

    // Close the loop: the demo feature actually carries the tag the Smoke suite
    // selects, so the suite is non-empty on a fresh install.
    const feature = parseFeature(DEMO_FEATURE_CONTENT, FEATURE_PATH);
    expect(feature?.tags).toContain(resolved.value);
  });
});

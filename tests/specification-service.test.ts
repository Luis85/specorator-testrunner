import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import {
  DefaultSpecificationService,
  parseBddgenMissingSteps,
} from "../src/application/services/specification-service";
import { parseFeature } from "../src/application/content/gherkin";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import type { FeatureSpecification } from "../src/domain/entities/specification";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { buildNote } from "../src/shared/utils/frontmatter";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakePrdLookup,
  FakeVaultFileSystem,
  serviceHarness,
  silentLogger,
} from "./fakes";

/** Bddgen stdout with 2 missing steps (matching the real captured format). */
const bddgenTwoMissing = (text1: string, text2: string): string =>
  `Missing step definitions: 2

Given('${text1}', async ({}) => {
  // Step: Given ${text1}
  // From: features/UC-001-open-example-page.feature:13:5
});

When('${text2}', async ({}) => {
  // Step: When ${text2}
  // From: features/UC-001-open-example-page.feature:14:5
});

Use snippets above to create missing steps.
`;

/** Bddgen stdout when there are no missing steps. */
const bddgenNoneMissing = (): string =>
  `BDD generator started
All steps are defined.
`;

const build = (
  dataSeed?: Record<string, unknown>,
  opts?: { activeRunId?: () => string | null },
) => {
  const absoluteFs = new FakeAbsoluteFileSystem();
  const childProcess = new FakeChildProcessRunner();
  const { fs, bus, events, types, settings } = serviceHarness(dataSeed);
  const useCases = new DefaultUseCaseService(settings, fs, bus, silentLogger, new FakePrdLookup());
  const service = new DefaultSpecificationService(
    settings,
    useCases,
    fs,
    bus,
    silentLogger,
    childProcess,
    absoluteFs,
    new DefaultCommandSafetyPolicy(),
    opts?.activeRunId ?? (() => null),
  );
  return { service, useCases, fs, absoluteFs, childProcess, events, types, settings };
};

/** Seeds the fake absolute filesystem so the runner folder appears to exist. */
const seedRunnerFolder = (absoluteFs: FakeAbsoluteFileSystem): void => {
  // Default basePath is "/vault"; default testRunnerPath is ".testrunner"
  absoluteFs.existing.add("/vault/.testrunner");
};

const seedUseCase = (fs: FakeVaultFileSystem, id = "UC-001", title = "Open Example Page") => {
  fs.files.set(
    `Use Cases/${id} ${title}.md`,
    buildNote(
      { type: "use-case", id, title, status: "specified", automation_status: "planned" },
      `# ${id}`,
    ),
  );
};

describe("DefaultSpecificationService.createFromUseCase", () => {
  it("creates a happy-path feature, links it to the UC, and emits events in order", async () => {
    const { service, fs, types } = build();
    seedUseCase(fs);

    const result = await service.createFromUseCase("UC-001");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const path = vp("Specifications/features/UC-001-happy-path.feature");
    expect(result.value.path).toBe(path);
    expect(result.value.useCaseId).toBe("UC-001");
    expect(fs.files.has(path)).toBe(true);

    // UC note rewritten with the new feature appended.
    const note = fs.files.get("Use Cases/UC-001 Open Example Page.md") ?? "";
    expect(note).toContain(path);

    // created is announced as soon as the file exists, then the UC is linked.
    expect(types()).toEqual([
      "specification.created",
      "usecase.updated",
      "specification.linkedToUseCase",
    ]);
  });

  it("uses feature-<n> for a second feature and never overwrites", async () => {
    const { service, fs } = build();
    seedUseCase(fs);

    const first = await service.createFromUseCase("UC-001");
    expect(first.ok).toBe(true);

    const second = await service.createFromUseCase("UC-001");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.path).toBe("Specifications/features/UC-001-feature-2.feature");

    // Re-running with an explicit slug that already exists must not overwrite.
    const dup = await service.createFromUseCase("UC-001", "happy-path");
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("VALIDATION_FAILED");
  });

  it("fails when the Use Case does not exist", async () => {
    const { service } = build();
    const result = await service.createFromUseCase("UC-404");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("still emits specification.created if linking the UC fails after the file is written", async () => {
    const { service, fs, types } = build();
    seedUseCase(fs);
    // The UC note rewrite (useCaseService.update) fails.
    fs.failOn = { path: "Use Cases/UC-001 Open Example Page.md", message: "disk full" };

    const result = await service.createFromUseCase("UC-001");

    expect(result.ok).toBe(false); // the link step failed
    expect(fs.files.has("Specifications/features/UC-001-happy-path.feature")).toBe(true);
    expect(types()).toContain("specification.created");
    expect(types()).not.toContain("specification.linkedToUseCase");
  });
});

describe("DefaultSpecificationService.update", () => {
  it("serialises the feature back to Gherkin and emits specification.updated", async () => {
    const { service, fs, types } = build();
    const spec: FeatureSpecification = {
      path: vp("Specifications/features/UC-002-edit.feature"),
      useCaseId: "UC-002",
      featureName: "Edited",
      tags: ["@regression"],
      scenarios: [
        {
          name: "A scenario",
          tags: ["@wip"],
          steps: [
            { keyword: "Given", text: "a precondition" },
            { keyword: "Then", text: "an outcome" },
          ],
        },
      ],
    };

    const result = await service.update(spec);
    expect(result.ok).toBe(true);

    const written = fs.files.get(spec.path) ?? "";
    expect(written).toContain("@regression");
    expect(written).toContain("Feature: Edited");
    expect(written).toContain("  @wip");
    expect(written).toContain("  Scenario: A scenario");
    expect(written).toContain("    Given a precondition");
    expect(types()).toContain("specification.updated");
  });

  it("round-trips a Background block (not converted into a Scenario)", async () => {
    const { service, fs } = build();
    const source = `Feature: With background

  Background:
    Given I am logged in

  Scenario: S
    When I act
    Then it works
`;
    const path = vp("Specifications/features/UC-003-bg.feature");
    fs.files.set(path, source);

    const parsed = parseFeature(source, path);
    expect(parsed?.background?.map((s) => s.text)).toEqual(["I am logged in"]);
    if (!parsed) return;

    await service.update(parsed);
    const written = fs.files.get(path) ?? "";
    expect(written).toContain("  Background:");
    expect(written).toContain("    Given I am logged in");
    expect(written).not.toContain("Scenario: Background");
  });
});

describe("DefaultSpecificationService.validate", () => {
  it("passes a well-formed feature with a UC prefix", async () => {
    const { service, fs } = build();
    const path = vp("Specifications/features/UC-001-ok.feature");
    fs.files.set(path, "Feature: Ok\n  Scenario: S\n    Given a step\n");

    const result = await service.validate(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valid).toBe(true);
    expect(result.value.errors).toEqual([]);
  });

  it("reports both the orphan prefix and the missing declaration for an unparseable orphan", async () => {
    const { service, fs } = build();
    const path = vp("Specifications/features/not-gherkin.feature");
    fs.files.set(path, "just some text\n");
    const result = await service.validate(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valid).toBe(false);
    const messages = result.value.errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("orphan"))).toBe(true);
    expect(messages).toContain("File does not contain a Feature: declaration.");
  });

  it("flags a whitespace-only feature name (trim semantics, TD-003)", async () => {
    const { service, fs } = build();
    const path = vp("Specifications/features/UC-001-blank-name.feature");
    fs.files.set(path, "Feature:  \n  Scenario: S\n    Given a step\n");
    const result = await service.validate(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valid).toBe(false);
    expect(result.value.errors.map((e) => e.message)).toContain("Feature has no name.");
  });

  it("flags orphan filename, missing scenarios, and stepless scenarios", async () => {
    const { service, fs, events } = build();
    const path = vp("Specifications/features/orphan.feature");
    fs.files.set(path, "Feature: Lonely\n  Scenario: Empty\n");

    const result = await service.validate(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valid).toBe(false);
    const messages = result.value.errors.map((e) => e.message).join("\n");
    expect(messages).toContain("orphan");
    expect(messages).toContain('Scenario "Empty" has no steps');

    const event = events.find((e) => e.type === "specification.validation.completed");
    expect(event).toBeDefined();
  });

  it("flags a file with no Feature declaration", async () => {
    const { service, fs } = build();
    const path = vp("Specifications/features/UC-001-bad.feature");
    fs.files.set(path, "not gherkin at all\n");

    const result = await service.validate(path);
    expect(result.ok && result.value.valid).toBe(false);
    if (result.ok) {
      expect(result.value.errors.some((e) => e.message.includes("Feature:"))).toBe(true);
    }
  });

  it("returns an error when the feature file is missing", async () => {
    const { service } = build();
    const result = await service.validate(vp("Specifications/features/UC-001-nope.feature"));
    expect(result.ok).toBe(false);
  });
});

describe("DefaultSpecificationService.listFeatures", () => {
  it("lists only .feature files under the feature-files folder, recursively", async () => {
    const { service, fs } = build();
    fs.files.set("Specifications/features/UC-001-happy-path.feature", "Feature: A\n");
    fs.files.set("Specifications/features/auth/UC-002-login.feature", "Feature: B\n");
    fs.files.set("Specifications/features/notes.md", "not a feature");
    fs.files.set("Use Cases/UC-001 Something.md", "outside the folder");

    const result = await service.listFeatures();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        path: "Specifications/features/UC-001-happy-path.feature",
        label: "UC-001-happy-path.feature",
      },
      {
        path: "Specifications/features/auth/UC-002-login.feature",
        label: "auth/UC-002-login.feature",
      },
    ]);
  });

  it("labels strip exactly the folder prefix and keep the port's order (no sorting)", async () => {
    const { service, fs } = build();
    // Seed deliberately out of lexicographic order; the fake lists in insertion
    // order and listFeatures must preserve it.
    fs.files.set("Specifications/features/z-last.feature", "Feature: Z\n");
    fs.files.set("Specifications/features/a-first.feature", "Feature: A\n");

    const result = await service.listFeatures();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((f) => f.label)).toEqual(["z-last.feature", "a-first.feature"]);
  });

  it("returns an empty list when no Feature files exist", async () => {
    const { service } = build();
    const result = await service.listFeatures();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("propagates a listing failure from the vault port", async () => {
    const { service, fs } = build();
    fs.listFilesRecursive = async () => ({
      ok: false,
      error: { code: "INIT_FAILED", message: "vault unavailable" },
    });

    const result = await service.listFeatures();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("vault unavailable");
  });
});

describe("DefaultSpecificationService.announceUpdated", () => {
  it("publishes specification.updated without writing any file", async () => {
    const { service, fs, events, types } = build();
    const spec = parseFeature(
      "Feature: F\n\n  Scenario: S\n    Given x\n",
      vp("Specifications/features/UC-001-x.feature"),
    );
    expect(spec).not.toBeNull();
    if (!spec) return;

    await service.announceUpdated(spec);

    expect(fs.files.size).toBe(0);
    expect(types()).toEqual(["specification.updated"]);
    expect(events[0].payload).toEqual({
      featurePath: "Specifications/features/UC-001-x.feature",
      scenarioCount: 1,
      tags: [],
    });
  });
});

describe("DefaultSpecificationService.listStepPatterns", () => {
  it("scrapes patterns from .testrunner/src/steps/**/*.ts", async () => {
    const { service, fs } = build();
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      'import { Given } from "@cucumber/cucumber";\nGiven("I open the local example page", async function () {});\n',
    );
    fs.files.set(".testrunner/src/steps/readme.md", 'Given("not scraped — not a .ts file")');

    const patterns = await service.listStepPatterns();

    expect(patterns).toEqual([{ kind: "expression", source: "I open the local example page" }]);
  });

  it("returns an empty list when the steps folder does not exist", async () => {
    const { service } = build();
    const patterns = await service.listStepPatterns();
    expect(patterns).toEqual([]);
  });

  it("stays scoped to src/steps even when other runner src files exist (Fix 1 — the #77 cache widened to the whole src tree, this did not)", async () => {
    const { service, fs } = build();
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      'import { Given } from "@cucumber/cucumber";\nGiven("I open the local example page", async function () {});\n',
    );
    // A pattern-shaped string OUTSIDE src/steps must NOT be scraped — this
    // pins listStepPatterns' public contract as unchanged by Fix 1 (which
    // widened only the #77 cache's sources, not the static-pattern scrape).
    fs.files.set(
      ".testrunner/src/pages/ExamplePage.ts",
      'Given("a pattern that must not be scraped", async () => {});',
    );

    const patterns = await service.listStepPatterns();

    expect(patterns).toEqual([{ kind: "expression", source: "I open the local example page" }]);
  });
});

describe("DefaultSpecificationService.allStepsDefined", () => {
  const FEATURE = vp("Specifications/features/UC-001-happy-path.feature");
  const ONE_STEP = "Feature: Happy\n  Scenario: S\n    Given a step\n";
  const defineStep = (fs: FakeVaultFileSystem, expression: string): void => {
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      `import { Given } from "@cucumber/cucumber";\nGiven("${expression}", async function () {});\n`,
    );
  };

  /**
   * Arranges a Feature step bddgen can resolve but the static matcher can't
   * (Cucumber's optional syntax "colou?r" is a documented static-matcher
   * limitation, step-definitions.ts — the "?" is escaped as a literal
   * character, so the bare "I have a colour" step never matches it
   * statically, though bddgen, the real cucumber-expression engine, resolves
   * it fine), then runs `detect` once — the state the #77 cache tests below
   * start from (one reads the recorded verdict as-is, the others invalidate
   * it and check the static fallback).
   */
  const detectColourFeature = async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    fs.files.set(FEATURE, "Feature: Colour\n  Scenario: S\n    Given I have a colour\n");
    defineStep(fs, "I have a colou?r");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());
    const detected = await service.detectMissingSteps(FEATURE);
    return { service, fs, detected };
  };

  /**
   * Seeds the runner folder + a "nothing missing" bddgen stdout, detects once
   * for an already-arranged `path`, and asserts the resulting cache hit — the
   * shared pre-edit baseline the Examples-row and page-object invalidation
   * tests below both edit away from.
   */
  const detectAndAssertCacheHit = async (
    service: Awaited<ReturnType<typeof build>>["service"],
    absoluteFs: FakeAbsoluteFileSystem,
    childProcess: FakeChildProcessRunner,
    path: VaultPath,
  ): Promise<void> => {
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());
    const detected = await service.detectMissingSteps(path);
    expect(detected.ok).toBe(true);
    expect(await service.allStepsDefined([path])).toBe(true); // cache hit, pre-edit
  };

  it("returns false for an empty Feature set (nothing proven)", async () => {
    const { service, fs } = build();
    defineStep(fs, "a step");
    expect(await service.allStepsDefined([])).toBe(false);
  });

  it("is true when every Gherkin step has a matching step definition", async () => {
    const { service, fs } = build();
    fs.files.set(FEATURE, ONE_STEP);
    defineStep(fs, "a step");
    expect(await service.allStepsDefined([FEATURE])).toBe(true);
  });

  it("is false when a step has no matching definition", async () => {
    const { service, fs } = build();
    fs.files.set(FEATURE, ONE_STEP);
    defineStep(fs, "a totally different step");
    expect(await service.allStepsDefined([FEATURE])).toBe(false);
  });

  it("is false when there are no step definitions at all", async () => {
    const { service, fs } = build();
    fs.files.set(FEATURE, ONE_STEP);
    expect(await service.allStepsDefined([FEATURE])).toBe(false);
  });

  it("is false when a Feature is unreadable (coverage can't be proven)", async () => {
    const { service, fs } = build();
    defineStep(fs, "a step");
    // FEATURE was never written to the fake fs.
    expect(await service.allStepsDefined([FEATURE])).toBe(false);
  });

  it("is false when the Features declare no steps", async () => {
    const { service, fs } = build();
    fs.files.set(FEATURE, "Feature: Empty\n  Scenario: S\n");
    defineStep(fs, "a step");
    expect(await service.allStepsDefined([FEATURE])).toBe(false);
  });

  it("requires EVERY Feature's steps across the set to be defined", async () => {
    const { service, fs } = build();
    const other = vp("Specifications/features/UC-001-second.feature");
    fs.files.set(FEATURE, ONE_STEP);
    fs.files.set(other, "Feature: Second\n  Scenario: S\n    Given another step\n");
    defineStep(fs, "a step"); // covers FEATURE but not `another step`
    expect(await service.allStepsDefined([FEATURE, other])).toBe(false);
  });

  it("allStepsDefined serves the bddgen verdict after a detect (cache hit)", async () => {
    const { service, detected } = await detectColourFeature();
    expect(detected.ok).toBe(true);
    if (detected.ok) expect(detected.value.missingSteps).toEqual([]);

    // The detect recorded covered=true; the static heuristic (which would say
    // false here) is now overridden by the recorded bddgen verdict.
    expect(await service.allStepsDefined([FEATURE])).toBe(true);
  });

  it("authoritative false overrides a static true (Task 4 review — mutation-verified gap)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    fs.files.set(FEATURE, ONE_STEP); // "Given a step" — static alone WOULD say true
    defineStep(fs, "a step"); // exact static match
    seedRunnerFolder(absoluteFs);
    // bddgen disagrees with the static heuristic: reports THIS step missing.
    childProcess.stdouts.set(
      "playwright-bdd",
      bddgenTwoMissing("a step", "a step from a different feature"),
    );

    const detected = await service.detectMissingSteps(FEATURE);
    expect(detected.ok).toBe(true);
    if (detected.ok) expect(detected.value.missingSteps).toEqual(["a step"]);

    // The recorded covered=false must override what static alone would say
    // (true) — pins that the authoritative branch short-circuits BEFORE the
    // static fallback, in both directions, and that covered=false is actually
    // recorded (not just covered=true).
    expect(await service.allStepsDefined([FEATURE])).toBe(false);
  });

  it("allStepsDefined falls back to static after the feature changes (hash miss)", async () => {
    const { service, fs, detected } = await detectColourFeature();
    expect(detected.ok).toBe(true);

    // Rewrite the feature, adding a step with no definition at all — the step
    // texts no longer hash-match the recorded cache entry, so the recorded
    // verdict is no longer served and the static heuristic (which reports
    // BOTH steps undefined) takes back over.
    fs.files.set(
      FEATURE,
      "Feature: Colour\n  Scenario: S\n    Given I have a colour\n    When something undefined happens\n",
    );

    expect(await service.allStepsDefined([FEATURE])).toBe(false);
  });

  it("falls back to static after a scrape-invisible edit to the step-definitions file (Codex P2 on PR #102)", async () => {
    const { service, fs, detected } = await detectColourFeature();
    expect(detected.ok).toBe(true);
    expect(await service.allStepsDefined([FEATURE])).toBe(true); // cache hit, pre-edit

    // Append a comment to the step-definitions file: the scraper is blind to
    // it, so the SCRAPED pattern set is unchanged — but spec D6 digests the
    // RAW bytes, not the scraped patterns.
    const stepsFile = ".testrunner/src/steps/demo.steps.ts";
    const current = fs.files.get(stepsFile) ?? "";
    fs.files.set(stepsFile, `${current}\n// a harmless comment\n`);

    // Raw-source addressing catches the edit and falls back to static, which
    // (for this colou?r fixture) has always reported the step undefined.
    expect(await service.allStepsDefined([FEATURE])).toBe(false);
  });

  it("an Examples-row edit invalidates a recorded outline verdict end-to-end (Codex P2 on PR #102)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-outline.feature");
    const outline = (value: string): string =>
      `Feature: Outline
  Scenario Outline: S
    Given I have a <colour>

    Examples:
      | colour |
      | ${value} |
`;
    fs.files.set(path, outline("red"));
    // Same "bddgen resolves it, static can't" asymmetry as the colou?r
    // fixture: the outline placeholder substitutes to a wildcard sentinel
    // that a literal, "?"-containing pattern never matches, so static reports
    // the step undefined REGARDLESS of the Examples value — only the recorded
    // bddgen verdict can say "covered" here.
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      'import { Given } from "@cucumber/cucumber";\nGiven("I have a colou?r", async function () {});\n',
    );
    await detectAndAssertCacheHit(service, absoluteFs, childProcess, path);

    // Edit ONLY the Examples row value — the step TEMPLATE ("I have a
    // <colour>") is byte-for-byte unchanged elsewhere, so a template-only key
    // would still hit; bddgen would now evaluate a DIFFERENT pickle ("I have
    // a blue").
    fs.files.set(path, outline("blue"));

    // Raw-byte addressing (spec D6) catches the Examples-row edit and falls
    // back to static, which (deterministically, for this fixture) reports the
    // step undefined — the safe direction, never the stale recorded "true".
    expect(await service.allStepsDefined([path])).toBe(false);
  });

  it("falls back to static after a page object a step source imports is edited — whole runner src tree digest, not just src/steps (Codex P2 on PR #102, Fix 1)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-colour.feature");
    const pageObjectFile = ".testrunner/src/pages/ExamplePage.ts";
    fs.files.set(path, "Feature: Colour\n  Scenario: S\n    Given I have a colour\n");
    // The default generated runner's own shape: a steps file importing a
    // sibling page object via `../pages` (runner-templates.ts). Same
    // "bddgen resolves it, static can't" colou?r asymmetry as
    // detectColourFeature, so a fallback to static is observable.
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      'import { ExamplePage } from "../pages/ExamplePage";\nimport { Given } from "@cucumber/cucumber";\nGiven("I have a colou?r", async function () {});\n',
    );
    fs.files.set(pageObjectFile, "export class ExamplePage {}\n");
    await detectAndAssertCacheHit(service, absoluteFs, childProcess, path);

    // Edit ONLY the page object the steps file imports — the steps file's own
    // bytes (and hence the scraped pattern set the static fallback reads) are
    // byte-for-byte untouched.
    fs.files.set(pageObjectFile, "export class ExamplePage { extra = true; }\n");

    // A src/steps-only digest would still hit here (the steps file didn't
    // change); the whole-runner-src-tree digest (spec D6, Fix 1) catches the
    // page-object edit and falls back to static, which — for this colou?r
    // fixture — reports the step undefined (the safe direction).
    expect(await service.allStepsDefined([path])).toBe(false);
  });

  it("loads settings exactly ONCE per allStepsDefined call, regardless of feature count (Codex P2, settings TOCTOU)", async () => {
    const { service, fs, settings } = build();
    const other = vp("Specifications/features/UC-001-second.feature");
    fs.files.set(FEATURE, ONE_STEP);
    fs.files.set(other, "Feature: Second\n  Scenario: S\n    Given a step\n");
    defineStep(fs, "a step");

    let loadCount = 0;
    const originalLoad = settings.load.bind(settings);
    settings.load = async () => {
      loadCount += 1;
      return originalLoad();
    };

    // Per-feature reads use `this.fs` directly (no settings involved); the
    // ONE settings load derives the sources snapshot, shared across BOTH
    // features rather than reloaded per feature.
    expect(await service.allStepsDefined([FEATURE, other])).toBe(true);
    expect(loadCount).toBe(1);
  });
});

describe("parseBddgenMissingSteps", () => {
  it("extracts two missing step texts from the real bddgen format", () => {
    const stdout = `Missing step definitions: 2

Given('a totally undefined step', async ({}) => {
  // Step: Given a totally undefined step
  // From: features/UC-001-open-example-page.feature:13:5
});

When('I do something unmapped', async ({}) => {
  // Step: When I do something unmapped
  // From: features/UC-001-open-example-page.feature:14:5
});

Use snippets above to create missing steps.
`;
    expect(parseBddgenMissingSteps(stdout)).toEqual([
      "a totally undefined step",
      "I do something unmapped",
    ]);
  });

  it("returns an empty array when there are no missing steps", () => {
    const stdout = `BDD generator started\nAll steps are defined.\n`;
    expect(parseBddgenMissingSteps(stdout)).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseBddgenMissingSteps("")).toEqual([]);
  });

  it("handles double-quoted step arguments in addition to single-quoted", () => {
    const stdout = `Missing step definitions: 1\n\nThen("an outcome step", async ({}) => {});\n`;
    expect(parseBddgenMissingSteps(stdout)).toEqual(["an outcome step"]);
  });

  it("returns an empty array for malformed output that has the header but no snippets", () => {
    const stdout = `Missing step definitions: 0\n\nUse snippets above to create missing steps.\n`;
    expect(parseBddgenMissingSteps(stdout)).toEqual([]);
  });

  it("unescapes an escaped quote in a step text so it matches the raw feature (codex P2)", () => {
    // For `Given I can't log in`, bddgen emits the JS literal `'I can\'t log in'`.
    // The escaped quote must not terminate the capture, and the backslash must be
    // stripped so the result equals the feature's raw `I can't log in`.
    const stdout = `Missing step definitions: 1\n\nGiven('I can\\'t log in', async ({}) => {});\n`;
    expect(parseBddgenMissingSteps(stdout)).toEqual(["I can't log in"]);
  });
});

describe("DefaultSpecificationService.detectMissingSteps", () => {
  it("refuses while a run is active so bddgen can't regenerate the live run's specs (codex P2)", async () => {
    // bddgen rewrites `.features-gen` in the shared runner cwd; running it
    // during a live `playwright test` would replace the specs that run reads.
    const { service, fs, absoluteFs, childProcess } = build(undefined, {
      activeRunId: () => "RUN-2026-06-13-120000",
    });
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RUN_IN_PROGRESS");
    expect(result.error.details?.activeRunId).toBe("RUN-2026-06-13-120000");
    // bddgen must never have been spawned — refusal precedes the diagnostic.
    expect(childProcess.calls).toHaveLength(0);
  });

  it("bddgen reports two missing steps → returns only the steps in THIS feature", async () => {
    const { service, fs, absoluteFs, childProcess, types } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(
      path,
      `Feature: Demo
  Scenario: S
    Given a totally undefined step
    When I do something unmapped
    Then I open the local example page
`,
    );
    seedRunnerFolder(absoluteFs);
    // Two of the three steps are "missing" according to bddgen.
    childProcess.stdouts.set(
      "playwright-bdd",
      bddgenTwoMissing("a totally undefined step", "I do something unmapped"),
    );

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.featurePath).toBe(path);
    expect(result.value.missingSteps).toEqual([
      "a totally undefined step",
      "I do something unmapped",
    ]);
    expect(result.value.detectionEventId).toBeTruthy();
    expect(types()).toContain("specification.missingSteps.detected");
  });

  it("matches a bddgen {string} expression back to the feature's quoted step (codex P1)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    // The feature step carries a quoted literal; bddgen prints the cucumber
    // EXPRESSION ({string}), which an exact compare would never match.
    fs.files.set(path, 'Feature: Demo\n  Scenario: S\n    Given I set header for "test"\n');
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set(
      "playwright-bdd",
      bddgenTwoMissing("I set header for {string}", "a step from a different feature"),
    );

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The RAW feature step is returned (the stub generator parameterizes it),
    // and the unrelated other-feature expression is filtered out.
    expect(result.value.missingSteps).toEqual(['I set header for "test"']);
  });

  it("invokes bddgen via the playwright-bdd v9 entrypoint (dist/cli/index.js)", async () => {
    // playwright-bdd v9's `bddgen` bin is `dist/cli/index.js`; the non-existent
    // `dist/cli.js` would crash node and make detection always report
    // RUNNER_NOT_INSTALLED. (The fake matches by the "playwright-bdd" substring,
    // so this asserts the exact argv.)
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());

    await service.detectMissingSteps(path);

    const bddgenCall = childProcess.calls.find((c) =>
      c.args.some((a) => a.includes("playwright-bdd")),
    );
    expect(bddgenCall?.args).toEqual(["node", "node_modules/playwright-bdd/dist/cli/index.js"]);
  });

  it("scopes detection's bddgen to the selected feature via BDD_FEATURES (codex P2)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());

    await service.detectMissingSteps(path);

    const bddgenCall = childProcess.calls.find((c) =>
      c.args.some((a) => a.includes("playwright-bdd")),
    );
    // Runner-relative path → bddgen parses only this feature, not the whole vault.
    expect(bddgenCall?.env?.BDD_FEATURES).toBe("../Specifications/features/UC-001-demo.feature");
    // BDD_TAGS is cleared so an ambient tag filter can't make bddgen skip steps
    // and under-report what's missing (codex P2).
    expect(bddgenCall?.env?.BDD_TAGS).toBe("");
  });

  it("preserves a nested subfolder segment in detection's BDD_FEATURES (codex P2)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/auth/UC-009-login.feature");
    fs.files.set(path, "Feature: Login\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());

    await service.detectMissingSteps(path);

    const bddgenCall = childProcess.calls.find((c) =>
      c.args.some((a) => a.includes("playwright-bdd")),
    );
    // The `auth/` segment must survive — a `.pop()` basename would scope bddgen
    // to the wrong (or no) feature.
    expect(bddgenCall?.env?.BDD_FEATURES).toBe(
      "../Specifications/features/auth/UC-009-login.feature",
    );
  });

  it("runs bddgen with the configured Node executable, not a hard-coded `node`", async () => {
    // A user whose bare `node` is off PATH sets runner.nodeExecutable; bddgen
    // must use it (the runner is launched/validated with the same executable).
    const { service, fs, absoluteFs, childProcess } = build({
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, nodeExecutable: "/opt/managed/node" },
    });
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());

    await service.detectMissingSteps(path);

    const bddgenCall = childProcess.calls.find((c) =>
      c.args.some((a) => a.includes("playwright-bdd")),
    );
    expect(bddgenCall?.args).toEqual([
      "/opt/managed/node",
      "node_modules/playwright-bdd/dist/cli/index.js",
    ]);
  });

  it("rejects a non-node executable before spawning bddgen (codex P2)", async () => {
    // `runner.nodeExecutable` accepts any absolute path (settings sanitisation
    // only blocks control chars/`..`/relative-with-separators), so detection
    // must screen the basename against the ADR-0010 allowlist — a synced
    // `/bin/rm` would otherwise be spawned with the bddgen path as its argument.
    const { service, fs, absoluteFs, childProcess } = build({
      ...DEFAULT_SETTINGS,
      runner: { ...DEFAULT_SETTINGS.runner, nodeExecutable: "/bin/rm" },
    });
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COMMAND_DISALLOWED");
    // The dangerous program must never have been spawned.
    expect(childProcess.calls).toHaveLength(0);
  });

  it("returns a step whose text contains an apostrophe bddgen escaped (codex P2)", async () => {
    // End-to-end: bddgen escapes the quote in its snippet; detection must
    // unescape it so the raw feature step `I can't log in` is matched and kept.
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given I can't log in\n");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set(
      "playwright-bdd",
      `Missing step definitions: 1\n\nGiven('I can\\'t log in', async ({}) => {});\n`,
    );

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.missingSteps).toEqual(["I can't log in"]);
  });

  it("bddgen reports no missing steps → empty missingSteps, event still published", async () => {
    const { service, fs, absoluteFs, childProcess, types } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.missingSteps).toEqual([]);
    expect(types()).toContain("specification.missingSteps.detected");
  });

  it("runner not installed (folder absent) → returns RUNNER_NOT_INSTALLED error", async () => {
    const { service, fs } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    // absoluteFs.existing is empty — runner folder does not exist.

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUNNER_NOT_INSTALLED");
  });

  it("spawn fails (run returns err) → returns RUNNER_NOT_INSTALLED error", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.spawnFailures.add("playwright-bdd");

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUNNER_NOT_INSTALLED");
  });

  it("bddgen exits non-zero with no parseable block → returns RUNNER_NOT_INSTALLED", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    seedRunnerFolder(absoluteFs);
    childProcess.exitCodes.set("playwright-bdd", 1);
    // No "Missing step definitions:" header in the output.
    childProcess.stdouts.set("playwright-bdd", "Error: config not found\n");

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUNNER_NOT_INSTALLED");
  });

  it("bddgen lists a step from another feature — filtered out (per-feature contract)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given my own step\n");
    seedRunnerFolder(absoluteFs);
    // bddgen reports two missing steps, but only one belongs to this feature.
    childProcess.stdouts.set(
      "playwright-bdd",
      bddgenTwoMissing("my own step", "step from another feature"),
    );

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the step in THIS feature is kept; the other-feature step is filtered.
    expect(result.value.missingSteps).toEqual(["my own step"]);
  });

  it("getVaultBasePath fails → returns RUNNER_NOT_INSTALLED", async () => {
    const { service, fs, absoluteFs } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    absoluteFs.basePath = null; // causes getVaultBasePath to fail

    const result = await service.detectMissingSteps(path);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUNNER_NOT_INSTALLED");
  });

  it("fails when the feature does not parse", async () => {
    const { service, fs } = build();
    const path = vp("Specifications/features/UC-001-bad.feature");
    fs.files.set(path, "no feature here\n");
    const result = await service.detectMissingSteps(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("detectMissingSteps with missing steps records covered=false", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a totally undefined step\n");
    seedRunnerFolder(absoluteFs);
    // No step-definitions file is seeded at all, so the static heuristic ALSO
    // reports this step missing — the assertion below holds under either tier.
    childProcess.stdouts.set(
      "playwright-bdd",
      bddgenTwoMissing("a totally undefined step", "a step from a different feature"),
    );

    const detected = await service.detectMissingSteps(path);
    expect(detected.ok).toBe(true);
    if (detected.ok) expect(detected.value.missingSteps).toEqual(["a totally undefined step"]);

    expect(await service.allStepsDefined([path])).toBe(false);
  });

  it("records against the definitions bddgen saw, not a post-spawn edit (TOCTOU)", async () => {
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    const stepsFile = ".testrunner/src/steps/demo.steps.ts";
    fs.files.set(path, "Feature: Colour\n  Scenario: S\n    Given I have a colour\n");
    // Same "bddgen resolves it, the static matcher can't" fixture as the
    // allStepsDefined cache-hit test.
    fs.files.set(
      stepsFile,
      'import { Given } from "@cucumber/cucumber";\nGiven("I have a colou?r", async function () {});\n',
    );
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());
    // Simulate an external edit to the step-definitions file happening DURING
    // the bddgen window: by the time the spawn resolves, the file is gone.
    const originalRun = childProcess.run.bind(childProcess);
    childProcess.run = async (request) => {
      const result = await originalRun(request);
      fs.files.delete(stepsFile);
      return result;
    };

    const detected = await service.detectMissingSteps(path);
    expect(detected.ok).toBe(true);

    // The steps file vanishing mid-spawn means the post-spawn runner-sources
    // re-read (item H) no longer matches what was captured pre-spawn, so the
    // spawn-window gate skips the record entirely — no stale verdict is ever
    // stored. allStepsDefined then finds no cache entry and falls back to the
    // static heuristic, which reports the step undefined (no patterns are
    // left at all either way).
    expect(await service.allStepsDefined([path])).toBe(false);
  });

  /**
   * Arranges the shared spawn-window TOCTOU scenario: seeds the runner
   * folder, has bddgen report "a step" missing (disagreeing with what the
   * ORIGINAL, not-yet-mutated content matches), then wraps `childProcess.run`
   * so its OWN spawn resolution is immediately followed by an external write
   * of `mutatedContent` to `mutatedPath` — simulating an edit landing DURING
   * the bddgen window. Shared by the feature-side (item B) and source-side
   * (item H) tests below, which differ only in WHICH file this arms.
   */
  const armEditDuringSpawn = (
    absoluteFs: FakeAbsoluteFileSystem,
    childProcess: FakeChildProcessRunner,
    fs: FakeVaultFileSystem,
    mutatedPath: string,
    mutatedContent: string,
  ): void => {
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set(
      "playwright-bdd",
      bddgenTwoMissing("a step", "a step from a different feature"),
    );
    const originalRun = childProcess.run.bind(childProcess);
    childProcess.run = async (request) => {
      const result = await originalRun(request);
      fs.files.set(mutatedPath, mutatedContent);
      return result;
    };
  };

  it("skips the record when the FEATURE is edited mid-spawn — a later revert must not serve a stale verdict (spawn-window TOCTOU, feature side, Codex P2 on PR #102)", async () => {
    // This specifically isolates the spawn-window GATE from the (already-
    // covered-elsewhere) plain "the file changed and stays changed" case,
    // where the #77 raw-byte featureHash alone would miss on its own at
    // CONSULT time regardless of the gate. The gate's OWN job is the
    // "edited during the spawn, then reverted to the ORIGINAL bytes before
    // the next consult" case: without it, detectMissingSteps would record
    // covered=false (bddgen's verdict for the transiently-edited content)
    // keyed on the ORIGINAL content's hash — and the later revert would then
    // hash-MATCH that wrongly-stored entry and serve the stale false. bddgen
    // (hypothetically evaluating a transiently-edited version of the file
    // during the spawn) reports "a step" missing — even though the ORIGINAL
    // content's "a step" exactly matches the definition (static alone would
    // say true for `original`).
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    const original = "Feature: Demo\n  Scenario: S\n    Given a step\n";
    fs.files.set(path, original);
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      'import { Given } from "@cucumber/cucumber";\nGiven("a step", async function () {});\n',
    );
    armEditDuringSpawn(absoluteFs, childProcess, fs, path, `${original}    When something new\n`);

    const detected = await service.detectMissingSteps(path);
    expect(detected.ok).toBe(true);

    // The edit is undone AFTER detect returns (e.g. an editor autosave raced
    // the spawn and then reconciled) — the file is back to `original`.
    fs.files.set(path, original);

    // With the gate, no entry was ever stored (the post-spawn read did not
    // match `original` at the time detectMissingSteps checked), so this
    // falls back to static, which — for this exact-match fixture — says true.
    expect(await service.allStepsDefined([path])).toBe(true);
  });

  it("skips the record when a RUNNER SOURCE is edited mid-spawn — a later revert must not serve a stale verdict (spawn-window TOCTOU, source side, Codex P2 on PR #102, item H)", async () => {
    // The exact mirror of the feature-side test above, using the SAME
    // edit-lands-then-reverts protocol: without the gate, detectMissingSteps
    // would record bddgen's verdict for the transiently-edited SOURCE keyed
    // on the ORIGINAL source's hash — and the later revert would then
    // hash-MATCH that wrongly-stored entry and serve the stale verdict.
    // bddgen (hypothetically evaluating a transiently-edited version of the
    // steps file during the spawn) reports "a step" missing — even though the
    // ORIGINAL steps file's pattern exactly matches (static alone would say
    // true for the original source).
    const { service, fs, absoluteFs, childProcess } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    const stepsFile = ".testrunner/src/steps/demo.steps.ts";
    const originalStepFile =
      'import { Given } from "@cucumber/cucumber";\nGiven("a step", async function () {});\n';
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    fs.files.set(stepsFile, originalStepFile);
    armEditDuringSpawn(
      absoluteFs,
      childProcess,
      fs,
      stepsFile,
      `${originalStepFile}// mid-spawn edit\n`,
    );

    const detected = await service.detectMissingSteps(path);
    expect(detected.ok).toBe(true);

    // The edit is undone AFTER detect returns — the steps file is back to
    // `originalStepFile`.
    fs.files.set(stepsFile, originalStepFile);

    // With the gate, no entry was ever stored (the post-spawn sources digest
    // did not match `sourcesAtSpawn` at the time detectMissingSteps checked),
    // so this falls back to static, which — for this exact-match fixture —
    // says true.
    expect(await service.allStepsDefined([path])).toBe(true);
  });

  it("loads settings exactly ONCE for the whole detect — a later settings change cannot poison the recorded verdict (Codex P2, settings TOCTOU)", async () => {
    const { service, fs, absoluteFs, childProcess, settings } = build();
    const path = vp("Specifications/features/UC-001-demo.feature");
    fs.files.set(path, "Feature: Demo\n  Scenario: S\n    Given a step\n");
    fs.files.set(
      ".testrunner/src/steps/demo.steps.ts",
      'import { Given } from "@cucumber/cucumber";\nGiven("a step", async function () {});\n',
    );
    seedRunnerFolder(absoluteFs);
    childProcess.stdouts.set("playwright-bdd", bddgenNoneMissing());

    let loadCount = 0;
    const originalLoad = settings.load.bind(settings);
    settings.load = async () => {
      loadCount += 1;
      return originalLoad();
    };

    const detected = await service.detectMissingSteps(path);
    expect(detected.ok).toBe(true);
    // Exactly ONE settings.load() for the whole detect: cwd/BDD_FEATURES
    // resolution AND the sources snapshot both come from the SAME loaded
    // settings — nothing re-loads mid-detect and could observe an edit.
    expect(loadCount).toBe(1);

    // Confirms the snapshot was actually usable: a subsequent allStepsDefined
    // (its own fresh, but here unchanged, load) still hits the recorded
    // verdict computed from that one snapshot.
    expect(await service.allStepsDefined([path])).toBe(true);
  });
});

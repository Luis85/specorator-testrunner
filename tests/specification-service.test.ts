import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import {
  DefaultSpecificationService,
  parseBddgenMissingSteps,
} from "../src/application/services/specification-service";
import { parseFeature } from "../src/application/content/gherkin";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import type { FeatureSpecification } from "../src/domain/entities/specification";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { buildNote } from "../src/shared/utils/frontmatter";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
  FakePrdLookup,
  FakeVaultFileSystem,
  recordingEventBus,
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
  const fs = new FakeVaultFileSystem();
  const absoluteFs = new FakeAbsoluteFileSystem();
  const childProcess = new FakeChildProcessRunner();
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(dataSeed),
    new DefaultPathSafetyPolicy(),
    bus,
  );
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
  return { service, useCases, fs, absoluteFs, childProcess, events, types };
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

    const result = await service.listStepPatterns();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ kind: "expression", source: "I open the local example page" }]);
  });

  it("returns an empty list when the steps folder does not exist", async () => {
    const { service } = build();
    const result = await service.listStepPatterns();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
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
});

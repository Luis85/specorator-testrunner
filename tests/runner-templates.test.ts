import { describe, expect, it } from "vitest";
import {
  REQUIRED_RUNNER_FILES,
  VALIDATED_RUNNER_FILES,
} from "../src/application/content/runner-manifest";
import { buildRunnerTemplates } from "../src/infrastructure/runner/templates/runner-templates";
import { DEFAULT_SETTINGS, type TestHubSettings } from "../src/domain/settings/settings";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";

const templates = buildRunnerTemplates(DEFAULT_SETTINGS);
// Key by plain string so lookups can use bare path literals (t.path is a VaultPath).
const byPath = new Map<string, (typeof templates)[number]>(templates.map((t) => [t.path, t]));

const configFor = (settings: TestHubSettings): string =>
  buildRunnerTemplates(settings).find((t) => t.path === "playwright.config.ts")?.content ?? "";

describe("buildRunnerTemplates", () => {
  it("includes the files US-010 requires", () => {
    for (const file of REQUIRED_RUNNER_FILES) {
      expect(byPath.has(file), file).toBe(true);
    }
  });

  it("validates only files the generator actually emits (manifest/template lockstep)", () => {
    // VALIDATED_RUNNER_FILES (app manifest) is asserted against the .testrunner
    // on disk; every entry must be a path buildRunnerTemplates (infra) emits, or
    // validation would check for a file that is never generated. Guards the
    // cross-layer split introduced by P3-7 against silent drift.
    for (const file of VALIDATED_RUNNER_FILES) {
      expect(byPath.has(file), file).toBe(true);
    }
  });

  it("generates a playwright.config.ts with the json reporter and skipAttachments:false", () => {
    const config = byPath.get("playwright.config.ts")?.content ?? "";
    expect(config).not.toBe("");
    expect(config).toContain("skipAttachments: false");
    expect(config).toContain('cucumberReporter("json"');
    expect(config).toContain("reports/cucumber-report.json");
  });

  it("no longer generates the V1 cucumber-js files", () => {
    const paths = buildRunnerTemplates(DEFAULT_SETTINGS).map((f) => f.path);
    expect(paths).not.toContain("cucumber.mjs");
    expect(paths).not.toContain("src/support/world.ts");
    expect(paths).not.toContain("src/support/hooks.ts");
    expect(paths).toContain("playwright.config.ts");
  });

  it("package.json runs bddgen before playwright test and depends on playwright-bdd", () => {
    const parsed = JSON.parse(byPath.get("package.json")?.content ?? "{}") as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(parsed.scripts["test:ci"]).toContain("bddgen");
    expect(parsed.scripts["test:ci"]).toContain("playwright test");
    expect(parsed.devDependencies["playwright-bdd"]).toBeDefined();
    expect(parsed.devDependencies["@cucumber/cucumber"]).toBeUndefined();
  });

  it("the example steps file uses createBdd fixtures, not a Cucumber World", () => {
    const steps = byPath.get("src/steps/example.steps.ts")?.content ?? "";
    expect(steps).not.toBe("");
    expect(steps).toContain("createBdd");
    expect(steps).toContain("{ page }");
    expect(steps).not.toContain("@cucumber/cucumber");
    expect(steps).not.toContain("TestWorld");
    // POM demo coherence: steps must drive the page through ExamplePage, not
    // call page.goto/click directly — the generated ExamplePage must be used.
    expect(steps).toContain('from "../pages/ExamplePage"');
    expect(steps).toContain("ExamplePage");
  });

  it("fixture page carries the Guided Tour greeting form", () => {
    const fixture = byPath.get("src/fixtures/example.html");
    expect(fixture).toBeDefined();
    // overwrite: true — the greeting form reaches existing installs via repair.
    expect(fixture?.overwrite).toBe(true);
    for (const marker of ['id="name"', 'id="greet"', 'id="greeting"', "Hello, "]) {
      expect(fixture?.content).toContain(marker);
    }
  });

  it("derives the feature glob from configured runner and feature folders", () => {
    const config = configFor({
      ...DEFAULT_SETTINGS,
      paths: {
        ...DEFAULT_SETTINGS.paths,
        testRunnerPath: vp("Tools/.testrunner"),
        featureFilesPath: vp("Specs/features"),
      },
    });
    expect(config).toContain("../../Specs/features/**/*.feature");
  });

  it("playwright.config.ts uses defineBddConfig with the correct steps glob", () => {
    const config = configFor(DEFAULT_SETTINGS);
    expect(config).toContain("defineBddConfig");
    expect(config).toContain("src/steps/**/*.ts");
  });

  it("playwright.config.ts includes chromium project and screenshot/trace settings", () => {
    const config = configFor(DEFAULT_SETTINGS);
    expect(config).toContain("chromium");
    expect(config).toContain("only-on-failure");
    expect(config).toContain("retain-on-failure");
  });

  it("registers playwright install chromium scripts (AD-2, AD-5)", () => {
    const pkg = byPath.get("package.json")?.content ?? "";
    expect(pkg).toContain('"test:smoke"');
    expect(pkg).toContain('"test:ci"');
    expect(pkg).toContain("playwright install chromium");
  });

  it("builds cross-platform fixture URLs with pathToFileURL", () => {
    const paths = byPath.get("src/support/paths.ts")?.content ?? "";
    expect(paths).toContain("pathToFileURL");
    expect(paths).not.toContain("`file://${");
  });

  it("preserves user-authored steps and page objects on repair", () => {
    expect(byPath.get("src/steps/example.steps.ts")?.overwrite).toBe(false);
    expect(byPath.get("src/pages/ExamplePage.ts")?.overwrite).toBe(false);
  });

  it("treats managed config/support files as overwritable", () => {
    expect(byPath.get("package.json")?.overwrite).toBe(true);
    expect(byPath.get("playwright.config.ts")?.overwrite).toBe(true);
  });

  it("escapes a hostile feature path into a safe JS string literal (P0-1 defence-in-depth)", () => {
    // Even if PathSafetyPolicy were bypassed and a break-out payload reached the
    // generator, JSON.stringify must keep the features glob a single, fully-escaped
    // string literal so the generated module Node loads cannot execute injected code.
    const hostile = 'features"]};import("node:child_process").execSync("calc");//';
    const config = configFor({
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, featureFilesPath: vp(hostile) },
    });
    // The embedded quote that would close the literal must be backslash-escaped
    // (JSON.stringify) so it can't break out — i.e. `"` only ever appears as `\"`.
    expect(config).toContain('\\"]};import(');
    // The breakout sequence survived as inert STRING DATA inside the literal.
    expect(config).toContain('"]};import(');
  });

  it("generates testrunner-manifest.json carrying the current manifest version", () => {
    const files = buildRunnerTemplates(DEFAULT_SETTINGS);
    const manifest = files.find((f) => f.path === "testrunner-manifest.json");
    expect(manifest).toBeDefined();
    expect(JSON.parse(manifest?.content ?? "{}")).toEqual({ manifestVersion: 2 });
  });

  it("ExamplePage uses Playwright Page import, not Cucumber World", () => {
    const page = byPath.get("src/pages/ExamplePage.ts")?.content ?? "";
    expect(page).toContain("@playwright/test");
    expect(page).not.toContain("@cucumber/cucumber");
    expect(page).not.toContain("TestWorld");
  });
});

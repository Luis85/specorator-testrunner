import { describe, expect, it } from "vitest";
import {
  buildRunnerTemplates,
  REQUIRED_RUNNER_FILES,
} from "../src/application/content/runner-templates";
import { DEFAULT_SETTINGS, type TestHubSettings } from "../src/domain/settings/settings";

const templates = buildRunnerTemplates(DEFAULT_SETTINGS);
const byPath = new Map(templates.map((t) => [t.path, t]));

const cucumberFor = (settings: TestHubSettings): string =>
  buildRunnerTemplates(settings).find((t) => t.path === "cucumber.mjs")?.content ?? "";

describe("buildRunnerTemplates", () => {
  it("includes the files US-010 requires", () => {
    for (const file of REQUIRED_RUNNER_FILES) {
      expect(byPath.has(file), file).toBe(true);
    }
  });

  it("does NOT generate playwright.config.ts (TIS §11)", () => {
    expect(byPath.has("playwright.config.ts")).toBe(false);
  });

  it("ships a serial cucumber config with the tsx loader (AD-6, AD-7)", () => {
    const cucumber = byPath.get("cucumber.mjs");
    expect(cucumber?.content).toContain("parallel: 0");
    expect(cucumber?.content).toContain('loader: ["tsx"]');
    expect(cucumber?.content).toContain("../Specifications/features/**/*.feature");
  });

  it("derives the feature glob from configured runner and feature folders", () => {
    expect(
      cucumberFor({
        ...DEFAULT_SETTINGS,
        paths: {
          ...DEFAULT_SETTINGS.paths,
          testRunnerPath: "Tools/.testrunner",
          featureFilesPath: "Specs/features",
        },
      }),
    ).toContain('paths: ["../../Specs/features/**/*.feature"]');
  });

  it("defines the expected npm scripts and chromium-only install (AD-2, AD-5)", () => {
    const pkg = byPath.get("package.json")?.content ?? "";
    expect(pkg).toContain('"test:smoke"');
    expect(pkg).toContain('"test:ci"');
    expect(pkg).toContain("playwright install chromium");
  });

  it("preserves user-authored steps and page objects on repair", () => {
    expect(byPath.get("src/steps/example.steps.ts")?.overwrite).toBe(false);
    expect(byPath.get("src/pages/ExamplePage.ts")?.overwrite).toBe(false);
  });

  it("treats managed config/support files as overwritable", () => {
    expect(byPath.get("package.json")?.overwrite).toBe(true);
    expect(byPath.get("src/support/world.ts")?.overwrite).toBe(true);
  });
});

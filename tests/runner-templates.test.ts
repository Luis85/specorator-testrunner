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

const cucumberFor = (settings: TestHubSettings): string =>
  buildRunnerTemplates(settings).find((t) => t.path === "cucumber.mjs")?.content ?? "";

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

  it("does NOT generate playwright.config.ts (TIS §11)", () => {
    expect(byPath.has("playwright.config.ts")).toBe(false);
  });

  it("ships a serial cucumber config without the deprecated loader hook (AD-6, AD-7)", () => {
    const cucumber = byPath.get("cucumber.mjs");
    expect(cucumber?.content).toContain("parallel: 0");
    expect(cucumber?.content).not.toContain("loader:");
    expect(cucumber?.content).toContain("../Specifications/features/**/*.feature");
  });

  it("derives the feature glob from configured runner and feature folders", () => {
    expect(
      cucumberFor({
        ...DEFAULT_SETTINGS,
        paths: {
          ...DEFAULT_SETTINGS.paths,
          testRunnerPath: vp("Tools/.testrunner"),
          featureFilesPath: vp("Specs/features"),
        },
      }),
    ).toContain('paths: ["../../Specs/features/**/*.feature"]');
  });

  it("registers tsx via `node --import tsx` and pins chromium-only install (AD-2, AD-5, AD-7)", () => {
    const pkg = byPath.get("package.json")?.content ?? "";
    expect(pkg).toContain("node --import tsx");
    expect(pkg).toContain("@cucumber/cucumber/bin/cucumber.js");
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
    expect(byPath.get("src/support/world.ts")?.overwrite).toBe(true);
  });

  it("escapes a hostile feature path into a safe JS string literal (P0-1 defence-in-depth)", () => {
    // Even if PathSafetyPolicy were bypassed and a break-out payload reached the
    // generator, JSON.stringify must keep `paths` a single, fully-escaped string
    // literal so the generated module Node loads cannot execute injected code.
    const hostile = 'features"]};import("node:child_process").execSync("calc");//';
    const cucumber = cucumberFor({
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, featureFilesPath: vp(hostile) },
    });
    // The embedded quote that would close the literal must be backslash-escaped
    // (JSON.stringify) so it can't break out — i.e. `"` only ever appears as `\"`.
    expect(cucumber).toContain('\\"]};import(');
    // The emitted module must still be valid JS that evaluates to a config with
    // a single string `paths` entry — i.e. nothing escaped the literal.
    const config = evalModule(cucumber);
    expect(Array.isArray(config.default.paths)).toBe(true);
    expect(config.default.paths).toHaveLength(1);
    expect(typeof config.default.paths[0]).toBe("string");
    // The breakout sequence survived as inert STRING DATA inside the literal —
    // nothing escaped to module scope (which would have thrown or changed shape).
    expect(config.default.paths[0]).toContain('"]};import(');
  });
});

/** Evaluates the generated `export default { … }` module body in isolation. */
const evalModule = (source: string): { default: { paths: unknown[] } } => {
  const body = source.replace(/^export default/, "return");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(body)() as { default: { paths: unknown[] } };
};

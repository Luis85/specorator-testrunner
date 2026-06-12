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

  it("fixture page carries the Guided Tour greeting form", () => {
    const fixture = byPath.get("src/fixtures/example.html");
    expect(fixture).toBeDefined();
    // overwrite: true — the greeting form reaches existing installs via repair.
    expect(fixture?.overwrite).toBe(true);
    for (const marker of ['id="name"', 'id="greet"', 'id="greeting"', "Hello, "]) {
      expect(fixture?.content).toContain(marker);
    }
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
    expect(Array.isArray(config.paths)).toBe(true);
    expect(config.paths).toHaveLength(1);
    expect(typeof config.paths[0]).toBe("string");
    // The breakout sequence survived as inert STRING DATA inside the literal —
    // nothing escaped to module scope (which would have thrown or changed shape).
    expect(config.paths[0]).toContain('"]};import(');
  });

  it("exports the options DIRECTLY (no profile wrapper) so Cucumber's ESM loader reads them", () => {
    // REGRESSION (testvault demo run): `export default { default: {…} }` — the
    // CJS profile-keyed idiom — is NOT unwrapped for an ESM default export, so
    // Cucumber silently ignored the whole config: step imports never loaded
    // (every demo step "Undefined") and the json report was never written.
    const config = evalModule(cucumberFor(DEFAULT_SETTINGS));
    expect(config).not.toHaveProperty("default");
    expect(config.import).toEqual(["src/support/**/*.ts", "src/steps/**/*.ts"]);
    expect(config.paths).toEqual(["../Specifications/features/**/*.feature"]);
    expect(config.format).toContain("json:reports/cucumber-report.json");
  });

  it("emits a `scoped` named export with no paths (used by --profile scoped to avoid merge warning)", () => {
    // The `scoped` profile is selected by scoped runs (feature/use-case) so
    // the config `paths` glob does not merge with the CLI paths and produce a
    // deprecation warning in the Test Console.
    const source = cucumberFor(DEFAULT_SETTINGS);
    expect(source).toContain("export const scoped");
    // The scoped export must NOT carry paths — the whole point is to let the
    // CLI paths be the sole source.
    const scoped = evalScopedExport(source);
    expect(scoped).not.toHaveProperty("paths");
    // But it must keep the import globs and format so step definitions load
    // and the JSON report is written.
    expect(scoped.import).toEqual(["src/support/**/*.ts", "src/steps/**/*.ts"]);
    expect(scoped.format).toContain("json:reports/cucumber-report.json");
  });

  it("hooks template sets a 60 s cucumber timeout before the Before hook", () => {
    const hooks = byPath.get("src/support/hooks.ts")?.content ?? "";
    expect(hooks).toContain("setDefaultTimeout(60_000)");
    // Must be imported alongside the hook lifecycle exports.
    expect(hooks).toContain("setDefaultTimeout");
    // The setDefaultTimeout call must appear BEFORE the Before hook registration.
    const timeoutIdx = hooks.indexOf("setDefaultTimeout(60_000)");
    const beforeIdx = hooks.indexOf("Before(");
    expect(timeoutIdx).toBeGreaterThan(-1);
    expect(timeoutIdx).toBeLessThan(beforeIdx);
  });
});

/** Evaluates the generated `export default { … }` module body in isolation. */
const evalModule = (
  source: string,
): { paths: unknown[]; import?: unknown[]; format?: unknown[] } => {
  // Strip ES module export keywords so the source runs inside a plain function body:
  //   export default { … }  → return { … }
  //   export const foo = …  → const foo = …  (named profile exports, dead after return)
  const body = source
    .replace(/^export default\b/m, "return")
    .replace(/^export const /gm, "const ")
    .replace(/^\/\/.*$/gm, "");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(body)() as { paths: unknown[]; import?: unknown[]; format?: unknown[] };
};

/**
 * Evaluates the generated `export const scoped = { … }` expression and
 * returns the value of the `scoped` binding.
 */
const evalScopedExport = (
  source: string,
): { paths?: unknown[]; import?: unknown[]; format?: unknown[] } => {
  // Strip the default export line entirely, then turn `export const scoped = …`
  // into a return so new Function can evaluate it.
  const body = source
    .replace(/^export default\b[^\n]*/m, "")
    .replace(/^export const scoped\s*=/m, "return")
    .replace(/^export const /gm, "const ")
    .replace(/^\/\/.*$/gm, "");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(body)() as { paths?: unknown[]; import?: unknown[]; format?: unknown[] };
};

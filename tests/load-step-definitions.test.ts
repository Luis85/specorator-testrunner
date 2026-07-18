import { describe, expect, it } from "vitest";
import {
  loadRunnerCoverageSources,
  loadStepDefinitions,
} from "../src/application/services/load-step-definitions";
import type { VaultFileSystem } from "../src/application/ports/vault-file-system";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { err, ok, type Result } from "../src/shared/result/result";

type FsSlice = Pick<VaultFileSystem, "listFilesRecursive" | "readFile">;

const STEPS = vp(".testrunner/src/steps");

/**
 * Minimal fs stub: `listing` is the recursive-listing result, `files` maps a
 * path to its contents. A listed path absent from `files` reads as an
 * unreadable file (the FakeVaultFileSystem can't fail a listing, which is one of
 * the branches under test).
 */
const stubFs = (listing: Result<VaultPath[]>, files: Record<string, string> = {}): FsSlice => ({
  listFilesRecursive: async () => listing,
  readFile: async (path) =>
    path in files
      ? ok(files[path])
      : err({ code: "RUNNER_MISSING_FILE", message: `missing ${path}` }),
});

describe("loadStepDefinitions", () => {
  it("returns no definitions when the steps folder can't be listed", async () => {
    const fs = stubFs(err({ code: "RUNNER_MISSING_FILE", message: "no steps folder" }));
    expect(await loadStepDefinitions(fs, STEPS)).toEqual([]);
  });

  it("scrapes patterns only from readable .ts files, skipping the rest", async () => {
    const a = vp(`${STEPS}/a.ts`);
    const notTs = vp(`${STEPS}/readme.md`);
    const unreadable = vp(`${STEPS}/b.ts`);
    const fs = stubFs(ok([a, notTs, unreadable]), {
      [a]: 'Given("a step", async () => {});',
      // A non-.ts file is never read; its step-shaped content must not leak in.
      [notTs]: 'Given("ignored, not a .ts file", async () => {});',
      // `unreadable` is listed but absent from files → readFile fails → skipped.
    });
    expect(await loadStepDefinitions(fs, STEPS)).toEqual([
      { kind: "expression", source: "a step" },
    ]);
  });

  it("aggregates patterns across every readable steps file", async () => {
    const a = vp(`${STEPS}/a.ts`);
    const b = vp(`${STEPS}/nested/b.ts`);
    const fs = stubFs(ok([a, b]), {
      [a]: 'Given("first", async () => {});',
      [b]: 'When("second", async () => {});',
    });
    expect(await loadStepDefinitions(fs, STEPS)).toEqual([
      { kind: "expression", source: "first" },
      { kind: "expression", source: "second" },
    ]);
  });
});

describe("loadRunnerCoverageSources", () => {
  const RUNNER = vp(".testrunner");

  it("returns null when the src-dir LISTING itself fails — distinct from a genuinely empty tree (WS1: abstain on listing failure, Codex P2)", async () => {
    const fs = stubFs(err({ code: "RUNNER_MISSING_FILE", message: "src listing failed" }));

    expect(await loadRunnerCoverageSources(fs, RUNNER)).toBeNull();
  });

  it("returns an empty array, NOT null, when the src dir lists cleanly with zero files (a listing failure must not be conflated with a legitimately empty tree)", async () => {
    const fs = stubFs(ok([]));

    expect(await loadRunnerCoverageSources(fs, RUNNER)).toEqual([]);
  });

  it("includes the runner-root playwright.config.ts alongside the whole src tree (Codex P2, closes the outermost digest ring)", async () => {
    const a = vp(".testrunner/src/steps/a.ts");
    const config = vp(".testrunner/playwright.config.ts");
    const fs = stubFs(ok([a]), {
      [a]: 'Given("a step", async () => {});',
      [config]: 'const testDir = defineBddConfig({ features: "x" });',
    });

    const sources = await loadRunnerCoverageSources(fs, RUNNER);

    expect(sources).toEqual([
      { path: a, content: 'Given("a step", async () => {});' },
      { path: config, content: 'const testDir = defineBddConfig({ features: "x" });' },
    ]);
  });

  it("skips the config file, best-effort, when the runner hasn't been initialized yet", async () => {
    const a = vp(".testrunner/src/steps/a.ts");
    const fs = stubFs(ok([a]), { [a]: 'Given("a step", async () => {});' });
    // No playwright.config.ts in `files` → readFile fails → skipped, the same
    // best-effort treatment as any other unreadable source file.
    const sources = await loadRunnerCoverageSources(fs, RUNNER);

    expect(sources).toEqual([{ path: a, content: 'Given("a step", async () => {});' }]);
  });

  it("includes the runner-root tsconfig.json alongside playwright.config.ts and the whole src tree (Codex P2s — paths aliases/module resolution are also a bddgen input)", async () => {
    const a = vp(".testrunner/src/steps/a.ts");
    const config = vp(".testrunner/playwright.config.ts");
    const tsconfig = vp(".testrunner/tsconfig.json");
    const fs = stubFs(ok([a]), {
      [a]: 'Given("a step", async () => {});',
      [config]: 'const testDir = defineBddConfig({ features: "x" });',
      [tsconfig]: '{ "compilerOptions": { "paths": { "@steps/*": ["src/steps/*"] } } }',
    });

    const sources = await loadRunnerCoverageSources(fs, RUNNER);

    expect(sources).toEqual([
      { path: a, content: 'Given("a step", async () => {});' },
      { path: config, content: 'const testDir = defineBddConfig({ features: "x" });' },
      {
        path: tsconfig,
        content: '{ "compilerOptions": { "paths": { "@steps/*": ["src/steps/*"] } } }',
      },
    ]);
  });

  it("skips tsconfig.json, best-effort, when it doesn't exist yet — independently of playwright.config.ts", async () => {
    const a = vp(".testrunner/src/steps/a.ts");
    const config = vp(".testrunner/playwright.config.ts");
    const fs = stubFs(ok([a]), {
      [a]: 'Given("a step", async () => {});',
      [config]: 'const testDir = defineBddConfig({ features: "x" });',
      // No tsconfig.json in `files` → readFile fails → skipped, the same
      // best-effort treatment as playwright.config.ts above — and the config
      // file being present must not affect this independent skip.
    });

    const sources = await loadRunnerCoverageSources(fs, RUNNER);

    expect(sources).toEqual([
      { path: a, content: 'Given("a step", async () => {});' },
      { path: config, content: 'const testDir = defineBddConfig({ features: "x" });' },
    ]);
  });
});

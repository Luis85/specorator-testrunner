import { describe, expect, it } from "vitest";
import { loadStepDefinitions } from "../src/application/services/load-step-definitions";
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

import { describe, expect, it } from "vitest";
import {
  playwrightBrowsersCandidates,
  resolveRunnerCwd,
} from "../src/application/services/runner-paths";
import { FakeAbsoluteFileSystem } from "./fakes";

describe("resolveRunnerCwd", () => {
  it("joins the vault base path with the runner path", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = "/home/u/vault";
    const result = await resolveRunnerCwd(fs, ".testrunner");
    expect(result.ok && result.value).toBe("/home/u/vault/.testrunner");
  });

  it("trims a trailing separator on the base path", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = "/vault/";
    const result = await resolveRunnerCwd(fs, ".testrunner");
    expect(result.ok && result.value).toBe("/vault/.testrunner");
  });

  it("propagates a missing base path as an error", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = null;
    expect((await resolveRunnerCwd(fs, ".testrunner")).ok).toBe(false);
  });
});

describe("playwrightBrowsersCandidates", () => {
  it("prefers an explicit PLAYWRIGHT_BROWSERS_PATH", () => {
    expect(playwrightBrowsersCandidates("linux", { PLAYWRIGHT_BROWSERS_PATH: "/pw" })).toEqual([
      "/pw",
    ]);
  });

  it("uses the runner-local hermetic path for PLAYWRIGHT_BROWSERS_PATH=0", () => {
    const out = playwrightBrowsersCandidates(
      "linux",
      { PLAYWRIGHT_BROWSERS_PATH: "0", HOME: "/home/u" },
      "/vault/.testrunner",
    );
    expect(out).toEqual(["/vault/.testrunner/node_modules/playwright-core/.local-browsers"]);
  });

  it("returns nothing for hermetic mode when the runner path is unknown", () => {
    expect(playwrightBrowsersCandidates("linux", { PLAYWRIGHT_BROWSERS_PATH: "0" })).toEqual([]);
  });

  it("uses platform-specific cache locations", () => {
    expect(playwrightBrowsersCandidates("darwin", { HOME: "/Users/u" })).toEqual([
      "/Users/u/Library/Caches/ms-playwright",
    ]);
    expect(playwrightBrowsersCandidates("win32", { USERPROFILE: "C:\\Users\\u" })).toEqual([
      "C:\\Users\\u\\AppData\\Local\\ms-playwright",
    ]);
  });

  it("returns nothing when no home directory is known", () => {
    expect(playwrightBrowsersCandidates("linux", {})).toEqual([]);
  });
});

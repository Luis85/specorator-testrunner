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

  it("ignores PLAYWRIGHT_BROWSERS_PATH=0", () => {
    const out = playwrightBrowsersCandidates("linux", {
      PLAYWRIGHT_BROWSERS_PATH: "0",
      HOME: "/home/u",
    });
    expect(out).toEqual(["/home/u/.cache/ms-playwright"]);
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

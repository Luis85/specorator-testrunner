import { describe, expect, it } from "vitest";
import { runnerHistoryFilePath } from "../src/application/services/runner-history-path";
import type { SettingsService } from "../src/application/services/settings-service";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { FakeAbsoluteFileSystem } from "./fakes";

const settingsWith = (testRunnerPath: string): SettingsService =>
  ({
    async load() {
      return {
        ...DEFAULT_SETTINGS,
        paths: { ...DEFAULT_SETTINGS.paths, testRunnerPath: vp(testRunnerPath) },
      };
    },
  }) as unknown as SettingsService;

describe("runnerHistoryFilePath", () => {
  it("joins vault base, runner path, history, and file name", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = "/vault";

    const path = await runnerHistoryFilePath(fs, settingsWith(".testrunner"), "execution-log.json");

    expect(path).toBe("/vault/.testrunner/history/execution-log.json");
  });

  it("normalizes a trailing separator on the base path (no double slash)", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = "/vault/";

    const path = await runnerHistoryFilePath(
      fs,
      settingsWith(".testrunner"),
      "scenario-index.json",
    );

    expect(path).toBe("/vault/.testrunner/history/scenario-index.json");
  });

  it("returns undefined when the vault base path is unavailable (non-desktop)", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = null;

    const path = await runnerHistoryFilePath(fs, settingsWith(".testrunner"), "execution-log.json");

    expect(path).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import {
  collectCredentialValues,
  DEFAULT_SETTINGS,
} from "../src/domain/settings/settings";
import { FakeDataStore, recordingEventBus, silentLogger } from "./fakes";

const makeService = (initial?: unknown) => {
  const store = new FakeDataStore(initial);
  const { bus, types } = recordingEventBus();
  const logger = { ...silentLogger, error: vi.fn() };
  const service = new DefaultSettingsService(
    store,
    new DefaultPathSafetyPolicy(),
    bus,
    logger,
  );
  return { service, store, types, logger };
};

describe("DefaultSettingsService", () => {
  it("returns defaults when nothing is stored", async () => {
    const { service } = makeService(undefined);
    expect(await service.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges stored values over defaults section-by-section", async () => {
    const { service } = makeService({ logging: { level: "debug" } });
    const loaded = await service.load();
    expect(loaded.logging.level).toBe("debug");
    expect(loaded.logging.path).toBe(DEFAULT_SETTINGS.logging.path); // default preserved
    expect(loaded.paths).toEqual(DEFAULT_SETTINGS.paths);
  });

  it("persists and emits settings.updated on valid save", async () => {
    const { service, store, types } = makeService();
    const result = await service.save(DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(types()).toContain("settings.updated");
  });

  it("refuses to save settings with an unsafe path", async () => {
    const { service, store } = makeService();
    const invalid = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, useCasesPath: "../escape" },
    };
    const result = await service.save(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SETTINGS_INVALID");
    expect(await store.load()).toBeUndefined(); // nothing persisted
  });

  it("flags an active environment that is not defined", async () => {
    const { service } = makeService();
    const invalid = {
      ...DEFAULT_SETTINGS,
      sut: { active: "ghost", environments: DEFAULT_SETTINGS.sut.environments },
    };
    const validation = await service.validate(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.field === "sut.active")).toBe(true);
  });

  it("sanitizes an unsafe stored path on load, falling back to the default and logging (P0-1)", async () => {
    // A tampered/synced data.json carries a template-injection payload that
    // must never reach the cucumber.mjs generator.
    const hostile = 'features"]};import("node:child_process").execSync("calc");//';
    const { service, logger } = makeService({
      paths: { ...DEFAULT_SETTINGS.paths, featureFilesPath: hostile },
    });
    const loaded = await service.load();
    expect(loaded.paths.featureFilesPath).toBe(DEFAULT_SETTINGS.paths.featureFilesPath);
    expect(logger.error).toHaveBeenCalled();
  });

  it("falls back an unsafe logging.path on load (P0-1)", async () => {
    const { service } = makeService({ logging: { path: "../../etc/log" } });
    const loaded = await service.load();
    expect(loaded.logging.path).toBe(DEFAULT_SETTINGS.logging.path);
  });

  it("collectCredentialValues gathers non-empty auth.env values across environments (P0-2)", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      sut: {
        active: "demo",
        environments: {
          demo: { baseUrl: "http://x", auth: { env: { VAR_A: "fixture-value-one", EMPTY: "" } } },
          staging: { baseUrl: "http://y", auth: { env: { VAR_B: "fixture-value-two" } } },
          noauth: { baseUrl: "http://z" },
        },
      },
    };
    const values = collectCredentialValues(settings);
    expect(values).toContain("fixture-value-one");
    expect(values).toContain("fixture-value-two");
    expect(values).not.toContain("");
  });

  it("reset restores defaults and emits settings.reset", async () => {
    const { service, store, types } = makeService({ logging: { level: "debug" } });
    const result = await service.reset();
    expect(result.ok).toBe(true);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(types()).toContain("settings.reset");
  });
});

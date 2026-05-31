import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { FakeDataStore, recordingEventBus } from "./fakes";

const makeService = (initial?: unknown) => {
  const store = new FakeDataStore(initial);
  const { bus, types } = recordingEventBus();
  const service = new DefaultSettingsService(store, new DefaultPathSafetyPolicy(), bus);
  return { service, store, types };
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

  it("reset restores defaults and emits settings.reset", async () => {
    const { service, store, types } = makeService({ logging: { level: "debug" } });
    const result = await service.reset();
    expect(result.ok).toBe(true);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(types()).toContain("settings.reset");
  });
});

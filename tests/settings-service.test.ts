import { describe, expect, it, vi } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { collectCredentialValues, DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { FakeDataStore, recordingEventBus, silentLogger } from "./fakes";

const makeService = (initial?: unknown) => {
  const store = new FakeDataStore(initial);
  const { bus, types, events } = recordingEventBus();
  const logger = { ...silentLogger, error: vi.fn() };
  const service = new DefaultSettingsService(store, new DefaultPathSafetyPolicy(), bus, logger);
  return { service, store, types, events, logger };
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

  it("settings.updated carries the real changedFields diff (Event Catalog §13)", async () => {
    const { service, events } = makeService();
    const updated = {
      ...DEFAULT_SETTINGS,
      logging: { ...DEFAULT_SETTINGS.logging, level: "debug" as const },
    };
    await service.save(updated);
    const event = events.find((e) => e.type === "settings.updated");
    expect(event?.payload).toEqual({ changedFields: ["logging.level"] });
  });

  it("settings.updated reports no changedFields when nothing changed", async () => {
    const { service, events } = makeService();
    await service.save(DEFAULT_SETTINGS);
    const event = events.find((e) => e.type === "settings.updated");
    expect(event?.payload).toEqual({ changedFields: [] });
  });

  it("settings.validated emits { valid, warnings: string[] }", async () => {
    const { service, events } = makeService();
    const withEmptyNodeVersion = {
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "" },
    };
    await service.validate(withEmptyNodeVersion);
    const event = events.find((e) => e.type === "settings.validated");
    expect(event?.payload).toMatchObject({ valid: true });
    expect((event?.payload as { warnings: string[] }).warnings.length).toBeGreaterThan(0);
    expect(
      (event?.payload as { warnings: string[] }).warnings.every((w) => typeof w === "string"),
    ).toBe(true);
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

  it("collectCredentialValues gathers credential auth.env values across environments (P0-2)", () => {
    // Synthetic, obviously-fake fixture values (not secret-shaped) — these stand
    // in for SUT credential values; collection is by value, not by key name.
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

  it("collectCredentialValues drops trivially short values so they can't over-redact (M3)", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      sut: {
        active: "demo",
        environments: {
          demo: {
            baseUrl: "http://x",
            auth: { env: { SHORT_FLAG: "ok", SHORT_N: "1", VAR_A: "fixture-value-one" } },
          },
        },
      },
    };
    const values = collectCredentialValues(settings);
    expect(values).not.toContain("ok");
    expect(values).not.toContain("1");
    expect(values).toContain("fixture-value-one");
  });

  it("reset restores defaults and emits settings.reset with { profile: 'default' }", async () => {
    const { service, store, types, events } = makeService({ logging: { level: "debug" } });
    const result = await service.reset();
    expect(result.ok).toBe(true);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(types()).toContain("settings.reset");
    const event = events.find((e) => e.type === "settings.reset");
    expect(event?.payload).toEqual({ profile: "default" });
  });

  it("stamps a supplied correlationId on settings.reset (UC-024 shared reset id)", async () => {
    const { service, events } = makeService();
    await service.reset("RESET-correlation-id");
    const event = events.find((e) => e.type === "settings.reset");
    expect(event?.correlationId).toBe("RESET-correlation-id");
  });
});

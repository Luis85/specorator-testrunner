import { describe, expect, it, vi } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { collectCredentialValues, DEFAULT_SETTINGS } from "../src/domain/settings/settings";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { FakeDataStore, FakeVaultFileSystem, recordingEventBus, silentLogger } from "./fakes";

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

  it("serializes overlapping saves so their load→save sections can't interleave (F2)", async () => {
    // The settings tab debounces saves PER FIELD, so two quick edits produce
    // two overlapping save() calls. Unserialized, both read the same baseline
    // (load, load, save, save) and the diffs/writes interleave; the chain must
    // yield strictly load → save → load → save.
    const order: string[] = [];
    const store = new FakeDataStore();
    const recordingStore = {
      load: () => {
        order.push("load");
        return store.load();
      },
      save: (data: unknown) => {
        order.push("save");
        return store.save(data);
      },
    };
    const { bus } = recordingEventBus();
    const service = new DefaultSettingsService(recordingStore, new DefaultPathSafetyPolicy(), bus);
    const first = service.save({
      ...DEFAULT_SETTINGS,
      logging: { ...DEFAULT_SETTINGS.logging, level: "debug" as const },
    });
    const second = service.save({
      ...DEFAULT_SETTINGS,
      ci: { ...DEFAULT_SETTINGS.ci, nodeVersion: "22" },
    });
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(order).toEqual(["load", "save", "load", "save"]);
  });

  it("surfaces a data-store save failure as an err Result (F2)", async () => {
    const { bus } = recordingEventBus();
    const failingStore = {
      load: async () => undefined,
      save: async () => ({
        ok: false as const,
        error: { code: "SETTINGS_SAVE_FAILED" as const, message: "disk full" },
      }),
    };
    const service = new DefaultSettingsService(failingStore, new DefaultPathSafetyPolicy(), bus);
    const result = await service.save(DEFAULT_SETTINGS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SETTINGS_SAVE_FAILED");
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
      paths: { ...DEFAULT_SETTINGS.paths, useCasesPath: vp("../escape") },
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
      paths: { ...DEFAULT_SETTINGS.paths, featureFilesPath: vp(hostile) },
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

  it("recovers (does not throw) from a NON-STRING persisted path (review P2)", async () => {
    // A corrupt/sync-mangled data.json with a number where a path string belongs
    // must fall back to the default, not crash load with `path.trim is not a function`.
    const { service, logger } = makeService({
      paths: { ...DEFAULT_SETTINGS.paths, featureFilesPath: 42 as unknown as string },
    });
    const loaded = await service.load();
    expect(loaded.paths.featureFilesPath).toBe(DEFAULT_SETTINGS.paths.featureFilesPath);
    expect(logger.error).toHaveBeenCalled();
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

describe("DefaultSettingsService — runner-env hardening (SEC: child-process env sink)", () => {
  // test-execution-service injects `{ BASE_URL: active.baseUrl, ...auth.env }`
  // verbatim into the runner subprocess; these tests pin down that a tampered
  // data.json can't smuggle hostile values through either validate() or load().
  const sutWith = (
    environments: Record<string, { baseUrl: string; auth?: { env: Record<string, string> } }>,
  ) => ({
    ...DEFAULT_SETTINGS,
    sut: { active: "demo", environments },
  });

  describe("validate()", () => {
    it("accepts DEFAULT_SETTINGS with zero errors (demo file:// fixture stays valid)", async () => {
      const { service } = makeService();
      const validation = await service.validate(DEFAULT_SETTINGS);
      expect(validation.errors).toEqual([]);
      expect(validation.valid).toBe(true);
    });

    it.each(["BAD KEY", "1LEADING", "X\nY", "A-B", "$(evil)"])(
      "flags auth.env key %j as an error with the full field path",
      async (key) => {
        const { service } = makeService();
        const settings = sutWith({
          demo: { baseUrl: "http://localhost", auth: { env: { [key]: "fixture-value" } } },
        });
        const validation = await service.validate(settings);
        expect(validation.valid).toBe(false);
        const error = validation.errors.find(
          (e) => e.field === `sut.environments.demo.auth.env.${key}`,
        );
        expect(error?.severity).toBe("error");
      },
    );

    it.each([
      "PATH", // basename hijack: redirects which npm/node the spawn resolves
      "Path", // case-insensitive: Windows env names ignore case
      "NODE_OPTIONS", // --require ./evil.js injects code into the spawned node
      "NODE_PATH",
      "LD_PRELOAD", // native loader injection (Linux)
      "DYLD_INSERT_LIBRARIES", // native loader injection (macOS)
      "npm_config_script_shell", // overrides the shell npm runs scripts with
      "COMSPEC",
      "BASE_URL", // the runner injects BASE_URL from the active environment
      "base_url", // case-insensitive
    ])(
      "flags reserved process-control auth.env key %j as an error (PR #18 review)",
      async (key) => {
        const { service } = makeService();
        const settings = sutWith({
          demo: { baseUrl: "http://localhost", auth: { env: { [key]: "x" } } },
        });
        const validation = await service.validate(settings);
        expect(validation.valid).toBe(false);
        const error = validation.errors.find(
          (e) => e.field === `sut.environments.demo.auth.env.${key}`,
        );
        expect(error?.severity).toBe("error");
        expect(error?.message).toMatch(/reserved process-control/);
      },
    );

    it("does not flag identifier-shaped auth.env keys (GITHUB_ prefix is CI-only, allowed here)", async () => {
      const { service } = makeService();
      const settings = sutWith({
        demo: {
          baseUrl: "http://localhost",
          auth: { env: { VAR_A: "x", _UNDERSCORE: "y", GITHUB_TOKEN_LOCAL: "z" } },
        },
      });
      const validation = await service.validate(settings);
      expect(validation.errors).toEqual([]);
    });

    it.each([
      "http://x\nEVIL=1", // newline could break out of a later text sink
      "http://x\u0000y", // NUL
      "not a url",
      "javascript:alert(1)", // parseable but not an allowed protocol
    ])("flags baseUrl %j as an error", async (baseUrl) => {
      const { service } = makeService();
      const validation = await service.validate(sutWith({ demo: { baseUrl } }));
      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some(
          (e) => e.field === "sut.environments.demo.baseUrl" && e.severity === "error",
        ),
      ).toBe(true);
    });

    it("treats an EMPTY baseUrl as a warning, not an error (incomplete config, not injection)", async () => {
      const { service } = makeService();
      const validation = await service.validate(sutWith({ demo: { baseUrl: "" } }));
      expect(validation.errors).toEqual([]);
      expect(validation.warnings.some((w) => w.field === "sut.environments.demo.baseUrl")).toBe(
        true,
      );
    });

    it.each([
      "../../../usr/bin/node", // POSIX traversal
      "..\\..\\evil\\node", // Windows-style traversal must not slip through on POSIX
      "node\n", // newline
      "no\u0000de", // NUL
      "evil/node", // vault-relative: would spawn a binary synced INTO the vault (PR #18 review)
      "./node", // vault-relative with explicit dot segment
      ".\\tools\\node.exe", // Windows-style vault-relative
    ])("flags runner.nodeExecutable %j as an error", async (nodeExecutable) => {
      const { service } = makeService();
      const settings = {
        ...DEFAULT_SETTINGS,
        runner: { ...DEFAULT_SETTINGS.runner, nodeExecutable },
      };
      const validation = await service.validate(settings);
      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some(
          (e) => e.field === "runner.nodeExecutable" && e.severity === "error",
        ),
      ).toBe(true);
    });

    it.each([
      "node",
      "/usr/local/bin/node",
      "C:\\Program Files\\nodejs\\node.exe",
      "C:/nodejs/node.exe", // forward-slash Windows drive path is still absolute
      "\\\\server\\tools\\node.exe", // UNC share is absolute
    ])(
      "allows nodeExecutable %j (CommandSafetyPolicy governs the basename)",
      async (nodeExecutable) => {
        const { service } = makeService();
        const settings = {
          ...DEFAULT_SETTINGS,
          runner: { ...DEFAULT_SETTINGS.runner, nodeExecutable },
        };
        const validation = await service.validate(settings);
        expect(validation.errors.some((e) => e.field === "runner.nodeExecutable")).toBe(false);
      },
    );
  });

  describe("load() sanitization", () => {
    it("drops a tampered auth.env key but keeps valid siblings, logging the key only", async () => {
      const { service, logger } = makeService({
        sut: {
          active: "demo",
          environments: {
            demo: {
              baseUrl: "http://localhost",
              auth: { env: { "BAD KEY": "fixture-secret-value", VAR_A: "fixture-ok" } },
            },
          },
        },
      });
      const loaded = await service.load();
      const env = loaded.sut.environments.demo.auth?.env ?? {};
      expect(env).toEqual({ VAR_A: "fixture-ok" }); // hostile key gone, sibling intact
      expect(logger.error).toHaveBeenCalled();
      // The dropped entry's VALUE may be a credential and must never be logged.
      const loggedText = JSON.stringify(logger.error.mock.calls);
      expect(loggedText).toContain("BAD KEY");
      expect(loggedText).not.toContain("fixture-secret-value");
    });

    it.each(["1LEADING", "X\nY", "PATH", "NODE_OPTIONS", "LD_PRELOAD", "npm_config_script_shell"])(
      "drops tampered/reserved auth.env key %j on load",
      async (key) => {
        const { service } = makeService({
          sut: {
            active: "demo",
            environments: {
              demo: { baseUrl: "http://localhost", auth: { env: { [key]: "v", SAFE: "s" } } },
            },
          },
        });
        const loaded = await service.load();
        // The reserved/invalid key never reaches the runner env sink; SAFE survives.
        expect(loaded.sut.environments.demo.auth?.env).toEqual({ SAFE: "s" });
      },
    );

    it("leaves valid auth.env entries completely untouched (passthrough)", async () => {
      const { service, logger } = makeService({
        sut: {
          active: "demo",
          environments: {
            demo: {
              baseUrl: "https://example.test",
              auth: { env: { VAR_A: "fixture-one", GITHUB_LOCAL: "fixture-two" } },
            },
          },
        },
      });
      const loaded = await service.load();
      expect(loaded.sut.environments.demo).toEqual({
        baseUrl: "https://example.test",
        auth: { env: { VAR_A: "fixture-one", GITHUB_LOCAL: "fixture-two" } },
      });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("restores the DEFAULT environment's baseUrl when the demo baseUrl was tampered", async () => {
      const { service, logger } = makeService({
        sut: {
          active: "demo",
          environments: { demo: { baseUrl: "http://x\nEVIL=1" } },
        },
      });
      const loaded = await service.load();
      expect(loaded.sut.environments.demo.baseUrl).toBe(
        DEFAULT_SETTINGS.sut.environments.demo.baseUrl,
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("falls back a tampered NON-default environment baseUrl to '' (inert BASE_URL)", async () => {
      const { service } = makeService({
        sut: {
          active: "demo",
          environments: {
            demo: DEFAULT_SETTINGS.sut.environments.demo,
            staging: { baseUrl: "http://y\u0000" },
          },
        },
      });
      const loaded = await service.load();
      expect(loaded.sut.environments.staging.baseUrl).toBe("");
    });

    it.each(["../../../usr/bin/node", "node\n", "evil/node"])(
      "falls back tampered runner.nodeExecutable %j to the default on load",
      async (nodeExecutable) => {
        const { service, logger } = makeService({ runner: { nodeExecutable } });
        const loaded = await service.load();
        expect(loaded.runner.nodeExecutable).toBe(DEFAULT_SETTINGS.runner.nodeExecutable);
        expect(logger.error).toHaveBeenCalled();
      },
    );

    it("loaded (sanitized) settings validate with zero errors — load/validate stay aligned", async () => {
      const { service } = makeService({
        runner: { nodeExecutable: "../escape/node" },
        sut: {
          active: "demo",
          environments: {
            demo: { baseUrl: "http://x\nEVIL=1", auth: { env: { "BAD KEY": "v", OK_VAR: "v" } } },
          },
        },
      });
      const loaded = await service.load();
      const validation = await service.validate(loaded);
      expect(validation.errors).toEqual([]);
    });
  });
});

describe("DefaultSettingsService — ADR-0015 sibling Test Hub detection", () => {
  const makeServiceWithVault = (folders: string[]) => {
    const store = new FakeDataStore();
    const { bus, events } = recordingEventBus();
    const vaultFs = new FakeVaultFileSystem();
    for (const folder of folders) vaultFs.folders.add(folder);
    const service = new DefaultSettingsService(
      store,
      new DefaultPathSafetyPolicy(),
      bus,
      silentLogger,
      vaultFs,
    );
    return { service, events };
  };

  const siblingWarning = (validation: {
    warnings: { message: string; severity: "error" | "warning" }[];
  }) => validation.warnings.find((w) => /more than one Test Hub/i.test(w.message));

  it("is a no-op for a normal single-folder vault", async () => {
    const { service } = makeServiceWithVault(["Test Hub", "Use Cases", "Specifications"]);
    const validation = await service.validate(DEFAULT_SETTINGS);
    expect(siblingWarning(validation)).toBeUndefined();
    expect(validation.valid).toBe(true);
  });

  it("warns (not errors) on a sync-conflict duplicate folder", async () => {
    const { service } = makeServiceWithVault(["Test Hub", "Test Hub 1"]);
    const validation = await service.validate(DEFAULT_SETTINGS);
    const warning = siblingWarning(validation);
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    // A warning must not fail validation — the plugin still loads (ADR-0015).
    expect(validation.valid).toBe(true);
  });

  it("warns on a 'copy'-style duplicate folder", async () => {
    const { service } = makeServiceWithVault(["Test Hub", "Test Hub copy"]);
    const validation = await service.validate(DEFAULT_SETTINGS);
    expect(siblingWarning(validation)).toBeDefined();
  });

  it("does not false-positive on a distinct folder that shares a prefix word", async () => {
    const { service } = makeServiceWithVault(["Test Hub", "Test Hub Notes"]);
    const validation = await service.validate(DEFAULT_SETTINGS);
    expect(siblingWarning(validation)).toBeUndefined();
  });

  it("ignores nested folders that merely contain the name", async () => {
    const { service } = makeServiceWithVault(["Test Hub", "Archive/Test Hub"]);
    const validation = await service.validate(DEFAULT_SETTINGS);
    expect(siblingWarning(validation)).toBeUndefined();
  });

  it("flags a sibling copy beside a RELOCATED (nested) Test Hub (review P2)", async () => {
    // testHubPath relocated to QA/Test Hub; a sync/copy conflict lands in the
    // same parent (QA/Test Hub copy) and must still be flagged.
    const { service } = makeServiceWithVault(["QA/Test Hub", "QA/Test Hub copy"]);
    const settings = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, testHubPath: vp("QA/Test Hub") },
    };
    const validation = await service.validate(settings);
    const warning = siblingWarning(validation);
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("QA/Test Hub copy");
  });

  it("does not flag a same-named copy under a DIFFERENT parent", async () => {
    // "Archive/Test Hub copy" is not a sibling of the configured "QA/Test Hub"
    // (different parent), so it is not a one-project-per-vault conflict here.
    const { service } = makeServiceWithVault(["QA/Test Hub", "Archive/Test Hub copy"]);
    const settings = {
      ...DEFAULT_SETTINGS,
      paths: { ...DEFAULT_SETTINGS.paths, testHubPath: vp("QA/Test Hub") },
    };
    const validation = await service.validate(settings);
    expect(siblingWarning(validation)).toBeUndefined();
  });

  it("names every conflicting folder", async () => {
    const { service } = makeServiceWithVault(["Test Hub", "Test Hub 1", "Test Hub 2"]);
    const validation = await service.validate(DEFAULT_SETTINGS);
    const warning = siblingWarning(validation);
    expect(warning?.message).toContain("Test Hub 1");
    expect(warning?.message).toContain("Test Hub 2");
  });

  it("surfaces the warning text on the settings.validated event", async () => {
    const { service, events } = makeServiceWithVault(["Test Hub", "Test Hub 1"]);
    await service.validate(DEFAULT_SETTINGS);
    const event = events.find((e) => e.type === "settings.validated");
    const warnings = (event?.payload as { warnings: string[] }).warnings;
    expect(warnings.some((w) => /more than one Test Hub/i.test(w))).toBe(true);
  });

  it("is a no-op when no vault access is wired", async () => {
    const store = new FakeDataStore();
    const { bus } = recordingEventBus();
    const service = new DefaultSettingsService(store, new DefaultPathSafetyPolicy(), bus);
    const validation = await service.validate(DEFAULT_SETTINGS);
    expect(siblingWarning(validation)).toBeUndefined();
  });
});

describe("DefaultSettingsService — structural repair of tampered sut shapes", () => {
  // A synced/tampered data.json controls the full JSON shape, not just leaf
  // values: the shallow merge preserves whatever it carries at sut.environments
  // and below. Review finding (2026-06-09 follow-up): `environments: null`
  // crashed load() via Object.entries(null) at plugin startup.

  it("load() survives sut.environments: null and falls back to the defaults", async () => {
    const { service, logger } = makeService({ sut: { environments: null } });
    const loaded = await service.load();
    expect(loaded.sut).toEqual(DEFAULT_SETTINGS.sut);
    expect(logger.error).toHaveBeenCalled();
  });

  it.each([[42], ["text"], [["array"]]])(
    "load() survives non-record sut.environments %j",
    async (environments) => {
      const { service } = makeService({ sut: { environments } });
      const loaded = await service.load();
      expect(loaded.sut).toEqual(DEFAULT_SETTINGS.sut);
    },
  );

  it("load() replaces a non-object default-named environment with its default", async () => {
    const { service, logger } = makeService({
      sut: { active: "demo", environments: { demo: null } },
    });
    const loaded = await service.load();
    expect(loaded.sut.environments.demo).toEqual(DEFAULT_SETTINGS.sut.environments.demo);
    expect(logger.error).toHaveBeenCalled();
  });

  it("load() drops a non-object custom environment but keeps valid siblings", async () => {
    const { service } = makeService({
      sut: {
        active: "staging",
        environments: { staging: { baseUrl: "https://staging.test" }, broken: "junk" },
      },
    });
    const loaded = await service.load();
    expect(loaded.sut.environments).toEqual({ staging: { baseUrl: "https://staging.test" } });
  });

  it("load() treats a non-string baseUrl as a malformed environment", async () => {
    const { service } = makeService({
      sut: { active: "demo", environments: { demo: { baseUrl: 42 } } },
    });
    const loaded = await service.load();
    expect(loaded.sut.environments.demo).toEqual(DEFAULT_SETTINGS.sut.environments.demo);
  });

  it("load() strips a malformed auth section but keeps the environment", async () => {
    const { service } = makeService({
      sut: {
        active: "demo",
        environments: { demo: { baseUrl: "http://localhost", auth: "junk" } },
      },
    });
    const loaded = await service.load();
    expect(loaded.sut.environments.demo).toEqual({ baseUrl: "http://localhost" });
  });

  it("load() drops a non-string auth.env value, logging the key only", async () => {
    const { service, logger } = makeService({
      sut: {
        active: "demo",
        environments: {
          demo: {
            baseUrl: "http://localhost",
            auth: { env: { NUMERIC: 7, SAFE: "fixture-ok" } },
          },
        },
      },
    });
    const loaded = await service.load();
    expect(loaded.sut.environments.demo.auth?.env).toEqual({ SAFE: "fixture-ok" });
    expect(JSON.stringify(logger.error.mock.calls)).toContain("NUMERIC");
  });

  it("load() restores the defaults when every environment is unusable", async () => {
    const { service } = makeService({
      sut: { active: "ghost", environments: { ghost: "junk" } },
    });
    const loaded = await service.load();
    expect(loaded.sut).toEqual(DEFAULT_SETTINGS.sut);
  });

  it.each([
    { prod: { baseUrl: 42 }, staging: { baseUrl: "https://staging.test" } }, // record, bad baseUrl
    { prod: null, staging: { baseUrl: "https://staging.test" } }, // non-record entry
  ])(
    "load() repoints sut.active to a survivor when the repair dropped the active entry (PR #18 review)",
    async (environments) => {
      const { service, logger } = makeService({ sut: { active: "prod", environments } });
      const loaded = await service.load();
      // "prod" existed in data.json but was dropped as malformed; a dangling
      // active would make runEnv() silently execute with an empty env.
      expect(loaded.sut.active).toBe("staging");
      expect(loaded.sut.environments.staging).toEqual({ baseUrl: "https://staging.test" });
      expect(JSON.stringify(logger.error.mock.calls)).toContain("prod");
    },
  );

  it("load() leaves a user-authored dangling sut.active alone for validate() to flag", async () => {
    const { service } = makeService({
      sut: { active: "ghost", environments: { staging: { baseUrl: "https://staging.test" } } },
    });
    const loaded = await service.load();
    // "ghost" never existed in the environments map — that dangle is the
    // user's data, not repair damage, so it is surfaced (settings UI marks it
    // "(missing)") rather than silently rewritten.
    expect(loaded.sut.active).toBe("ghost");
    const validation = await service.validate(loaded);
    expect(validation.errors.some((e) => e.field === "sut.active")).toBe(true);
  });

  it("load() repairs a non-string sut.active to the default", async () => {
    const { service } = makeService({
      sut: { active: 7, environments: { demo: { baseUrl: "http://localhost" } } },
    });
    const loaded = await service.load();
    expect(loaded.sut.active).toBe(DEFAULT_SETTINGS.sut.active);
    expect(loaded.sut.environments.demo).toEqual({ baseUrl: "http://localhost" });
  });

  it("load() repairs a non-string sut.active to a SURVIVING environment when the default is absent", async () => {
    // Coherence: when WE pick the replacement active (the configured one was
    // garbage), it must point at an environment that actually survived repair
    // — not at a dangling default name (review-loop finding).
    const { service } = makeService({
      sut: { active: 7, environments: { staging: { baseUrl: "https://staging.test" } } },
    });
    const loaded = await service.load();
    expect(loaded.sut.active).toBe("staging");
    const validation = await service.validate(loaded);
    expect(validation.errors).toEqual([]);
  });

  it("validate() flags (not crashes on) a pre-repair non-record environments map", async () => {
    const { service } = makeService();
    const settings = {
      ...DEFAULT_SETTINGS,
      sut: { active: "demo", environments: null },
    } as unknown as Parameters<typeof service.validate>[0];
    const validation = await service.validate(settings);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.field === "sut.active")).toBe(true);
  });

  it("validate() flags a non-record environment entry without crashing", async () => {
    const { service } = makeService();
    const settings = {
      ...DEFAULT_SETTINGS,
      sut: { active: "demo", environments: { demo: null } },
    } as unknown as Parameters<typeof service.validate>[0];
    const validation = await service.validate(settings);
    expect(validation.errors.some((e) => e.field === "sut.environments.demo")).toBe(true);
  });

  it("a structurally repaired load() output validates with zero errors", async () => {
    const { service } = makeService({
      sut: {
        active: 7,
        environments: { demo: null, broken: "junk", ok: { baseUrl: "https://x.test" } },
      },
    });
    const loaded = await service.load();
    const validation = await service.validate(loaded);
    expect(validation.errors).toEqual([]);
  });
});

describe("onboarding settings", () => {
  const makeService = (raw: unknown) =>
    new DefaultSettingsService(
      new FakeDataStore(raw),
      new DefaultPathSafetyPolicy(),
      recordingEventBus().bus,
      silentLogger,
    );

  it("defaults the onboarding section when data.json predates the tour", async () => {
    const settings = await makeService(undefined).load();
    expect(settings.onboarding).toEqual({
      tourId: null,
      completedSteps: [],
      skippedSteps: [],
      sequenceProgress: {},
      dismissed: false,
    });
  });

  it("keeps a valid persisted onboarding section", async () => {
    const settings = await makeService({
      onboarding: {
        tourId: "abc",
        completedSteps: ["create-use-case"],
        skippedSteps: ["run-demo"],
        dismissed: true,
      },
    }).load();
    expect(settings.onboarding.tourId).toBe("abc");
    expect(settings.onboarding.completedSteps).toEqual(["create-use-case"]);
    expect(settings.onboarding.skippedSteps).toEqual(["run-demo"]);
    expect(settings.onboarding.dismissed).toBe(true);
  });

  it("repairs a malformed onboarding section to the defaults", async () => {
    const settings = await makeService({
      onboarding: { tourId: 42, completedSteps: "nope", skippedSteps: [7, "x"], dismissed: "yes" },
    }).load();
    expect(settings.onboarding.tourId).toBeNull();
    expect(settings.onboarding.completedSteps).toEqual([]);
    // Non-string entries are dropped; string entries survive structurally.
    expect(settings.onboarding.skippedSteps).toEqual(["x"]);
    expect(settings.onboarding.sequenceProgress).toEqual({});
    expect(settings.onboarding.dismissed).toBe(false);
  });

  it("repairs malformed sequence-progress entries, keeping well-formed ones", async () => {
    const settings = await makeService({
      onboarding: {
        tourId: "abc",
        completedSteps: [],
        skippedSteps: [],
        dismissed: false,
        sequenceProgress: {
          "run-own-test": { index: 1, captured: "tour" },
          "implement-steps": { index: 1, captured: 7 }, // non-string capture dropped from entry
          "bad-index": { index: -1 },
          "not-an-object": "nope",
          fraction: { index: 0.5 },
        },
      },
    }).load();
    expect(settings.onboarding.sequenceProgress).toEqual({
      "run-own-test": { index: 1, captured: "tour" },
      "implement-steps": { index: 1 },
    });
  });
});

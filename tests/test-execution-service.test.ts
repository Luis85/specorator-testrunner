import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultSuiteService } from "../src/application/services/suite-service";
import {
  DefaultTestExecutionService,
  tokenizeCommand,
  type TestExecutionService,
} from "../src/application/services/test-execution-service";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import { buildSuiteNote } from "../src/application/content/default-suites";
import { buildNote } from "../src/shared/utils/frontmatter";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import type { DomainEventType } from "../src/domain/events/domain-event";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
  FakePrdLookup,
  FakeVaultFileSystem,
  recordingEventBus,
  silentLogger,
} from "./fakes";

/** Spins the microtask queue until the single run registers as active. */
const waitForActive = async (service: TestExecutionService): Promise<void> => {
  for (let i = 0; i < 100 && service.activeRunId() === null; i++) {
    await Promise.resolve();
  }
};

const FIXED_NOW = new Date("2026-06-01T10:00:00.000Z");

const build = () => {
  const fs = new FakeVaultFileSystem();
  const { bus, events, types } = recordingEventBus();
  const settings = new DefaultSettingsService(
    new FakeDataStore(),
    new DefaultPathSafetyPolicy(),
    bus,
  );
  const suiteService = new DefaultSuiteService(settings, fs, bus);
  const useCaseService = new DefaultUseCaseService(
    settings,
    fs,
    bus,
    silentLogger,
    new FakePrdLookup(),
  );
  const childProcess = new FakeChildProcessRunner();
  const absoluteFs = new FakeAbsoluteFileSystem();
  const service = new DefaultTestExecutionService(
    settings,
    suiteService,
    useCaseService,
    childProcess,
    absoluteFs,
    new DefaultCommandSafetyPolicy(),
    bus,
    silentLogger,
    () => FIXED_NOW,
  );
  return { service, fs, childProcess, absoluteFs, bus, events, types, settings };
};

/** Seeds a suite so the `suite` scope can resolve a tag expression. */
const seedSuite = (fs: FakeVaultFileSystem, id: string, tagExpression: string): void => {
  fs.files.set(
    `Test Suites/${id}.md`,
    buildSuiteNote({ id, name: id, description: "", tagExpression }),
  );
};

describe("tokenizeCommand", () => {
  it("splits a plain command on whitespace", () => {
    expect(tokenizeCommand("npm run test")).toEqual(["npm", "run", "test"]);
    expect(tokenizeCommand("  npm   run  test  ")).toEqual(["npm", "run", "test"]);
  });

  it("keeps a double-quoted argument with spaces as one token", () => {
    expect(tokenizeCommand('npm run test -- --format "json:reports/cucumber report.json"')).toEqual(
      ["npm", "run", "test", "--", "--format", "json:reports/cucumber report.json"],
    );
  });

  it("keeps single-quoted arguments literal and honors backslash escapes", () => {
    expect(tokenizeCommand("npm run test -- --tags '@a and @b'")).toEqual([
      "npm",
      "run",
      "test",
      "--",
      "--tags",
      "@a and @b",
    ]);
    expect(tokenizeCommand('node -e "a\\"b"')).toEqual(["node", "-e", 'a"b']);
  });

  it("keeps unquoted backslashes literal (Windows paths)", () => {
    expect(tokenizeCommand("npm run test -- --format json:C:\\tmp\\cucumber.json")).toEqual([
      "npm",
      "run",
      "test",
      "--",
      "--format",
      "json:C:\\tmp\\cucumber.json",
    ]);
  });

  it("returns an empty array for a blank command", () => {
    expect(tokenizeCommand("   ")).toEqual([]);
  });
});

describe("DefaultTestExecutionService maintenance lock (security L1 TOCTOU)", () => {
  it("rejects execute() while maintenance holds the lock, reserving no slot", async () => {
    const { service } = build();
    expect(service.maintenanceLock.begin().ok).toBe(true);
    try {
      const result = await service.execute({ scope: "demo", target: "demo" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("MAINTENANCE_IN_PROGRESS");
      // No slot reserved while maintenance is in progress.
      expect(service.activeRunId()).toBeNull();
    } finally {
      service.maintenanceLock.end();
    }
  });

  it("lets a run start once maintenance releases the lock", async () => {
    const { service } = build();
    service.maintenanceLock.begin();
    service.maintenanceLock.end();
    const result = await service.execute({ scope: "demo", target: "demo" });
    expect(result.ok).toBe(true);
  });

  it("begin() refuses (RUN_IN_PROGRESS) while a run is active, no maintenance window", async () => {
    const { service, childProcess } = build();
    childProcess.pending = true; // keep the run in flight
    void service.execute({ scope: "demo", target: "demo" });
    await waitForActive(service);
    expect(service.activeRunId()).not.toBeNull();

    const begin = service.maintenanceLock.begin();
    expect(begin.ok).toBe(false);
    if (!begin.ok) {
      expect(begin.error.code).toBe("RUN_IN_PROGRESS");
      expect(begin.error.details?.activeRunId).toBe(service.activeRunId());
    }
    // The run was never disturbed; maintenance did not acquire the lock.
    expect(service.maintenanceLock.inProgress()).toBe(false);

    childProcess.release();
    await service.whenActiveSettles();
  });

  it("begin() refuses a second concurrent maintenance flow (MAINTENANCE_IN_PROGRESS)", () => {
    const { service } = build();
    expect(service.maintenanceLock.begin().ok).toBe(true);
    const second = service.maintenanceLock.begin();
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("MAINTENANCE_IN_PROGRESS");
    service.maintenanceLock.end();
  });
});

describe("DefaultTestExecutionService", () => {
  it("resolves the demo command and derives passed from exit 0", async () => {
    const { service, childProcess, types } = build();

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.command).toBe("npm run test:smoke");
    expect(result.value.status).toBe("passed");
    expect(result.value.id).toBe("RUN-2026-06-01-100000");
    expect(childProcess.calls[0].args).toEqual(["npm", "run", "test:smoke"]);
    // Scopes the bddgen step inside test:smoke to @smoke so a malformed
    // non-@smoke feature can't fail "Run demo test" during generation.
    expect(childProcess.calls[0].env?.BDD_TAGS).toBe("@smoke");
    expect(types()).toEqual(["testrun.requested", "testrun.started", "testrun.completed"]);
  });

  it("resolves the all command", async () => {
    const { service } = build();
    const result = await service.execute({ scope: "all", target: "all" });
    // Bare-glob branch (no deprecated UCs): no positional feature paths, so the
    // config glob runs unmodified — no scope args appended.
    expect(result.ok && result.value.command).toBe("npm run test");
  });

  it("no scope passes a cucumber --profile arg (playwright-bdd has no profiles)", async () => {
    const { service, childProcess, fs } = build();
    seedSuite(fs, "regression", "@regression");

    await service.execute({ scope: "demo", target: "demo" });
    expect(childProcess.calls[0].args).not.toContain("--profile");

    await service.execute({ scope: "suite", target: "regression" });
    expect(childProcess.calls[1].args).not.toContain("--profile");

    await service.execute({
      scope: "feature",
      target: "Specifications/features/checkout.feature",
    });
    expect(childProcess.calls[2].args).not.toContain("--profile");
  });

  it("clears any prior Cucumber report before running (no stale import)", async () => {
    const { service, absoluteFs } = build();
    const reportPath = "/vault/.testrunner/reports/cucumber-report.json";
    absoluteFs.seed(reportPath, "{ old report }");
    await service.execute({ scope: "demo", target: "demo" });
    expect(await absoluteFs.existsAbsolute(reportPath)).toBe(false);
  });

  it("normalizes snapshot keys when featureFilesPath has a trailing slash (codex P2)", async () => {
    const { service, absoluteFs, settings } = build();
    const current = await settings.load();
    await settings.save({
      ...current,
      paths: { ...current.paths, featureFilesPath: vp("Specifications/features/") },
    });
    // A feature exists under the (trailing-slash) features folder at run start.
    absoluteFs.seed(
      "/vault/Specifications/features/UC-001-login.feature",
      "Feature: F\n  Scenario: Login\n    Given x\n",
    );
    await service.execute({ scope: "demo", target: "demo" });
    const snapPath = "/vault/.testrunner/reports/RUN-2026-06-01-100000.features.json";
    const raw = absoluteFs.written.get(snapPath);
    expect(raw).toBeDefined();
    const keys = Object.keys(JSON.parse(raw ?? "{}"));
    // Key matches what the resolver derives from the report URI — no `//`.
    expect(keys).toContain("Specifications/features/UC-001-login.feature");
    expect(keys.some((k) => k.includes("//"))).toBe(false);
  });

  it("mints unique run ids for sequential runs in the same second", async () => {
    const { service } = build(); // fixed clock → same UTC second every call
    const first = await service.execute({ scope: "demo", target: "demo" });
    const second = await service.execute({ scope: "demo", target: "demo" });
    expect(first.ok && first.value.id).toBe("RUN-2026-06-01-100000");
    expect(second.ok && second.value.id).toBe("RUN-2026-06-01-100000-2");
  });

  it("injects the Active SUT environment (BASE_URL + auth env) into the runner", async () => {
    const { service, childProcess } = build();
    await service.execute({ scope: "demo", target: "demo" });
    // DEFAULT_SETTINGS.sut.active = "demo" → the demo baseUrl.
    expect(childProcess.calls[0].env?.BASE_URL).toBe(
      "file://./.testrunner/src/fixtures/example.html",
    );
  });

  it("rejects a configured run command that is not npm run <script>", async () => {
    const { service, childProcess, settings } = build();
    const current = await settings.load();
    await settings.save({
      ...current,
      runner: { ...current.runner, defaultRunCommand: "npm install" },
    });

    const result = await service.execute({ scope: "all", target: "all" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(childProcess.calls).toHaveLength(0); // never spawned a non-test command
  });

  it("whenActiveSettles resolves immediately when idle and after a run settles", async () => {
    const { service, childProcess } = build();
    // Idle → already settled.
    await service.whenActiveSettles();

    childProcess.pending = true;
    const run = service.execute({ scope: "demo", target: "demo" });
    let settled = false;
    const settles = service.whenActiveSettles().then(() => {
      settled = true;
    });
    // Still running → not settled yet.
    await Promise.resolve();
    expect(settled).toBe(false);

    await service.cancel("RUN-2026-06-01-100000");
    await run;
    await settles;
    expect(settled).toBe(true);
  });

  it("aborts the run when the stale report cannot be cleared", async () => {
    const { service, childProcess, absoluteFs } = build();
    absoluteFs.deleteAbsolute = async () => ({
      ok: false as const,
      error: { code: "INIT_FAILED" as const, message: "report is read-only" },
    });

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok).toBe(false);
    expect(childProcess.calls).toHaveLength(0); // never spawned with a stale report present
  });

  it("does not spawn a process when cancelled during setup (pre-start)", async () => {
    const { service, childProcess, types } = build();
    childProcess.pending = true;

    // Slot is reserved synchronously; cancel before the run reaches runStreaming.
    const run = service.execute({ scope: "demo", target: "demo" });
    const cancelled = await service.cancel("RUN-2026-06-01-100000");
    expect(cancelled.ok).toBe(true);
    await run;

    expect(childProcess.calls).toHaveLength(0); // never spawned
    expect(types()).toContain("testrun.cancelled");
    expect(types()).not.toContain("testrun.started");
  });

  it("does not spawn when cancelled after start events publish but before runStreaming", async () => {
    const { service, childProcess, bus, types } = build();
    childProcess.pending = true;

    // Cancel from inside the testrun.started handler — the bus awaits handlers,
    // so terminated flips true after the start events publish and before spawn.
    const unsubscribe = bus.subscribe("testrun.started", () => {
      void service.cancel("RUN-2026-06-01-100000");
    });
    await service.execute({ scope: "demo", target: "demo" });
    unsubscribe();

    expect(types()).toContain("testrun.started"); // we got past the publishes
    expect(types()).toContain("testrun.cancelled");
    expect(childProcess.calls).toHaveLength(0); // but never spawned the runner
  });

  it("resolves the suite command from the suite's tag expression and emits suite.executed", async () => {
    const { service, childProcess, fs, types } = build();
    seedSuite(fs, "smoke", "@smoke and not @wip");

    const result = await service.execute({ scope: "suite", target: "smoke" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Suite runs use playwright-bdd's native tag mechanism via BDD_TAGS on the
    // spawn env (the generated config reads process.env.BDD_TAGS) — NOT a
    // cucumber `--tags` arg. The base command is otherwise unchanged.
    expect(childProcess.calls[0].args).toEqual(["npm", "run", "test"]);
    expect(childProcess.calls[0].env?.BDD_TAGS).toBe("@smoke and not @wip");
    // The display command stays the bare base — the tag goes through the env.
    expect(result.value.command).toBe("npm run test");
    // suite.executed precedes the terminal event (UC-013).
    expect(types()).toEqual([
      "testrun.requested",
      "testrun.started",
      "suite.executed",
      "testrun.completed",
    ]);
  });

  it("merges BDD_TAGS on top of the Active SUT env (BASE_URL + auth) for suite runs", async () => {
    const { service, childProcess, fs } = build();
    seedSuite(fs, "smoke", "@smoke");
    await service.execute({ scope: "suite", target: "smoke" });
    // The returned suite env is merged with runEnv(settings), not replacing it.
    expect(childProcess.calls[0].env?.BDD_TAGS).toBe("@smoke");
    expect(childProcess.calls[0].env?.BASE_URL).toBe(
      "file://./.testrunner/src/fixtures/example.html",
    );
  });

  it("scopes a feature run to its runner-relative path via BDD_FEATURES", async () => {
    const { service, childProcess } = build();
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/checkout.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The base command is unchanged; the scope rides BDD_FEATURES so bddgen
    // generates ONLY this feature.
    expect(childProcess.calls[0].args).toEqual(["npm", "run", "test"]);
    expect(childProcess.calls[0].env?.BDD_FEATURES).toBe(
      "../Specifications/features/checkout.feature",
    );
    expect(result.value.command).toBe("npm run test");
  });

  it("carries a feature path with $, &, and spaces verbatim in BDD_FEATURES (env, no shell)", async () => {
    const { service, childProcess } = build();
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/R&D Price $5.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The path is an env value passed to the child under shell:false — literal,
    // never interpolated or word-split.
    expect(childProcess.calls[0].args).toEqual(["npm", "run", "test"]);
    expect(childProcess.calls[0].env?.BDD_FEATURES).toBe(
      "../Specifications/features/R&D Price $5.feature",
    );
  });

  it("scopes a feature path with shell metacharacters and runs (no COMMAND_DISALLOWED)", async () => {
    const { service, childProcess } = build();
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/R&D.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("passed");
    expect(childProcess.calls[0].env?.BDD_FEATURES).toBe("../Specifications/features/R&D.feature");
  });

  it("preserves a nested subfolder segment in BDD_FEATURES (not just the basename)", async () => {
    const { service, childProcess } = build();
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/auth/login.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The `auth/` segment must survive — a `.pop()` basename simplification would
    // drop it and bddgen would scope to the wrong (or no) feature.
    expect(childProcess.calls[0].env?.BDD_FEATURES).toBe(
      "../Specifications/features/auth/login.feature",
    );
  });

  it("clears the unowned BDD control var on every scope so ambient env can't leak in (P2)", async () => {
    // The runner spawn inherits process.env; a scope that sets only one of
    // BDD_FEATURES/BDD_TAGS must explicitly clear the other to "" (no filter),
    // or an ambient value from Obsidian's launch shell would re-scope the run.
    const feature = build();
    await feature.service.execute({
      scope: "feature",
      target: "Specifications/features/checkout.feature",
    });
    expect(feature.childProcess.calls[0].env?.BDD_TAGS).toBe(""); // feature owns BDD_FEATURES

    const suite = build();
    seedSuite(suite.fs, "smoke", "@smoke");
    await suite.service.execute({ scope: "suite", target: "smoke" });
    expect(suite.childProcess.calls[0].env?.BDD_FEATURES).toBe(""); // suite owns BDD_TAGS

    const demo = build();
    await demo.service.execute({ scope: "demo", target: "demo" });
    expect(demo.childProcess.calls[0].env?.BDD_FEATURES).toBe(""); // demo owns BDD_TAGS
  });

  it("scopes an unknown use-case run to the <UC-id>-*.feature glob via BDD_FEATURES", async () => {
    const { service, childProcess } = build();
    const result = await service.execute({ scope: "use-case", target: "UC-001" });
    expect(result.ok).toBe(true);
    expect(childProcess.calls[0].env?.BDD_FEATURES).toBe(
      "../Specifications/features/UC-001-*.feature",
    );
  });

  it("targets a Use Case's declared featureFiles in order (UC-011)", async () => {
    const { service, fs, childProcess } = build();
    fs.files.set(
      "Use Cases/UC-001 Demo.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "Demo",
          feature_files: [
            "Specifications/features/UC-001-happy-path.feature",
            "Specifications/features/UC-001-edge.feature",
          ],
        },
        "# UC-001",
      ),
    );
    const result = await service.execute({ scope: "use-case", target: "UC-001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Declared featureFiles in order, NEWLINE-separated (a vault path may hold a
    // comma but never a newline), runner-relative.
    expect(childProcess.calls[0].env?.BDD_FEATURES).toBe(
      "../Specifications/features/UC-001-happy-path.feature\n../Specifications/features/UC-001-edge.feature",
    );
  });

  it("excludes deprecated Use Cases' features from Run All (ADR-0012)", async () => {
    const { service, fs, childProcess } = build();
    fs.files.set(
      "Use Cases/UC-001 Active.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-001",
          title: "Active",
          feature_files: ["Specifications/features/UC-001-happy.feature"],
        },
        "# UC-001",
      ),
    );
    fs.files.set(
      "Use Cases/UC-002 Retired.md",
      buildNote(
        {
          type: "use-case",
          id: "UC-002",
          title: "Retired",
          status: "deprecated",
          feature_files: ["Specifications/features/UC-002-old.feature"],
        },
        "# UC-002",
      ),
    );
    const result = await service.execute({ scope: "all", target: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Scopes generation to the non-deprecated UC's feature via BDD_FEATURES.
    expect(childProcess.calls[0].env?.BDD_FEATURES).toBe(
      "../Specifications/features/UC-001-happy.feature",
    );
  });

  it("derives failed from a non-zero exit code", async () => {
    const { service, childProcess, events } = build();
    childProcess.exitCodes.set("test:smoke", 1);

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok && result.value.status).toBe("failed");
    const completed = events.find((e) => e.type === "testrun.completed");
    expect((completed?.payload as { status: string }).status).toBe("failed");
  });

  it("marks a spawn failure as errored and emits testrun.failed", async () => {
    const { service, childProcess, types, events } = build();
    childProcess.spawnFailures.add("test:smoke");

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok && result.value.status).toBe("errored");
    expect(types()).toEqual(["testrun.requested", "testrun.started", "testrun.failed"]);
    const failed = events.find((e) => e.type === "testrun.failed");
    expect((failed?.payload as { reason: string }).reason).toContain("spawn failed");
  });

  it("streams each output line as testrun.output.received", async () => {
    const { service, childProcess, events } = build();
    childProcess.streamLines.push(
      { stream: "stdout", line: "Running", timestamp: "t" },
      { stream: "stderr", line: "warn", timestamp: "t" },
    );

    await service.execute({ scope: "demo", target: "demo" });

    const output = events.filter((e) => e.type === "testrun.output.received");
    expect(output).toHaveLength(2);
    expect((output[0].payload as { line: string }).line).toBe("Running");
    expect((output[1].payload as { stream: string }).stream).toBe("stderr");
  });

  it("redacts a configured auth.env credential in the live output stream (security M1)", async () => {
    const { service, childProcess, settings, events } = build();
    const current = await settings.load();
    // Configure an env credential the runner then echoes into stderr.
    await settings.save({
      ...current,
      sut: {
        ...current.sut,
        environments: {
          ...current.sut.environments,
          demo: {
            ...current.sut.environments.demo,
            auth: { env: { E2E_TOKEN: "super-secret-token" } },
          },
        },
      },
    });
    childProcess.streamLines.push(
      { stream: "stderr", line: "login failed: super-secret-token (401)", timestamp: "t" },
      { stream: "stdout", line: "exact super-secret-token", timestamp: "t" },
    );

    await service.execute({ scope: "demo", target: "demo" });

    const output = events.filter((e) => e.type === "testrun.output.received");
    const lines = output.map((e) => (e.payload as { line: string }).line);
    // The credential is scrubbed both as an embedded substring and a whole value.
    expect(lines).toEqual(["login failed: *** (401)", "exact ***"]);
  });

  it("passes streamed lines through unchanged when no credentials are configured", async () => {
    const { service, childProcess, events } = build();
    // DEFAULT_SETTINGS' demo environment has no auth.env → empty secret set.
    childProcess.streamLines.push(
      { stream: "stdout", line: "plain output line", timestamp: "t" },
      { stream: "stderr", line: "another *** literal", timestamp: "t" },
    );

    await service.execute({ scope: "demo", target: "demo" });

    const lines = events
      .filter((e) => e.type === "testrun.output.received")
      .map((e) => (e.payload as { line: string }).line);
    expect(lines).toEqual(["plain output line", "another *** literal"]);
  });

  it("publishes exactly one terminal event (EN-2)", async () => {
    const { service, events } = build();
    await service.execute({ scope: "demo", target: "demo" });
    const terminals: DomainEventType[] = [
      "testrun.completed",
      "testrun.failed",
      "testrun.cancelled",
    ];
    expect(events.filter((e) => terminals.includes(e.type))).toHaveLength(1);
  });

  it("correlates every run event by runId (Event Catalog §correlation)", async () => {
    const { service, events } = build();
    const result = await service.execute({ scope: "demo", target: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const event of events) {
      expect(event.correlationId).toBe(result.value.id);
    }
  });

  it("rejects an overlapping run with RUN_IN_PROGRESS (ADR-0018)", async () => {
    const { service, childProcess } = build();
    childProcess.pending = true;

    const first = service.execute({ scope: "demo", target: "demo" });
    // Let the first run register itself as active before the second starts.
    await waitForActive(service);
    const second = await service.execute({ scope: "all", target: "all" });

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("RUN_IN_PROGRESS");
      expect(second.error.details?.activeRunId).toBe("RUN-2026-06-01-100000");
    }
    childProcess.release();
    await first;
  });

  it("reserves the active slot synchronously so a simultaneous run is rejected", async () => {
    const { service, childProcess } = build();
    childProcess.pending = true;

    // No await between the two calls: the slot must be reserved before the
    // first execute() yields on its first await, or both would start (ADR-0018).
    const first = service.execute({ scope: "demo", target: "demo" });
    const second = await service.execute({ scope: "all", target: "all" });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("RUN_IN_PROGRESS");

    childProcess.release();
    await first;
    // Only the first run ever spawned a process; the racing second was rejected.
    expect(childProcess.calls).toHaveLength(1);
  });

  it("cancel terminates the active run with testrun.cancelled", async () => {
    const { service, childProcess, types } = build();
    childProcess.pending = true;

    const running = service.execute({ scope: "demo", target: "demo" });
    await waitForActive(service);

    const cancelled = await service.cancel("RUN-2026-06-01-100000");
    expect(cancelled.ok).toBe(true);
    expect(childProcess.cancelled).toContain("RUN-2026-06-01-100000");
    await running;

    // Cancel wins the EN-2 race: terminal event is cancelled, not completed.
    const terminals = types().filter((t) =>
      ["testrun.completed", "testrun.failed", "testrun.cancelled"].includes(t),
    );
    expect(terminals).toEqual(["testrun.cancelled"]);
    expect(service.activeRunId()).toBeNull();
  });

  it("cancel for an unknown run id is rejected", async () => {
    const { service } = build();
    const result = await service.cancel("RUN-nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUN_CANCELLED");
  });

  it("clears the active slot after a run completes, allowing a second run", async () => {
    const { service } = build();
    await service.execute({ scope: "demo", target: "demo" });
    expect(service.activeRunId()).toBeNull();
    const second = await service.execute({ scope: "all", target: "all" });
    expect(second.ok).toBe(true);
  });

  it("propagates a suite-resolution error", async () => {
    const { service } = build();
    const result = await service.execute({ scope: "suite", target: "missing" });
    expect(result.ok).toBe(false);
  });

  it("a cancel that loses the race to completion does not relabel the finished run (A1)", async () => {
    const { service, childProcess, types } = build();
    childProcess.pending = true;

    const running = service.execute({ scope: "demo", target: "demo" });
    await waitForActive(service);

    // Simulate the SIGTERM arriving as the child closes on its own: the
    // adapter cancel releases the gate and only RETURNS once execute() has
    // fully settled — so the run completed inside cancel's await window.
    const adapterCancel = childProcess.cancel.bind(childProcess);
    childProcess.cancel = async (processId: string) => {
      const result = await adapterCancel(processId);
      await running;
      return result;
    };

    const cancelled = await service.cancel("RUN-2026-06-01-100000");

    // The run finished first: cancel reports "nothing to cancel" instead of
    // mutating the completed run, and the bus saw exactly one terminal event.
    expect(cancelled.ok).toBe(false);
    expect(service.lastRun()?.status).toBe("passed");
    const terminals = types().filter((t) =>
      ["testrun.completed", "testrun.failed", "testrun.cancelled"].includes(t),
    );
    expect(terminals).toEqual(["testrun.completed"]);
  });

  it("a non-Result throw mid-run still publishes a terminal testrun.failed (A2)", async () => {
    // A settings dependency whose load() REJECTS — the class of fault
    // (adapter bug, corrupted store) that previously escaped the try/finally
    // with no terminal event, leaving the console "running" forever.
    const fs = new FakeVaultFileSystem();
    const { bus, types } = recordingEventBus();
    const settings = new DefaultSettingsService(
      new FakeDataStore(),
      new DefaultPathSafetyPolicy(),
      bus,
    );
    // Deliberately a prototype-less spread: only `load` is reached before the
    // service under test fails, and it must reject.
    const brokenSettings = {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      ...settings,
      load: () => Promise.reject(new Error("data store exploded")),
    } as unknown as DefaultSettingsService;
    const broken = new DefaultTestExecutionService(
      brokenSettings,
      new DefaultSuiteService(settings, fs, bus),
      new DefaultUseCaseService(settings, fs, bus, silentLogger, new FakePrdLookup()),
      new FakeChildProcessRunner(),
      new FakeAbsoluteFileSystem(),
      new DefaultCommandSafetyPolicy(),
      bus,
      silentLogger,
      () => FIXED_NOW,
    );

    const result = await broken.execute({ scope: "all", target: "all" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("data store exploded");
    // The throw happened BEFORE testrun.started: the console never saw this
    // run, so no terminal lifecycle is fabricated — the error Result is the
    // whole story (and lastRun() must not report a phantom run).
    expect(types()).not.toContain("testrun.failed");
    expect(broken.lastRun()).toBeNull();
    // The slot is freed, so the service is not wedged for the session.
    expect(broken.activeRunId()).toBeNull();
  });

  it("a non-Result throw AFTER testrun.started publishes a terminal testrun.failed (A2)", async () => {
    const { service, childProcess, types } = build();
    // runStreaming throwing (not returning err) models an adapter bug mid-run.
    childProcess.runStreaming = () => {
      throw new Error("adapter exploded mid-run");
    };

    const result = await service.execute({ scope: "demo", target: "demo" });

    expect(result.ok).toBe(false);
    expect(types()).toContain("testrun.started");
    expect(types()).toContain("testrun.failed");
    expect(service.lastRun()?.status).toBe("errored");
    expect(service.activeRunId()).toBeNull();
  });

  it("passes TESTRUNNER_BROWSERS from settings on every run", async () => {
    const { service, childProcess, settings } = build();
    const current = await settings.load();
    await settings.save({
      ...current,
      runner: { ...current.runner, browsers: ["chromium", "firefox"] },
    });
    await service.execute({ scope: "demo", target: "demo" });
    expect(childProcess.calls[0].env?.TESTRUNNER_BROWSERS).toBe("chromium,firefox");
  });

  it("includes TESTRUNNER_BROWSERS even when sut.active is a dangling (non-existent) env key", async () => {
    // Seed the data store with a dangling sut.active so load() returns settings
    // where the active name doesn't exist in environments. validate() would flag
    // this, but a user-authored dangle survives load() unrepaired intentionally.
    // runEnv() must still emit TESTRUNNER_BROWSERS (a global runner setting
    // independent of the SUT environment) so the generated playwright config
    // uses the correct browser list rather than falling back to chromium.
    const { bus, events, types } = recordingEventBus();
    const store = new FakeDataStore({
      sut: {
        active: "nonexistent-env",
        environments: { demo: { baseUrl: "file://./demo.html" } },
      },
      runner: { browsers: ["firefox", "webkit"] },
    });
    const settings = new DefaultSettingsService(store, new DefaultPathSafetyPolicy(), bus);
    const fs = new FakeVaultFileSystem();
    const suiteService = new DefaultSuiteService(settings, fs, bus);
    const useCaseService = new DefaultUseCaseService(
      settings,
      fs,
      bus,
      silentLogger,
      new FakePrdLookup(),
    );
    const childProcess = new FakeChildProcessRunner();
    const absoluteFs = new FakeAbsoluteFileSystem();
    const service = new DefaultTestExecutionService(
      settings,
      suiteService,
      useCaseService,
      childProcess,
      absoluteFs,
      new DefaultCommandSafetyPolicy(),
      bus,
      silentLogger,
      () => FIXED_NOW,
    );

    await service.execute({ scope: "demo", target: "demo" });

    // Despite the dangling sut.active, TESTRUNNER_BROWSERS must be present.
    expect(childProcess.calls[0].env?.TESTRUNNER_BROWSERS).toBe("firefox,webkit");
    // BASE_URL must NOT be present (no active env resolved).
    expect(childProcess.calls[0].env).not.toHaveProperty("BASE_URL");
    void events;
    void types;
  });

  it("publishes the terminal event only after every streamed output event has been delivered", async () => {
    const { service, childProcess, bus } = build();
    // Emit multiple output lines so there are several output events to drain.
    childProcess.streamLines.push(
      { stream: "stdout", line: "line 1", timestamp: "t" },
      { stream: "stdout", line: "line 2", timestamp: "t" },
      { stream: "stdout", line: "line 3", timestamp: "t" },
    );

    const sequence: string[] = [];
    bus.subscribe("testrun.output.received", async () => {
      // Yield two macrotask ticks so the handler is genuinely async and slow,
      // giving fire-and-forget publishes a chance to race the terminal event.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      sequence.push("output");
    });
    bus.subscribe("testrun.completed", () => {
      sequence.push("terminal");
    });

    await service.execute({ scope: "demo", target: "demo" });

    expect(sequence.length).toBeGreaterThan(1);
    expect(sequence.at(-1)).toBe("terminal");
    expect(sequence.slice(0, -1).every((entry) => entry === "output")).toBe(true);
  });
});

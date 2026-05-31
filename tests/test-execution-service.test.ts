import { describe, expect, it } from "vitest";
import { DefaultSettingsService } from "../src/application/services/settings-service";
import { DefaultSuiteService } from "../src/application/services/suite-service";
import {
  appendScopedArgs,
  DefaultTestExecutionService,
  tokenizeCommand,
  type TestExecutionService,
} from "../src/application/services/test-execution-service";
import { DefaultUseCaseService } from "../src/application/services/use-case-service";
import { buildSuiteNote } from "../src/application/content/default-suites";
import { buildNote } from "../src/shared/utils/frontmatter";
import { DefaultCommandSafetyPolicy } from "../src/domain/policies/command-safety-policy";
import { DefaultPathSafetyPolicy } from "../src/domain/policies/path-safety-policy";
import type { DomainEventType } from "../src/domain/events/domain-event";
import {
  FakeAbsoluteFileSystem,
  FakeChildProcessRunner,
  FakeDataStore,
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
  const useCaseService = new DefaultUseCaseService(settings, fs, bus, silentLogger);
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
    expect(
      tokenizeCommand('npm run test -- --format "json:reports/cucumber report.json"'),
    ).toEqual(["npm", "run", "test", "--", "--format", "json:reports/cucumber report.json"]);
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
    expect(
      tokenizeCommand("npm run test -- --format json:C:\\tmp\\cucumber.json"),
    ).toEqual(["npm", "run", "test", "--", "--format", "json:C:\\tmp\\cucumber.json"]);
  });

  it("returns an empty array for a blank command", () => {
    expect(tokenizeCommand("   ")).toEqual([]);
  });
});

describe("appendScopedArgs", () => {
  it("inserts a single -- when the base has none", () => {
    expect(appendScopedArgs(["npm", "run", "test"], ["--tags", "@x"])).toEqual([
      "npm",
      "run",
      "test",
      "--",
      "--tags",
      "@x",
    ]);
  });

  it("does not add a second -- when the base already forwards args", () => {
    expect(
      appendScopedArgs(["npm", "run", "test", "--", "--format", "progress"], ["--tags", "@x"]),
    ).toEqual(["npm", "run", "test", "--", "--format", "progress", "--tags", "@x"]);
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
    expect(types()).toEqual([
      "testrun.requested",
      "testrun.started",
      "testrun.completed",
    ]);
  });

  it("resolves the all command", async () => {
    const { service } = build();
    const result = await service.execute({ scope: "all", target: "all" });
    expect(result.ok && result.value.command).toBe("npm run test");
  });

  it("clears any prior Cucumber report before running (no stale import)", async () => {
    const { service, absoluteFs } = build();
    const reportPath = "/vault/.testrunner/reports/cucumber-report.json";
    absoluteFs.seed(reportPath, "{ old report }");
    await service.execute({ scope: "demo", target: "demo" });
    expect(await absoluteFs.existsAbsolute(reportPath)).toBe(false);
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
    // Verbatim tag as a single literal argv entry (AD-4, no quoting/escaping).
    expect(childProcess.calls[0].args).toEqual([
      "npm",
      "run",
      "test",
      "--",
      "--tags",
      "@smoke and not @wip",
    ]);
    // Display string quotes only the space-bearing arg, for readability.
    expect(result.value.command).toBe('npm run test -- --tags "@smoke and not @wip"');
    // suite.executed precedes the terminal event (UC-013).
    expect(types()).toEqual([
      "testrun.requested",
      "testrun.started",
      "suite.executed",
      "testrun.completed",
    ]);
  });

  it("resolves the feature command relative to the runner cwd", async () => {
    const { service, childProcess } = build();
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/checkout.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(childProcess.calls[0].args).toEqual([
      "npm",
      "run",
      "test",
      "--",
      "../Specifications/features/checkout.feature",
    ]);
    // No spaces → no display quoting.
    expect(result.value.command).toBe(
      "npm run test -- ../Specifications/features/checkout.feature",
    );
  });

  it("passes a feature path with $, &, and spaces as a literal argv entry (no shell, no escaping)", async () => {
    const { service, childProcess } = build();
    // PR #7: under shell: false these are literal args — never interpolated or
    // word-split, and no longer false-rejected by CommandSafetyPolicy.
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/R&D Price $5.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The path arrives verbatim as a single literal argv entry — no escaping.
    expect(childProcess.calls[0].args).toEqual([
      "npm",
      "run",
      "test",
      "--",
      "../Specifications/features/R&D Price $5.feature",
    ]);
    // Display quotes only because the arg contains spaces (readability only).
    expect(result.value.command).toBe(
      'npm run test -- "../Specifications/features/R&D Price $5.feature"',
    );
  });

  it("resolves a feature path with shell metacharacters and runs (no COMMAND_DISALLOWED)", async () => {
    const { service } = build();
    // R&D.feature would be false-rejected/expanded under the old shell:true
    // policy; with argv arrays it is a literal arg and runs cleanly (PR #7).
    const result = await service.execute({
      scope: "feature",
      target: "Specifications/features/R&D.feature",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("passed");
    expect(result.value.command).toBe(
      "npm run test -- ../Specifications/features/R&D.feature",
    );
  });

  it("resolves the use-case command as a feature glob when the UC is unknown", async () => {
    const { service } = build();
    const result = await service.execute({ scope: "use-case", target: "UC-001" });
    expect(result.ok && result.value.command).toBe(
      "npm run test -- ../Specifications/features/UC-001-*.feature",
    );
  });

  it("targets a Use Case's declared featureFiles in order (UC-011)", async () => {
    const { service, fs } = build();
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
    expect(result.ok && result.value.command).toBe(
      "npm run test -- ../Specifications/features/UC-001-happy-path.feature ../Specifications/features/UC-001-edge.feature",
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
});

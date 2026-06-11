import { describe, expect, it, vi } from "vitest";
import type {
  ExecuteTestRequest,
  TestExecutionService,
} from "../src/application/services/test-execution-service";
import type { TestRun } from "../src/domain/entities/test-run";
import type { RunId } from "../src/domain/value-objects/identifiers";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { appError } from "../src/shared/errors/errors";
import { err, ok, type Result } from "../src/shared/result/result";
import {
  RunLauncher,
  scopeLabel,
  type OpenConsolePort,
} from "../src/presentation/run/run-launcher";

const aRun = (over: Partial<TestRun> = {}): TestRun => ({
  id: "RUN-2026-06-09-100000",
  scope: "suite",
  target: "smoke",
  status: "passed",
  startedAt: "2026-06-09T10:00:00.000Z",
  command: "npm run test",
  workingDirectory: vp(".testrunner"),
  reportPaths: {},
  ...over,
});

/** A test double exposing just the slice the launcher consumes. */
interface ExecStub {
  execute: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  activeRunId: ReturnType<typeof vi.fn>;
  /** The same object, typed as the service for injection into the launcher. */
  service: TestExecutionService;
}

const makeExec = (
  over: Partial<Pick<ExecStub, "execute" | "cancel" | "activeRunId">> = {},
): ExecStub => {
  const stub = {
    execute: vi.fn(async (_req: ExecuteTestRequest): Promise<Result<TestRun>> => ok(aRun())),
    cancel: vi.fn(async (_id: RunId): Promise<Result<void>> => ok(undefined)),
    activeRunId: vi.fn((): RunId | null => null),
    ...over,
  };
  // Only execute/cancel/activeRunId are exercised; cast through unknown so the
  // double doesn't have to implement the full service surface.
  return { ...stub, service: stub as unknown as TestExecutionService };
};

const makeConsole = (): OpenConsolePort & { openConsole: ReturnType<typeof vi.fn> } => ({
  openConsole: vi.fn(async () => undefined),
});

describe("scopeLabel", () => {
  it("labels each scope glossary-correctly", () => {
    expect(scopeLabel("suite", "smoke")).toBe("Test Suite smoke");
    expect(scopeLabel("use-case", "UC-001")).toBe("Use Case UC-001");
    expect(scopeLabel("feature", "a.feature")).toBe("Feature a.feature");
    expect(scopeLabel("all", "all")).toBe("All tests");
    expect(scopeLabel("demo", "demo")).toBe("Demo test");
  });
});

describe("RunLauncher.launch", () => {
  it("reveals the console BEFORE executing so it is subscribed first", async () => {
    const order: string[] = [];
    const consolePort = makeConsole();
    consolePort.openConsole.mockImplementation(async () => {
      order.push("open");
    });
    const exec = makeExec({
      execute: vi.fn(async () => {
        order.push("execute");
        return ok(aRun());
      }),
    });
    const notify = vi.fn();

    await new RunLauncher(exec.service, consolePort, notify).launch({
      scope: "suite",
      target: "smoke",
    });

    expect(order).toEqual(["open", "execute"]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("passes the request through to execute()", async () => {
    const exec = makeExec();
    const notify = vi.fn();
    const request: ExecuteTestRequest = { scope: "use-case", target: "UC-007" };

    await new RunLauncher(exec.service, makeConsole(), notify).launch(request);

    expect(exec.execute).toHaveBeenCalledWith(request);
  });

  it("surfaces RUN_IN_PROGRESS naming the active run id", async () => {
    const exec = makeExec({
      execute: vi.fn(async () =>
        err(
          appError("RUN_IN_PROGRESS", "A test run is already in progress.", {
            details: { activeRunId: "RUN-2026-06-09-090000" },
          }),
        ),
      ),
    });
    const notify = vi.fn();

    await new RunLauncher(exec.service, makeConsole(), notify).launch({
      scope: "all",
      target: "all",
    });

    expect(notify).toHaveBeenCalledWith(
      "A run is already in progress (RUN-2026-06-09-090000). Cancel it first.",
      10000,
    );
  });

  it("surfaces a generic start error as a Notice", async () => {
    const exec = makeExec({
      execute: vi.fn(async () => err(appError("VALIDATION_FAILED", "bad command"))),
    });
    const notify = vi.fn();

    await new RunLauncher(exec.service, makeConsole(), notify).launch({
      scope: "all",
      target: "all",
    });

    expect(notify).toHaveBeenCalledWith("Could not start run: bad command", 10000);
  });
});

describe("RunLauncher.cancel", () => {
  it("notifies and no-ops when nothing is running", async () => {
    const exec = makeExec({ activeRunId: vi.fn(() => null) });
    const notify = vi.fn();

    await new RunLauncher(exec.service, makeConsole(), notify).cancel();

    expect(notify).toHaveBeenCalledWith("No Test Run is in progress.");
    expect(exec.cancel).not.toHaveBeenCalled();
  });

  it("cancels the active run and reports success", async () => {
    const exec = makeExec({
      activeRunId: vi.fn(() => "RUN-2026-06-09-100000"),
      cancel: vi.fn(async () => ok(undefined)),
    });
    const notify = vi.fn();

    await new RunLauncher(exec.service, makeConsole(), notify).cancel();

    expect(exec.cancel).toHaveBeenCalledWith("RUN-2026-06-09-100000");
    expect(notify).toHaveBeenCalledWith("Test Run cancelled.");
  });

  it("reports an already-finished run as benign, not as an error", async () => {
    // The cancel race-guard returns RUN_CANCELLED when the run reached its real
    // terminal state during the cancel round-trip — the user must not see a red
    // "Could not cancel" for a run that finished normally.
    const exec = makeExec({
      activeRunId: vi.fn(() => "RUN-2026-06-09-100000"),
      cancel: vi.fn(async () => err(appError("RUN_CANCELLED", "finished while cancelling"))),
    });
    const notify = vi.fn();

    await new RunLauncher(exec.service, makeConsole(), notify).cancel();

    expect(notify).toHaveBeenCalledWith("The Test Run already finished; nothing to cancel.");
  });

  it("reports a cancel failure", async () => {
    const exec = makeExec({
      activeRunId: vi.fn(() => "RUN-2026-06-09-100000"),
      cancel: vi.fn(async () => err(appError("INIT_FAILED", "kill failed"))),
    });
    const notify = vi.fn();

    await new RunLauncher(exec.service, makeConsole(), notify).cancel();

    expect(notify).toHaveBeenCalledWith("Could not cancel run: kill failed", 10000);
  });
});

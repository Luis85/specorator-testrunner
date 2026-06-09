import { Notice } from "obsidian";

import type {
  ExecuteTestRequest,
  TestExecutionService,
} from "../../application/services/test-execution-service";
import type { ExecutionScope } from "../../domain/entities/test-run";

/**
 * Narrow port the launcher uses to reveal the live Test Console. The Test
 * Console must be opened (and so subscribed to `testrun.*`) BEFORE `execute()`
 * publishes, because the bus does not replay — so this resolves before the run
 * starts. Implemented by the Obsidian workspace adapter in `main.ts`.
 */
export interface OpenConsolePort {
  openConsole(): Promise<unknown>;
}

/**
 * Single owner of "start a run / cancel the active run" for every UI surface
 * (the command palette AND the explorer/console buttons). Extracting it here
 * means the run-launch logic — reveal the console first, surface
 * `RUN_IN_PROGRESS`/errors as Notices, look up the active run to cancel — lives
 * in exactly one place rather than being duplicated per call site (Wave B
 * altitude requirement). The deps are deliberately narrow: the execution
 * service, a port to open the console, and the `Notice` constructor (injectable
 * so the launcher is unit-testable without the Obsidian runtime).
 */
export class RunLauncher {
  constructor(
    private readonly testExecutionService: TestExecutionService,
    private readonly console: OpenConsolePort,
    // Injected so tests can substitute a spy; defaults to the Obsidian Notice.
    private readonly notify: (message: string, timeout?: number) => void = (message, timeout) => {
      new Notice(message, timeout);
    },
  ) {}

  /**
   * Starts a run of the requested scope, revealing the live Test Console first
   * so output streams in (US-030, UC-015). ADR-0018 surfaces `RUN_IN_PROGRESS`
   * as a Notice naming the active run id so the user can cancel it. The single-
   * active slot is reserved synchronously inside `execute()`, and the service
   * owns cancel-and-wait completion, so callers need not track the run promise.
   */
  async launch(request: ExecuteTestRequest): Promise<void> {
    // Reveal the live console FIRST so it is subscribed to testrun.started /
    // output events before execute() publishes them (the bus doesn't replay).
    await this.console.openConsole();
    const result = await this.testExecutionService.execute(request);
    if (!result.ok) {
      // `details` is typed `Record<string, unknown>`, so `activeRunId` widens
      // to `unknown`; at runtime it is always the active run's id string.
      const active =
        typeof result.error.details?.activeRunId === "string"
          ? result.error.details.activeRunId
          : "";
      this.notify(
        active
          ? `A run is already in progress (${active}). Cancel it first.`
          : `Could not start run: ${result.error.message}`,
        10000,
      );
    }
    // The PostRunCoordinator reacts to the terminal run event (EN-2) and runs
    // import → evidence → dashboard refresh for the finished run.
  }

  /**
   * Cancels the single active run (ADR-0018), surfacing the outcome as a
   * Notice. A no-op (with a Notice) when nothing is running.
   */
  async cancel(): Promise<void> {
    const active = this.testExecutionService.activeRunId();
    if (active === null) {
      this.notify("No Test Run is in progress.");
      return;
    }
    const result = await this.testExecutionService.cancel(active);
    this.notify(
      result.ok ? "Test Run cancelled." : `Could not cancel run: ${result.error.message}`,
      result.ok ? undefined : 10000,
    );
  }
}

/**
 * Human-readable label for a run's scope + target, used by the Test Console
 * metadata line. Pure so it is unit-tested without a DOM. Glossary-correct
 * (Test Suite, Use Case, Feature).
 */
export const scopeLabel = (scope: ExecutionScope, target: string): string => {
  switch (scope) {
    case "demo":
      return "Demo test";
    case "all":
      return "All tests";
    case "suite":
      return `Test Suite ${target}`;
    case "use-case":
      return `Use Case ${target}`;
    case "feature":
      return `Feature ${target}`;
  }
};

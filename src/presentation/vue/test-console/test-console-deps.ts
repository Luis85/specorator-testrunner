import type { InjectionKey } from "vue";
import type { LastEvidence } from "../../../application/services/post-run-coordinator";
import type { TestRun } from "../../../domain/entities/test-run";
import type { RunId, VaultPath } from "../../../domain/value-objects/identifiers";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { RunLauncher } from "../../run/run-launcher";

/**
 * The narrow slice of the composition root the Test Console needs (Wave B): the
 * event bus it streams from, the shared run launcher its Cancel / Re-run buttons
 * drive, and two read-only execution-service probes — `activeRunId()` to detect
 * a run already in flight when the console opens, and `lastRun()` to power
 * Re-run and the idle metadata line. The launcher owns the actual launch/cancel
 * logic so it is not duplicated here.
 */
export interface TestConsoleDeps {
  eventBus: EventBus;
  runLauncher: Pick<RunLauncher, "launch" | "cancel">;
  activeRunId(): RunId | null;
  /**
   * ISO start time of the active run (null when idle), so a console opened
   * MID-run seeds its elapsed timer from the real start, not from the moment
   * the view opened (C6).
   */
  activeRunStartedAt(): string | null;
  lastRun(): TestRun | null;
  // Wave G §1: synchronous probe for the last generated evidence note (wired in
  // main.ts to PostRunCoordinator.lastEvidence). The bus does not replay, so a
  // console opened AFTER `evidence.generated` fired still needs to know the
  // last run's evidence exists to enable its "Open evidence" button.
  lastEvidence(): LastEvidence | null;
  // Opens the evidence note via the workspace (wired to the workspace adapter).
  openEvidence(path: VaultPath): void | Promise<void>;
}

/** Per-leaf DI key: the composition-root slice the Test Console app injects (ADR-0033). */
export const TEST_CONSOLE_DEPS = Symbol("test-console-deps") as InjectionKey<TestConsoleDeps>;

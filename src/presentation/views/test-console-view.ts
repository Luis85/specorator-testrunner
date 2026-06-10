import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { TestRun, TestRunStatus } from "../../domain/entities/test-run";
import type { DomainEvent } from "../../domain/events/domain-event";
import type { RunId } from "../../domain/value-objects/identifiers";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { RunLauncher, scopeLabel } from "../run/run-launcher";
import {
  formatElapsed,
  formatOutputLine,
  formatStatusBanner,
  statusModifier,
} from "./test-console-format";

export const TEST_CONSOLE_VIEW_TYPE = "e2e-test-hub-console";

/** Subset of the `testrun.requested` payload — carries the scope/target label. */
interface RequestedPayload {
  scope: "use-case" | "feature" | "suite" | "all";
  target: string;
}

/** Subset of the `testrun.started` payload the console needs (Event Catalog). */
interface StartedPayload {
  runId: string;
  command: string;
  workingDirectory: string;
}

/** Subset of the `testrun.output.received` payload (Event Catalog). */
interface OutputPayload {
  runId: string;
  stream: "stdout" | "stderr";
  line: string;
}

/** Subset of the `testrun.completed` payload (Event Catalog). */
interface CompletedPayload {
  runId: string;
  status: "passed" | "failed";
  durationMs: number;
}

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
  lastRun(): TestRun | null;
}

/**
 * Live "Test Console" panel (US-030, UC-015). Subscribes to the `testrun.*`
 * lifecycle and streams output lines as they arrive, then shows the terminal
 * status banner. A header toolbar (Wave B) lets a normal user cancel, re-run,
 * and clear without leaving the panel for the command palette. Formatting is
 * delegated to the pure {@link test-console-format} helpers so the rendering
 * rules are unit-tested without a DOM.
 */
/**
 * Cap on retained output lines. A long-running suite can stream tens of
 * thousands of lines; without a bound each becomes a permanent `<div>` and the
 * DOM grows without limit. We keep the most recent {@link MAX_OUTPUT_LINES} and
 * drop the oldest beyond that (PRES-M4).
 */
const MAX_OUTPUT_LINES = 5000;

/** Live elapsed-timer tick interval (ms). */
const TIMER_TICK_MS = 1000;

export class TestConsoleView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  private output!: HTMLElement;
  private banner!: HTMLElement;
  private meta!: HTMLElement;
  private cancelButton!: HTMLButtonElement;
  private rerunButton!: HTMLButtonElement;
  private clearButton!: HTMLButtonElement;

  // Active-run state powering the toolbar + live metadata line. `runStartMs` is
  // set when the run starts and drives the elapsed timer; `activeScopeLabel` is
  // captured from `testrun.requested` (which carries scope/target, unlike
  // `testrun.started`). Both clear on the terminal event.
  private runStartMs: number | null = null;
  private activeScopeLabel: string | null = null;
  private timerHandle: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: TestConsoleDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TEST_CONSOLE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Test Console";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h2", { text: "Test Console" });

    this.renderToolbar(container);
    // aria-live="polite": the metadata line and status banner change at run
    // boundaries (low frequency), so screen readers should announce them.
    this.meta = container.createEl("div", {
      cls: "e2e-test-hub-console-meta",
      attr: { "aria-live": "polite" },
    });
    this.banner = container.createEl("div", {
      cls: "e2e-test-hub-console-banner",
      attr: { "aria-live": "polite" },
    });
    // role="log" (NOT aria-live): a log implies polite, additions-only live
    // semantics — an explicit aria-live on this high-frequency stream would
    // spam screen readers with every output line.
    this.output = container.createEl("pre", {
      cls: "e2e-test-hub-console-output",
      attr: { role: "log" },
    });

    this.subscriptions.push(
      this.deps.eventBus.subscribe<RequestedPayload>("testrun.requested", (event) =>
        this.onRequested(event),
      ),
      this.deps.eventBus.subscribe<StartedPayload>("testrun.started", (event) =>
        this.onStarted(event),
      ),
      this.deps.eventBus.subscribe<OutputPayload>("testrun.output.received", (event) =>
        this.onOutputReceived(event),
      ),
      this.deps.eventBus.subscribe<CompletedPayload>("testrun.completed", (event) =>
        this.onTerminal(event.payload.status, event.payload.durationMs),
      ),
      this.deps.eventBus.subscribe("testrun.failed", () => this.onTerminal("errored")),
      this.deps.eventBus.subscribe("testrun.cancelled", () => this.onTerminal("cancelled")),
    );

    // A run may already be in flight when the console is opened from the
    // palette/ribbon mid-run: reflect that immediately rather than waiting for
    // the next event (which already fired and the bus does not replay).
    if (this.deps.activeRunId() !== null) {
      this.runStartMs ??= Date.now();
      this.startTimer();
    }
    this.refreshControls();
  }

  async onClose(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.stopTimer();
    // Clear the per-run timer state so a REOPEN during a later run starts its
    // elapsed clock fresh. onOpen does `runStartMs ??= Date.now()`, so a stale
    // value left here would make the timer count from a previous run's start.
    this.runStartMs = null;
    this.activeScopeLabel = null;
  }

  /** Header toolbar: Cancel / Re-run / Clear (Wave B). */
  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "e2e-test-hub-console-toolbar" });

    this.cancelButton = toolbar.createEl("button", {
      cls: "e2e-test-hub-console-action mod-warning",
      attr: { "aria-label": "Cancel the active Test Run" },
    });
    setIcon(this.cancelButton.createSpan({ cls: "e2e-test-hub-console-action-icon" }), "square");
    this.cancelButton.createSpan({ text: "Cancel run" });
    this.cancelButton.addEventListener("click", () => void this.deps.runLauncher.cancel());

    this.rerunButton = toolbar.createEl("button", {
      cls: "e2e-test-hub-console-action",
      attr: { "aria-label": "Re-run the last Test Run" },
    });
    setIcon(this.rerunButton.createSpan({ cls: "e2e-test-hub-console-action-icon" }), "rotate-ccw");
    this.rerunButton.createSpan({ text: "Re-run" });
    this.rerunButton.addEventListener("click", () => {
      const last = this.deps.lastRun();
      if (last === null) return;
      void this.deps.runLauncher.launch({ scope: last.scope, target: last.target });
    });

    this.clearButton = toolbar.createEl("button", {
      cls: "e2e-test-hub-console-action",
      attr: { "aria-label": "Clear the Test Console output" },
    });
    setIcon(this.clearButton.createSpan({ cls: "e2e-test-hub-console-action-icon" }), "eraser");
    this.clearButton.createSpan({ text: "Clear" });
    // Clears the output pane only — the status banner stays so the last
    // outcome remains visible.
    this.clearButton.addEventListener("click", () => this.output.empty());
  }

  private onRequested(event: DomainEvent<RequestedPayload>): void {
    // `testrun.requested` fires just before `testrun.started` and is the only
    // run event carrying scope/target, so capture the label for the live
    // metadata line here.
    this.activeScopeLabel = scopeLabel(event.payload.scope, event.payload.target);
  }

  private onStarted(event: DomainEvent<StartedPayload>): void {
    this.output.empty();
    this.runStartMs = Date.now();
    this.setBanner("running");
    this.output.createEl("div", {
      text: `$ ${event.payload.command}`,
      cls: "e2e-test-hub-console-cmd",
    });
    this.output.scrollTop = this.output.scrollHeight;
    this.startTimer();
    this.refreshControls();
  }

  private onOutputReceived(event: DomainEvent<OutputPayload>): void {
    // Append only when the user is already pinned to the bottom (within a small
    // slack) so we don't yank the viewport while they scroll back through
    // earlier output.
    const pinnedToBottom =
      this.output.scrollHeight - this.output.scrollTop - this.output.clientHeight < 4;

    this.output.createEl("div", {
      text: formatOutputLine(event.payload.stream, event.payload.line),
      cls: event.payload.stream === "stderr" ? "e2e-test-hub-console-stderr" : undefined,
    });

    // Bound the retained DOM: drop the oldest lines beyond the cap so a long
    // run can't grow the panel without limit (PRES-M4).
    while (this.output.childElementCount > MAX_OUTPUT_LINES) {
      this.output.firstElementChild?.remove();
    }

    if (pinnedToBottom) this.output.scrollTop = this.output.scrollHeight;
  }

  private onTerminal(status: TestRunStatus, durationMs?: number): void {
    this.stopTimer();
    this.runStartMs = null;
    this.activeScopeLabel = null;
    this.setBanner(status, durationMs);
    // Force the idle state: this handler runs WHILE the in-process bus is still
    // synchronously publishing the terminal event, i.e. BEFORE execute()'s
    // `finally` clears the single-run slot — so `activeRunId()` would still
    // report this just-finished run and wrongly leave the toolbar stuck
    // "running" (Cancel enabled, Re-run disabled) until the view is reopened.
    // The terminal event IS the "run is over" signal, so treat it as idle.
    this.refreshControls(false);
  }

  private setBanner(status: TestRunStatus, durationMs?: number): void {
    this.banner.setText(formatStatusBanner(status, durationMs));
    this.banner.dataset.status = statusModifier(status);
  }

  /**
   * Recomputes button enabled/disabled state and the metadata line. A run is
   * active iff the execution service reports an active id — EXCEPT callers in a
   * terminal-event context pass `activeOverride = false`, because the slot is
   * not cleared until after the synchronous terminal publish returns (see
   * {@link onTerminal}). The Cancel button is enabled only while active; Re-run
   * only when idle with a last run; Clear is always enabled.
   */
  private refreshControls(activeOverride?: boolean): void {
    const active = activeOverride ?? this.deps.activeRunId() !== null;
    const last = this.deps.lastRun();

    this.cancelButton.disabled = !active;
    this.cancelButton.setAttr(
      "aria-label",
      active ? "Cancel the active Test Run" : "No Test Run is in progress to cancel",
    );

    this.rerunButton.disabled = active || last === null;
    this.rerunButton.setAttr(
      "aria-label",
      active
        ? "A Test Run is in progress; re-run is available once it finishes"
        : last === null
          ? "No Test Run to re-run yet"
          : `Re-run ${scopeLabel(last.scope, last.target)}`,
    );

    this.renderMeta(active, last);
  }

  /**
   * Metadata line: while a run is active, the scope/target label plus a live
   * elapsed timer; when idle, the last run's outcome and when; and an empty
   * state before the first run of the session.
   */
  private renderMeta(active: boolean, last: TestRun | null): void {
    if (active) {
      const label = this.activeScopeLabel ?? "Test Run";
      const elapsed = formatElapsed(Date.now() - (this.runStartMs ?? Date.now()));
      this.meta.setText(`Running ${label} · ${elapsed}`);
      this.meta.dataset.status = "running";
      return;
    }
    if (last !== null) {
      const when = last.finishedAt ?? last.startedAt;
      this.meta.setText(
        `Last run: ${scopeLabel(last.scope, last.target)} — ${last.status} (${formatWhen(when)})`,
      );
      this.meta.dataset.status = statusModifier(last.status);
      return;
    }
    this.meta.setText(
      "No Test Run yet. Start one from a Test Suite, Use Case, or the Run commands.",
    );
    delete this.meta.dataset.status;
  }

  /** Starts the live elapsed timer, registered so it is cleaned up on unload. */
  private startTimer(): void {
    if (this.timerHandle !== null) return;
    // registerInterval ties the interval to the view's lifecycle (cleared on
    // unload alongside the view's other registrations); we also stop it on the
    // terminal event so it doesn't tick once the run has finished.
    this.timerHandle = window.setInterval(() => this.tickTimer(), TIMER_TICK_MS);
    this.registerInterval(this.timerHandle);
    this.tickTimer();
  }

  private stopTimer(): void {
    if (this.timerHandle === null) return;
    window.clearInterval(this.timerHandle);
    this.timerHandle = null;
  }

  /** One timer tick: refresh just the elapsed portion of the metadata line. */
  private tickTimer(): void {
    if (this.runStartMs === null) return;
    const label = this.activeScopeLabel ?? "Test Run";
    this.meta.setText(`Running ${label} · ${formatElapsed(Date.now() - this.runStartMs)}`);
    this.meta.dataset.status = "running";
  }
}

/** Localized timestamp for the idle metadata line. */
const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

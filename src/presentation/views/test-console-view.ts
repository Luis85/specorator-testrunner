import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { LastEvidence } from "../../application/services/post-run-coordinator";
import type { TestRun, TestRunStatus } from "../../domain/entities/test-run";
import type { DomainEvent } from "../../domain/events/domain-event";
import type { RunId, VaultPath } from "../../domain/value-objects/identifiers";
import { vaultPath } from "../../domain/value-objects/vault-path";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { RunLauncher, scopeLabel } from "../run/run-launcher";
import {
  extractCucumberSummary,
  formatElapsed,
  formatOutputLine,
  formatStatusBanner,
  summaryHint,
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

/** Subset of the `evidence.generated` payload (Event Catalog §9). */
interface EvidenceGeneratedPayload {
  runId: string;
  evidencePath: string;
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
  private evidenceButton!: HTMLButtonElement;
  private clearButton!: HTMLButtonElement;

  // Evidence note for the LAST run (Wave G §1): null until `evidence.generated`
  // arrives for lastRun() (or the probe reports it on open), cleared when a new
  // run starts. Drives the "Open evidence" toolbar button.
  private evidencePathForLastRun: VaultPath | null = null;

  // Active-run state powering the toolbar + live metadata line. `runStartMs` is
  // set when the run starts and drives the elapsed timer; `activeScopeLabel` is
  // captured from `testrun.requested` (which carries scope/target, unlike
  // `testrun.started`). Both clear on the terminal event.
  private runStartMs: number | null = null;
  private activeScopeLabel: string | null = null;
  private timerHandle: number | null = null;
  // Cucumber's end-of-run summary lines ("1 scenario (1 undefined)", …),
  // captured from the stream so the terminal banner can show the OUTCOME at
  // the top instead of only "Run failed" (testvault demo-run feedback).
  private summaryLines: string[] = [];

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
      // Wave G §1: the post-run flow generates evidence asynchronously AFTER the
      // terminal event; enable "Open evidence" once the note for the last run
      // exists.
      this.deps.eventBus.subscribe<EvidenceGeneratedPayload>("evidence.generated", (event) =>
        this.onEvidenceGenerated(event),
      ),
    );

    // The console may open after the last run's evidence was already generated
    // (the bus does not replay `evidence.generated`): seed the button from the
    // synchronous probe. Skipped while a run is active — its evidence doesn't
    // exist yet, and the probe would report a PREVIOUS run's note.
    if (this.deps.activeRunId() === null) this.syncEvidenceFromProbe();

    // A run may already be in flight when the console is opened from the
    // palette/ribbon mid-run: reflect that immediately rather than waiting for
    // the next event (which already fired and the bus does not replay). The
    // elapsed timer seeds from the run's REAL start time, and the banner shows
    // "running" — `testrun.started` fired before this view existed (C6/UX7).
    if (this.deps.activeRunId() !== null) {
      const startedAt = this.deps.activeRunStartedAt();
      const startedMs = startedAt !== null ? new Date(startedAt).getTime() : NaN;
      this.runStartMs ??= Number.isNaN(startedMs) ? Date.now() : startedMs;
      this.setBanner("running");
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
    // Re-seeded from the lastEvidence() probe on the next onOpen.
    this.evidencePathForLastRun = null;
  }

  /** Header toolbar: Cancel / Re-run / Open evidence / Clear (Wave B, Wave G §1). */
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

    // Wave G §1: jump from the console to the Evidence note of the last run.
    // Disabled until evidence exists for THAT run (post-run generation is
    // asynchronous, so it enables shortly after the terminal banner).
    this.evidenceButton = toolbar.createEl("button", {
      cls: "e2e-test-hub-console-action",
      attr: { "aria-label": "No evidence for the last run yet" },
    });
    setIcon(
      this.evidenceButton.createSpan({ cls: "e2e-test-hub-console-action-icon" }),
      "file-text",
    );
    this.evidenceButton.createSpan({ text: "Open evidence" });
    this.evidenceButton.addEventListener("click", () => {
      const path = this.evidencePathForLastRun;
      if (path === null) return;
      void this.deps.openEvidence(path);
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
    // A new run owns the console now — the previous run's evidence is stale for
    // the "Open evidence" affordance (it is about the LAST run).
    this.evidencePathForLastRun = null;
    this.summaryLines = [];
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

    const summary = extractCucumberSummary(event.payload.line);
    if (summary !== null) this.summaryLines.push(summary);

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

  /**
   * Wave G §1: `evidence.generated` for the LAST run enables the "Open
   * evidence" button. The payload's runId is matched against `lastRun()` so an
   * on-demand re-import of an older run can't be attributed to the latest one.
   */
  private onEvidenceGenerated(event: DomainEvent<EvidenceGeneratedPayload>): void {
    if (event.payload.runId !== this.deps.lastRun()?.id) return;
    // The payload travels as a plain string; re-validate through the ADR-0008
    // vaultPath() chokepoint before it can reach the workspace opener.
    const safe = vaultPath(event.payload.evidencePath);
    if (!safe.ok) return;
    this.evidencePathForLastRun = safe.value;
    this.refreshControls();
  }

  /**
   * Seeds {@link evidencePathForLastRun} from the synchronous lastEvidence()
   * probe — for a console opened AFTER the last run's `evidence.generated`
   * already fired (the bus does not replay). The recorded runId must match the
   * last run, so a previous run's note is never offered for the latest run.
   */
  private syncEvidenceFromProbe(): void {
    const last = this.deps.lastRun();
    const evidence = this.deps.lastEvidence();
    this.evidencePathForLastRun =
      last !== null && evidence !== null && evidence.runId === last.id
        ? evidence.evidencePath
        : null;
  }

  private setBanner(status: TestRunStatus, durationMs?: number): void {
    this.banner.empty();
    const headline = formatStatusBanner(status, durationMs);
    // On a terminal state, append Cucumber's own counts so the WHY is readable
    // at the top ("Run failed (0.1s) — 1 scenario (1 undefined), 3 steps
    // (3 undefined)"), plus an actionable hint for undefined steps.
    const isTerminal = status !== "running" && status !== "queued";
    const summary = isTerminal && this.summaryLines.length > 0 ? this.summaryLines : [];
    this.banner.createDiv({
      text: summary.length > 0 ? `${headline} — ${summary.join(", ")}` : headline,
    });
    const hint = isTerminal ? summaryHint(summary) : null;
    if (hint !== null) {
      this.banner.createDiv({ cls: "e2e-test-hub-console-banner-hint", text: hint });
    }
    this.banner.dataset.status = status;
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
    this.labelControl(
      this.cancelButton,
      active ? "Cancel the active Test Run" : "No Test Run is in progress to cancel",
    );

    this.rerunButton.disabled = active || last === null;
    this.labelControl(
      this.rerunButton,
      active
        ? "A Test Run is in progress; re-run is available once it finishes"
        : last === null
          ? "No Test Run to re-run yet"
          : `Re-run ${scopeLabel(last.scope, last.target)}`,
    );

    // "Open evidence" (Wave G §1): enabled only once the LAST run's evidence
    // note exists. The disabled reason stays spoken via the aria-label.
    const hasEvidence = this.evidencePathForLastRun !== null;
    this.evidenceButton.disabled = !hasEvidence;
    this.labelControl(
      this.evidenceButton,
      hasEvidence
        ? "Open the evidence note for the last Test Run"
        : "No evidence for the last run yet",
    );

    this.renderMeta(active, last);
  }

  /**
   * Sets a control's reason text as BOTH aria-label and visible tooltip — a
   * disabled button whose explanation lives only in the aria-label tells
   * sighted users nothing (C13).
   */
  private labelControl(button: HTMLButtonElement, label: string): void {
    button.setAttr("aria-label", label);
    button.setAttr("title", label);
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
      this.meta.dataset.status = last.status;
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

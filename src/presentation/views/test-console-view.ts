import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { TestRunStatus } from "../../domain/entities/test-run";
import type { DomainEvent } from "../../domain/events/domain-event";
import type { EventBus, Unsubscribe } from "../../shared/event-bus/event-bus";
import { formatOutputLine, formatStatusBanner, statusModifier } from "./test-console-format";

export const TEST_CONSOLE_VIEW_TYPE = "e2e-test-hub-console";

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
 * Live "Test Console" panel (US-030, UC-015). Subscribes to the `testrun.*`
 * lifecycle and streams output lines as they arrive, then shows the terminal
 * status banner. Formatting is delegated to the pure {@link test-console-format}
 * helpers so the rendering rules are unit-tested without a DOM.
 */
export class TestConsoleView extends ItemView {
  private readonly subscriptions: Unsubscribe[] = [];
  private output!: HTMLElement;
  private banner!: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly eventBus: EventBus,
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
    this.banner = container.createEl("div", { cls: "e2e-test-hub-console-banner" });
    this.output = container.createEl("pre", { cls: "e2e-test-hub-console-output" });

    this.subscriptions.push(
      this.eventBus.subscribe<StartedPayload>("testrun.started", (event) =>
        this.onStarted(event),
      ),
      this.eventBus.subscribe<OutputPayload>("testrun.output.received", (event) =>
        this.onOutputReceived(event),
      ),
      this.eventBus.subscribe<CompletedPayload>("testrun.completed", (event) =>
        this.onTerminal(event.payload.status, event.payload.durationMs),
      ),
      this.eventBus.subscribe("testrun.failed", () => this.onTerminal("errored")),
      this.eventBus.subscribe("testrun.cancelled", () => this.onTerminal("cancelled")),
    );
  }

  async onClose(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  private onStarted(event: DomainEvent<StartedPayload>): void {
    this.output.empty();
    this.setBanner("running");
    this.output.createEl("div", {
      text: `$ ${event.payload.command}`,
      cls: "e2e-test-hub-console-cmd",
    });
  }

  private onOutputReceived(event: DomainEvent<OutputPayload>): void {
    this.output.createEl("div", {
      text: formatOutputLine(event.payload.stream, event.payload.line),
      cls: event.payload.stream === "stderr" ? "e2e-test-hub-console-stderr" : undefined,
    });
  }

  private onTerminal(status: TestRunStatus, durationMs?: number): void {
    this.setBanner(status, durationMs);
  }

  private setBanner(status: TestRunStatus, durationMs?: number): void {
    this.banner.setText(formatStatusBanner(status, durationMs));
    this.banner.dataset.status = statusModifier(status);
  }
}

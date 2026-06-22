import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { renderListHeader } from "./list-header";
import { LiveRefresh } from "./live-refresh";

/**
 * Base for the event-driven Test Hub views (the explorers and dashboards). Owns
 * the {@link LiveRefresh} lifecycle every such view repeated verbatim — build
 * the helper around the subclass's render(), subscribe on view open, tear down
 * on view close — so a subclass declares only WHICH events refresh it and HOW
 * to render. Extracted from the V1 explorers/dashboards (pre-V2 plan item 1.6)
 * so V2's new views (triage, readiness, step library) start from one
 * implementation instead of a copied preamble.
 *
 * `onOpen`/`onClose` are the shared default; a view that needs more on open (the
 * dashboard publishes `dashboard.opened` and pushes a refresh; the Use Case
 * detail view tracks an `isOpen` flag) overrides them and drives `this.live`
 * directly.
 */
export abstract class LiveDashboardView extends ItemView {
  protected readonly live: LiveRefresh;

  constructor(
    leaf: WorkspaceLeaf,
    eventBus: EventBus,
    /** The domain events whose occurrence re-renders this view. */
    protected readonly refreshOn: readonly DomainEventType[],
  ) {
    super(leaf);
    this.live = new LiveRefresh(eventBus, () => this.render());
  }

  /** Rebuilds the view's content; scheduled (coalesced) through {@link LiveRefresh}. */
  protected abstract render(): void | Promise<void>;

  async onOpen(): Promise<void> {
    await this.live.open(this.refreshOn);
  }

  async onClose(): Promise<void> {
    this.live.close();
  }

  /**
   * The list-explorer preamble shared by the PRDs / Use Cases / Test Suites
   * panels: clears `this.contentEl` and writes the header bar, returning the
   * content element so the caller fills the list below the bar. A thin wrapper
   * over the host-agnostic {@link renderListHeader} (which takes the target
   * element explicitly) so the same writer fills a standalone leaf and the
   * (later) Test Hub body identically.
   */
  protected renderListHeader(options: {
    headerCls: string;
    title: string;
    actionLabel: string;
    onAction: () => void;
  }): HTMLElement {
    const container = this.contentEl;
    renderListHeader(container, options);
    return container;
  }
}

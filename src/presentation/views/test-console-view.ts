import { ItemView, type WorkspaceLeaf } from "obsidian";
import TestConsoleApp from "../vue/test-console/TestConsoleApp.vue";
import { TEST_CONSOLE_DEPS, type TestConsoleDeps } from "../vue/test-console/test-console-deps";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";

export const TEST_CONSOLE_VIEW_TYPE = "e2e-test-hub-console";

export type { TestConsoleDeps } from "../vue/test-console/test-console-deps";

/**
 * Live "Test Console" panel (US-030, UC-015). Subscribes to the `testrun.*`
 * lifecycle and streams output as it arrives, then shows the terminal status
 * banner; a header toolbar lets a user cancel, re-run, open evidence, and clear.
 *
 * Vue-migrated (ADR-0033 Phase 4): this class is now a thin Obsidian shell that
 * mounts {@link TestConsoleApp} into `contentEl` and provides its dependency
 * slice. The component owns the bus subscriptions and the live elapsed timer
 * (torn down on unmount); the high-frequency output stream stays imperative
 * inside `ConsoleOutputStream` so a long run never re-renders a reactive list.
 */
export class TestConsoleView extends ItemView {
  private mounted: MountedVueView | null = null;

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
    this.mounted = mountVueView(this.contentEl, TestConsoleApp, (app) => {
      app.provide(TEST_CONSOLE_DEPS, this.deps);
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}

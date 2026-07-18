import { ItemView, type WorkspaceLeaf } from "obsidian";
import { ref, type Ref } from "vue";
import PendingStepsApp from "../vue/pending-steps/PendingStepsApp.vue";
import {
  PENDING_STEPS_DEPS,
  PENDING_STEPS_TARGET,
  type PendingStepsDeps,
} from "../vue/pending-steps/pending-steps-deps";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";
import { readPersistedPendingStepsTarget, type PendingStepsTarget } from "./pending-steps-rows";

export const PENDING_STEPS_VIEW_TYPE = "e2e-test-hub-pending-steps";

/**
 * The Pending Steps right-sidebar companion (WS1/C2, spec D5): a targeted leaf
 * (use-case / feature / vault) that guides step-definition implementation.
 * Thin Obsidian shell over {@link PendingStepsApp} (ADR-0033); the target Ref
 * follows the Use Case detail's restore-gap pattern — setState writes the ref
 * before onOpen, so the app's initial load reads whatever is already there and
 * a leaf reuse (already mounted) reloads through the app's `watch(target)`.
 */
export class PendingStepsView extends ItemView {
  private mounted: MountedVueView | null = null;
  private readonly target: Ref<PendingStepsTarget> = ref({ kind: "vault" });

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: PendingStepsDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PENDING_STEPS_VIEW_TYPE;
  }

  getDisplayText(): string {
    // Sentence case per obsidianmd/ui/sentence-case: "Pending Steps" is a
    // product-surface name but not (yet) a registered glossary brand, so the
    // leaf title follows the Obsidian UI-copy convention like the plan's other
    // "pending steps" strings.
    return "Pending steps";
  }

  getIcon(): string {
    return "list-checks";
  }

  /** Persist the current target so the leaf survives a workspace reload. */
  getState(): Record<string, unknown> {
    return { target: this.target.value };
  }

  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    // Writing the ref is all both paths need: on a workspace restore (setState
    // before onOpen) the app's first load reads it; on a leaf reuse (already
    // mounted) the app's watch reloads. An unrecognised/corrupt payload leaves
    // the ref untouched (readPersistedPendingStepsTarget returns null), keeping
    // whatever target is current rather than silently resetting to vault.
    const restored = readPersistedPendingStepsTarget(state);
    if (restored !== null) this.target.value = restored;
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, PendingStepsApp, (app) => {
      app.provide(PENDING_STEPS_DEPS, this.deps);
      app.provide(PENDING_STEPS_TARGET, this.target);
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}

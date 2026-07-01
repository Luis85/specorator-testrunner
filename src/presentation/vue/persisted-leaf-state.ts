/**
 * Bridges a slice of view-state to Obsidian's per-leaf persistence (ADR-0033).
 *
 * `setState()` is only the RESTORE hook — it does NOT persist. Persistence happens
 * by updating the field `getState()` returns and asking Obsidian to re-serialize
 * the layout (`requestSaveLayout`), which re-reads `getState()`. This helper holds
 * the live value, exposes it for `getState()`, persists a change through
 * `requestSaveLayout`, and restores from `setState()` WITHOUT re-saving (the value
 * is already on disk). Used by the migrated views whose state mutates from WITHIN
 * the leaf (e.g. the hub's active section changing on a rail click) — the case a
 * plain `setState()` write would silently fail to persist.
 */
export class PersistedLeafState<T> {
  private value: T;

  constructor(
    initial: T,
    /** Serializes the layout so Obsidian re-reads getState() — usually `() => app.workspace.requestSaveLayout()`. */
    private readonly requestSave: () => void,
  ) {
    this.value = initial;
  }

  /** The current value — return this from the view's `getState()`. */
  get(): T {
    return this.value;
  }

  /**
   * Persist a NEW value from within the leaf: store it, then ask Obsidian to
   * re-serialize the layout (which re-reads `getState()`). A no-op when unchanged
   * so an idempotent set doesn't churn the layout save.
   */
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.requestSave();
  }

  /**
   * Restore a value handed back by `setState()` on a workspace reload WITHOUT
   * triggering a save — it is already persisted, and re-saving during restore is
   * both redundant and reentrant. Returns whether the value actually changed, so
   * the caller can decide whether to re-navigate/re-render.
   */
  restore(next: T): boolean {
    if (Object.is(next, this.value)) return false;
    this.value = next;
    return true;
  }
}

import { type App as VueApp, type Component, createApp } from "vue";
import { createPinia } from "pinia";

/** Handle an Obsidian view holds so `onClose` can tear its Vue app down. */
export interface MountedVueView {
  /** Unmounts the Vue app (running every component's onUnmounted teardown). */
  unmount(): void;
}

/**
 * Mounts a PER-LEAF Vue app into an Obsidian view's `contentEl` (ADR-0033).
 *
 * Each Obsidian leaf is an independent view instance with its own persisted
 * state, so every leaf gets a FRESH `createApp` + `createPinia` here — never a
 * shared global app/store. The optional `setup` runs against the app before
 * mount so the caller can `app.provide(KEY, deps)` the view's dependency slice
 * (services, the event bus, the action flows) into the component tree.
 *
 * The returned {@link MountedVueView.unmount} is called from the view's
 * `onClose`; unmounting runs each component's `onUnmounted`, which is where
 * {@link useEventBus} drops its bus subscriptions — so the teardown path mirrors
 * the old `LiveRefresh.close()`.
 */
export function mountVueView(
  el: HTMLElement,
  component: Component,
  setup?: (app: VueApp) => void,
): MountedVueView {
  const app = createApp(component);
  // Per-leaf Pinia: view-state stores are scoped to this app, so two open leaves
  // never share a singleton store (ADR-0033).
  app.use(createPinia());
  setup?.(app);
  app.mount(el);
  return {
    unmount() {
      app.unmount();
    },
  };
}

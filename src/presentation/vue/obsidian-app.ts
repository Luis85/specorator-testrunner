import type { App } from "obsidian";
import type { InjectionKey } from "vue";

/**
 * Provides the Obsidian {@link App} into a mounted Vue tree (ADR-0033) for the
 * few components that open a `Modal` (which needs the app). A view supplies it in
 * its `onOpen` via `mountVueView`'s setup: `app.provide(OBSIDIAN_APP, this.app)`.
 */
export const OBSIDIAN_APP = Symbol("obsidian-app") as InjectionKey<App>;

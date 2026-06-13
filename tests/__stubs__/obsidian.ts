/**
 * Test-only runtime stub for the `obsidian` package. The published `obsidian`
 * dependency ships TYPES ONLY (no runtime entry), so any module under test that
 * imports a *value* from "obsidian" (e.g. `Notice`, `setIcon`) cannot be loaded
 * by Vitest without a runtime stand-in. Vitest aliases "obsidian" to this file
 * (see vitest.config.ts). Only the values the presentation modules under test
 * actually import need to exist here; behaviour is irrelevant because the
 * launcher injects its own `notify` spy.
 */

export class Notice {
  constructor(
    public readonly message: string,
    public readonly timeout?: number,
  ) {}
}

export const setIcon = (_el: unknown, _icon: string): void => {
  // No-op: icon rendering is not exercised in unit tests.
};

/**
 * Minimal Modal stub for unit tests. Only the class shape is needed; no
 * behaviour is exercised by the settings-tab tests (Modal is imported by
 * AddEnvironmentModal which settings-tab.ts transitively imports).
 */
export class Modal {
  constructor(public readonly app: unknown) {}
  open(): void {}
  close(): void {}
}

/**
 * Minimal Setting stub for unit tests.
 */
export class Setting {
  settingEl: HTMLElement = {} as HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(_containerEl: unknown) {}
  addText(_cb: (text: unknown) => void): this {
    return this;
  }
  addButton(_cb: (btn: unknown) => void): this {
    return this;
  }
  addExtraButton(_cb: (btn: unknown) => void): this {
    return this;
  }
  addDropdown(_cb: (dd: unknown) => void): this {
    return this;
  }
  setName(_name: string): this {
    return this;
  }
  setDesc(_desc: string): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  settingEl_: HTMLElement = {} as HTMLElement;
}

/**
 * Minimal ItemView stub for unit tests. View files that extend ItemView cannot
 * be loaded by Vitest without this (register-commands.ts transitively imports
 * several view modules). Behaviour is irrelevant for command-smoke tests.
 */
export class ItemView {
  constructor(public readonly leaf: unknown) {}
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  onOpen(): Promise<void> {
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Minimal TextFileView stub (feature-editor-view extends it).
 */
export class TextFileView extends ItemView {
  data = "";
  getViewData(): string {
    return this.data;
  }
  setViewData(_data: string, _clear: boolean): void {}
  clear(): void {}
}

/**
 * Minimal FuzzySuggestModal stub (run-picker-modal / generate-feature-modal
 * extend it). The command callbacks that open these call `.open()` — the inert
 * stub is all that is needed.
 */
export class FuzzySuggestModal<T> {
  constructor(public readonly app: unknown) {}
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return "";
  }
  onChooseItem(_item: T, _evt: unknown): void {}
  open(): void {}
  close(): void {}
}

/**
 * Minimal debounce stub — returns a no-op function with cancel/run.
 */
export const debounce = <T extends (...args: unknown[]) => void>(
  fn: T,
  _ms: number,
  _immediate?: boolean,
): T & { cancel(): void; run(): void } => {
  const wrapped = fn as T & { cancel(): void; run(): void };
  wrapped.cancel = (): void => {};
  wrapped.run = (): void => {};
  return wrapped;
};

/**
 * Minimal PluginSettingTab stub for unit tests. The real class ships with
 * Obsidian 1.13+ and provides a concrete `display()` that delegates to
 * `getSettingDefinitions()`. This stub models that: it has a concrete
 * `display()` so tests can verify the 1.13+ delegation path. Tests that
 * simulate the pre-1.13 legacy path must remove `display` from this
 * prototype in a beforeEach (and restore it in afterEach).
 */
export class PluginSettingTab {
  containerEl: HTMLElement = { empty: () => {}, createEl: () => ({}) } as unknown as HTMLElement;

  constructor(
    public readonly app: unknown,
    public readonly plugin: unknown,
  ) {}

  /** Obsidian 1.13+ concrete bridge — calls getSettingDefinitions(). */
  display(): void {
    // In the real app this triggers a declarative render; in tests it is a no-op
    // unless the test overrides it.
  }

  hide(): void {}
  update(): void {}
}

import {
  type ButtonComponent,
  Notice,
  type Plugin,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
  type SettingGroupItem,
  type TextComponent,
  debounce,
} from "obsidian";

import { BROWSER_NAMES } from "../../domain/settings/settings";
import type {
  BrowserName,
  TestHubPathSettings,
  TestHubSettings,
} from "../../domain/settings/settings";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { checklistRow } from "./settings-rows";
import { SutEnvironmentSection } from "./settings-environments";
import { MaintenanceSection } from "./settings-maintenance";
import {
  actionWithResultRow,
  PERSIST_DEBOUNCE_MS,
  renderChecklist,
  runButtonAction,
  type SettingsHost,
  type SettingsSectionContext,
  type SettingsTabServices,
} from "./settings-shared";

// Re-export the host/services contracts so existing importers (main.ts, the
// settings-tab tests) keep their import path after the extraction.
export type { SettingsHost, SettingsTabServices };

interface PathFieldSpec {
  key: keyof TestHubPathSettings;
  name: string;
  desc: string;
}

const PATH_FIELDS: PathFieldSpec[] = [
  { key: "testHubPath", name: "Test Hub folder", desc: "Dashboard and documentation." },
  { key: "useCasesPath", name: "Use Cases folder", desc: "Business-facing Use Case notes." },
  { key: "specificationsPath", name: "Specifications folder", desc: "Specification notes." },
  { key: "featureFilesPath", name: "Feature files folder", desc: "Gherkin `.feature` files." },
  { key: "testSuitesPath", name: "Test Suites folder", desc: "Tag-driven suite notes." },
  { key: "evidencePath", name: "Test Evidence folder", desc: "Audit trail for each run." },
  {
    key: "testRunnerPath",
    name: ".testrunner folder",
    desc: "The self-contained Node test project.",
  },
];

/**
 * The slice of a {@link SettingDefinitionItem} the legacy (pre-1.13) renderer
 * consumes, modelled structurally so it never depends on the exact shape of
 * Obsidian's declarative union (which the legacy path must build without the
 * 1.13 framework). `getSettingDefinitions()` only ever emits headed groups and
 * bare rows, and each row carries its wiring in `render` — exactly what these
 * capture.
 */
interface LegacyRenderableRow {
  name?: string;
  desc?: string;
  render?: (setting: Setting, group: { listEl: HTMLElement }) => unknown;
}
interface LegacyGroup {
  type: "group";
  heading: string;
  cls?: string;
  items: LegacyRenderableRow[];
}
type LegacyDefinition = LegacyGroup | LegacyRenderableRow;

// A headed group is the only definition variant that carries `type`, so its
// presence is a sufficient discriminator.
const isLegacyGroup = (item: LegacyDefinition): item is LegacyGroup => "type" in item;

/**
 * Edit paths, manage SUT environments (ADR-0013/0014), run maintenance and CI
 * actions with inline results, validate, reset (US-003, BBV §4 `SettingsTab`).
 * The SUT-environment and maintenance/CI sections live in their own modules
 * (size budget); this tab owns the framework bridge, the Folders + Runner
 * sections, and the shared pending-flush/timeout lifecycle the sections register
 * into.
 */
export class TestHubSettingTab extends PluginSettingTab {
  /** Pending per-field persist debouncers, flushed on close / cancelled on re-render. */
  private readonly pendingFlushes: { cancel(): void; run(): void }[] = [];

  /**
   * Pending `window.setTimeout` handles (e.g. the remove-environment two-click
   * disarm), cleared on re-render / close so an orphaned timeout can't fire into
   * a button that a later refreshTab() already rebuilt.
   */
  private readonly pendingTimeouts: number[] = [];

  private readonly sutSection: SutEnvironmentSection;
  private readonly maintenanceSection: MaintenanceSection;

  constructor(
    plugin: Plugin,
    private readonly host: SettingsHost,
    private readonly services: SettingsTabServices,
  ) {
    super(plugin.app, plugin);
    const ctx = this.sectionContext();
    this.sutSection = new SutEnvironmentSection(ctx);
    this.maintenanceSection = new MaintenanceSection(ctx);
  }

  /** The seam the extracted sections persist/refresh through (see {@link SettingsSectionContext}). */
  private sectionContext(): SettingsSectionContext {
    return {
      app: this.app,
      services: this.services,
      getSettings: () => this.host.getSettings(),
      updateSettings: (next) => this.host.updateSettings(next),
      resetSettings: () => this.host.resetSettings(),
      registerFlush: (flush) => void this.pendingFlushes.push(flush),
      registerTimeout: (handle) => void this.pendingTimeouts.push(handle),
      refreshTab: () => this.refreshTab(),
    };
  }

  /** Cancels any debounced saves + pending timeouts queued from a prior render (PRES-L2). */
  private cancelPendingFlushes(): void {
    for (const flush of this.pendingFlushes) flush.cancel();
    this.pendingFlushes.length = 0;
    for (const handle of this.pendingTimeouts) window.clearTimeout(handle);
    this.pendingTimeouts.length = 0;
  }

  /**
   * The Obsidian 1.13 declarative settings API (`getSettingDefinitions()`) only
   * exists on 1.13+. On those builds the concrete base `display()` bridges to
   * it, so this returns the base method to delegate to. On pre-1.13 builds the
   * base prototype has no `display` at all — detected here at runtime (not via
   * typings) — and this returns `undefined`, signalling the legacy render path.
   *
   * Anchored to `PluginSettingTab.prototype` explicitly (not
   * `Object.getPrototypeOf`) so an intermediate class in the hierarchy can never
   * change which `display()` we detect; narrowed to the call signature before
   * use.
   */
  private declarativeDisplay(): (() => void) | undefined {
    const baseProto: unknown = PluginSettingTab.prototype;
    return baseProto !== null &&
      typeof baseProto === "object" &&
      "display" in baseProto &&
      typeof baseProto.display === "function"
      ? (baseProto as { display: () => void }).display
      : undefined;
  }

  /**
   * Pre-1.13 Obsidian apps (reachable via BRAT, which does not enforce
   * `minAppVersion`, while 1.13 is still in development) call `display()`
   * directly when opening the settings tab. Without this override they crash
   * with `e.display is not a function` because the base class
   * `SettingTab.display()` does not exist in those versions.
   *
   * On Obsidian 1.13+ we delegate to the base `display()` (the future,
   * declarative implementation built on {@link getSettingDefinitions}) rather
   * than duplicating its render logic. On pre-1.13 builds we render the legacy
   * settings imperatively — same rows, same wiring, driven from the very same
   * definitions — so the two implementations can never drift apart.
   */
  display(): void {
    const baseDisplay = this.declarativeDisplay();
    if (baseDisplay !== undefined) {
      baseDisplay.call(this);
      return;
    }
    this.renderLegacy();
  }

  /**
   * Legacy (pre-1.13) imperative render: walks the SAME
   * {@link getSettingDefinitions} the 1.13 framework would, building each row
   * through the long-stable imperative `Setting` API. One source of truth means
   * old and new Obsidian show identical settings; only the render mechanism
   * differs.
   */
  private renderLegacy(): void {
    this.cancelPendingFlushes();
    this.containerEl.empty();
    // One bridging cast from the framework's declarative union to the
    // structural slice the interpreter consumes (see {@link LegacyDefinition}).
    const definitions = this.getSettingDefinitions() as unknown as LegacyDefinition[];
    for (const item of definitions) this.renderLegacyDefinition(this.containerEl, item);
  }

  private renderLegacyDefinition(parent: HTMLElement, item: LegacyDefinition): void {
    if (isLegacyGroup(item)) {
      // A group with a `cls` (e.g. the per-environment block) gets its own
      // wrapper element so the styling hook the declarative API would apply
      // still lands; headingless groups are not produced, so render it always.
      const groupEl = item.cls === undefined ? parent : parent.createDiv({ cls: item.cls });
      new Setting(groupEl).setName(item.heading).setHeading();
      for (const child of item.items) this.renderLegacyItem(groupEl, child);
      return;
    }
    this.renderLegacyItem(parent, item);
  }

  private renderLegacyItem(parent: HTMLElement, item: LegacyRenderableRow): void {
    const setting = new Setting(parent);
    if (item.name !== undefined) setting.setName(item.name);
    if (item.desc !== undefined) setting.setDesc(item.desc);
    // Each row's interactive wiring lives in its `render` escape hatch — the
    // exact callbacks the 1.13 declarative API drives. The framework passes a
    // "group" context there; our callbacks use only its `listEl` (to create the
    // sibling result/error containers they then position next to the setting),
    // so a shim exposing this parent as `listEl` satisfies them. Any returned
    // cleanup is intentionally dropped: the legacy path rebuilds the whole
    // container on every refresh, and each render reassigns its own state.
    item.render?.(setting, { listEl: parent });
  }

  // Obsidian invokes hide() when the settings tab closes; fallow can't see that
  // cross-boundary call, so the override otherwise reads as an unused member.
  // fallow-ignore-next-line unused-class-member
  hide(): void {
    // Closing the dialog must NOT cancel a save still inside the 600ms persist
    // window — that would silently lose the last edit. Flush (run) pending
    // debouncers instead; the refreshTab() re-render path keeps cancelling via
    // cancelPendingFlushes, since its inputs are rebuilt from persisted state.
    for (const flush of this.pendingFlushes) flush.run();
    this.pendingFlushes.length = 0;
    for (const handle of this.pendingTimeouts) window.clearTimeout(handle);
    this.pendingTimeouts.length = 0;
  }

  /**
   * Re-renders the open tab from persisted state; pending debouncers are
   * cancelled first because every input is rebuilt from what was actually saved
   * (PRES-L2). On 1.13+ this is the framework's declarative `update()`; on
   * pre-1.13 (no `update()`) the legacy render rebuilds `containerEl` directly.
   */
  private refreshTab(): void {
    if (this.declarativeDisplay() !== undefined) {
      this.cancelPendingFlushes();
      this.update();
      return;
    }
    this.renderLegacy();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      // No top-level title element: the Obsidian guidelines own the tab heading.
      { type: "group", heading: "Folders", items: PATH_FIELDS.map((field) => this.pathRow(field)) },
      // ── Runner (US-055 browser matrix) ────────────────────────────────────
      { type: "group", heading: "Runner", items: [this.browsersRow(), this.installBrowsersRow()] },
      // ── System under test (ADR-0013 environments, ADR-0014 auth) ──────────
      ...this.sutSection.definitions(),
      // ── Maintenance + Continuous integration (UC-019/UC-020) ──────────────
      ...this.maintenanceSection.definitions(),
    ];
  }

  // ── Paths (existing behaviour, unchanged) ─────────────────────────────────

  private pathRow(field: PathFieldSpec): SettingGroupItem {
    return {
      name: field.name,
      desc: field.desc,
      render: (setting) => {
        setting.addText((text) => {
          text.setPlaceholder(field.key).setValue(this.host.getSettings().paths[field.key]);
          // Persisting on every keystroke spams the service (and "Invalid
          // setting" Notices) with intermediate, half-typed paths. Debounce so
          // we only validate-then-save once typing settles (PRES-M1).
          const flush = debounce(
            (value: string) => void this.persistPath(field.key, value.trim(), text),
            PERSIST_DEBOUNCE_MS,
            true,
          );
          this.pendingFlushes.push(flush);
          text.onChange((value) => flush(value));
          // Also persist immediately on blur so a quick edit + tab-away isn't
          // lost to the still-pending debounce.
          text.inputEl.addEventListener("blur", () => {
            flush.cancel();
            void this.persistPath(field.key, text.getValue().trim(), text);
          });
        });
      },
    };
  }

  private async persistPath(
    key: keyof TestHubPathSettings,
    value: string,
    field: TextComponent,
  ): Promise<void> {
    const current = this.host.getSettings();
    // No-op if the field already matches the persisted value (e.g. a blur after
    // the debounce already saved, or an unedited blur) — avoids redundant saves.
    if (current.paths[key] === value) return;

    // The user-typed value is staged here and authoritatively validated by
    // SettingsService.save() (US-003), so it is branded, not re-validated here;
    // a rejected save leaves persisted state unchanged.
    const paths = { ...current.paths, [key]: unsafeVaultPath(value) };
    // Documentation lives inside the Test Hub folder (see the vault layout), so
    // keep documentationPath in sync rather than orphaning the generated docs
    // in the previous location.
    if (key === "testHubPath") paths.documentationPath = unsafeVaultPath(value);
    const next: TestHubSettings = { ...current, paths };
    // The service is the authoritative validator (US-003); a rejected save must
    // leave persisted state unchanged.
    const result = await this.host.updateSettings(next);
    if (!result.ok) {
      new Notice(`Invalid setting: ${result.error.message}`);
      // Re-sync the input to the persisted value so the UI and state don't
      // diverge after a rejected save (PRES-M1).
      field.setValue(this.host.getSettings().paths[key]);
    }
  }

  // ── Runner (US-055 browser matrix) ───────────────────────────────────────

  /**
   * Three browser toggles (Chromium, Firefox, WebKit) reflecting and editing
   * `settings.runner.browsers`. Enforces non-empty: the last remaining enabled
   * browser cannot be turned off — its toggle is disabled when it is the sole
   * selection. Persists via the same `updateSettings` path as every other field.
   */
  private browsersRow(): SettingGroupItem {
    return {
      name: "Browsers",
      desc: "Select which Playwright browsers are used for test runs. At least one must be enabled.",
      render: (setting) => {
        for (const browser of BROWSER_NAMES) {
          const label =
            browser === "webkit" ? "WebKit" : browser.charAt(0).toUpperCase() + browser.slice(1);
          // A VISIBLE name precedes each toggle: three adjacent switches with only
          // an aria-label left sighted users guessing which controls which browser.
          setting.controlEl.createSpan({ cls: "e2e-test-hub-browser-toggle-label", text: label });
          setting.addToggle((toggle) => {
            // Reflect the current selection from persisted settings.
            const currentBrowsers = this.host.getSettings().runner.browsers;
            const isEnabled = currentBrowsers.includes(browser);
            // Disable the toggle when this browser is the sole enabled one —
            // turning it off would leave `browsers` empty, which is invalid.
            const isLast = isEnabled && currentBrowsers.length === 1;
            toggle.setValue(isEnabled);
            toggle.setDisabled(isLast);
            toggle.toggleEl.setAttribute("aria-label", label);
            toggle.onChange((value) => void this.persistBrowser(browser, value));
          });
        }
      },
    };
  }

  private async persistBrowser(browser: BrowserName, enabled: boolean): Promise<void> {
    const current = this.host.getSettings();
    const prev = current.runner.browsers;
    let next: BrowserName[];
    if (enabled) {
      // Add if not already present.
      next = prev.includes(browser) ? prev : [...prev, browser];
    } else {
      next = prev.filter((b) => b !== browser);
    }
    // Non-empty guard: if toggling off would empty the list, silently restore
    // the last browser. (The toggle UI also prevents this via setDisabled, but
    // this double-guard protects against race conditions / programmatic calls.)
    if (next.length === 0) next = prev;
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    const result = await this.host.updateSettings({
      ...current,
      runner: { ...current.runner, browsers: next },
    });
    if (!result.ok) {
      new Notice(`Could not save browser selection: ${result.error.message}`);
    }
    // Re-render so disabled states are recomputed from persisted state.
    this.refreshTab();
  }

  /**
   * "Install selected browsers" button — invokes
   * `RunnerInstallationService.installBrowsers` with the current settings (the
   * service reads `settings.runner.browsers` to build the argv). Reuses the
   * same actionWithResultRow shape as validate/repair/CI rows.
   */
  private installBrowsersRow(): SettingGroupItem {
    return actionWithResultRow(
      "Install selected browsers",
      "Download and install the selected Playwright browsers into the .testrunner project.",
      "Install browsers",
      (button, resultEl) => this.runInstallBrowsers(button, resultEl),
    );
  }

  private async runInstallBrowsers(button: ButtonComponent, resultEl: HTMLElement): Promise<void> {
    await runButtonAction(
      button,
      resultEl,
      "Installing browsers…",
      "Browser install failed: ",
      async () => {
        const settings = this.host.getSettings();
        const result = await this.services.installation.installBrowsers(settings);
        if (result.ok) {
          const names = settings.runner.browsers.join(", ");
          renderChecklist(resultEl, [checklistRow("ok", `Installed: ${names}.`)]);
        } else {
          renderChecklist(resultEl, [checklistRow("error", result.error.message)]);
        }
      },
    );
  }
}

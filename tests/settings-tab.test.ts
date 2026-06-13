import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestHubSettingTab } from "../src/presentation/settings/settings-tab";
import { PluginSettingTab } from "./__stubs__/obsidian";

/**
 * The stub's PluginSettingTab has a concrete display() that models Obsidian
 * 1.13+ behaviour. Tests that need to simulate a pre-1.13 build delete the
 * method from the prototype (and restore it in afterEach).
 *
 * display() is technically deprecated in the Obsidian 1.13 typings (plugins
 * should use getSettingDefinitions()), but we MUST test it here: that is
 * exactly the crash path we are guarding (BRAT installs on pre-1.13 call
 * display() directly, while 1.13 is still in development). The
 * eslint-disable-next-line directives below are intentional — do not remove
 * them.
 */

const makeTab = (): TestHubSettingTab => {
  // Minimal fakes: the display() tests only exercise containerEl interactions.
  const fakePlugin = {
    app: {},
  } as unknown as ConstructorParameters<typeof TestHubSettingTab>[0];
  const fakeHost = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
  } as unknown as ConstructorParameters<typeof TestHubSettingTab>[1];
  const fakeServices = {} as unknown as ConstructorParameters<typeof TestHubSettingTab>[2];
  return new TestHubSettingTab(fakePlugin, fakeHost, fakeServices);
};

/**
 * A tiny element double recording the calls the legacy renderer makes
 * (`empty`, `createDiv`, `createEl`). `createDiv` returns a fresh double so
 * nested groups work.
 */
interface FakeEl {
  empty: ReturnType<typeof vi.fn>;
  createDiv: ReturnType<typeof vi.fn>;
  createEl: ReturnType<typeof vi.fn>;
}
const makeFakeEl = (): FakeEl => ({
  empty: vi.fn(),
  createDiv: vi.fn(() => makeFakeEl()),
  createEl: vi.fn(() => ({})),
});

describe("TestHubSettingTab.display()", () => {
  // Restore spies even when an assertion throws (watch-mode leak otherwise).
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates to the base class display() when running on Obsidian 1.13+", () => {
    // The stub's PluginSettingTab has a concrete display() — mirrors 1.13+ runtime.
    const baseSpy = vi.spyOn(PluginSettingTab.prototype, "display");
    const tab = makeTab();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    tab.display();
    expect(baseSpy).toHaveBeenCalledOnce();
  });

  describe("pre-1.13 legacy render (base prototype has no display)", () => {
    // Simulate a pre-1.13 Obsidian build by removing display from the base
    // prototype before constructing the tab, then restoring it afterwards.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const savedDisplay = PluginSettingTab.prototype.display;

    beforeEach(() => {
      delete (PluginSettingTab.prototype as Partial<typeof PluginSettingTab.prototype>).display;
    });

    afterEach(() => {
      PluginSettingTab.prototype.display = savedDisplay;
    });

    it("renders the shared settings definitions instead of an upgrade notice", () => {
      const tab = makeTab();
      // Stub the shared definitions to empty so the branch is exercised without
      // driving the full imperative render through the minimal element double.
      const defsSpy = vi.spyOn(tab, "getSettingDefinitions").mockReturnValue([]);
      const container = makeFakeEl();
      (tab as unknown as { containerEl: unknown }).containerEl = container;

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      tab.display();

      // The legacy path now drives the same declarative definitions as 1.13+…
      expect(defsSpy).toHaveBeenCalledOnce();
      expect(container.empty).toHaveBeenCalledOnce();
      // …and no longer renders the old "requires Obsidian 1.13+" upgrade notice.
      expect(container.createEl).not.toHaveBeenCalled();
    });

    it("interprets groups (with cls wrappers) and invokes each row's render hook", () => {
      const tab = makeTab();
      const groupRowRender = vi.fn();
      const bareRowRender = vi.fn();
      vi.spyOn(tab, "getSettingDefinitions").mockReturnValue([
        {
          type: "group",
          heading: "Folders",
          items: [{ name: "A", desc: "da", render: groupRowRender }],
        },
        { name: "Add environment", desc: "d", render: bareRowRender },
        { type: "group", heading: "staging", cls: "e2e-test-hub-env-block", items: [] },
      ] as unknown as ReturnType<typeof tab.getSettingDefinitions>);
      const container = makeFakeEl();
      (tab as unknown as { containerEl: unknown }).containerEl = container;

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      tab.display();

      // A group carrying a `cls` is wrapped in its own element (the styling hook
      // the declarative API would otherwise apply); plain groups render in place.
      expect(container.createDiv).toHaveBeenCalledWith({ cls: "e2e-test-hub-env-block" });
      // Both grouped and bare rows get their render escape hatch invoked with a
      // `listEl` shim so they can attach sibling result/error containers.
      expect(groupRowRender).toHaveBeenCalledOnce();
      expect(bareRowRender).toHaveBeenCalledOnce();
      const [, group] = groupRowRender.mock.calls[0] as [unknown, { listEl: unknown }];
      expect(group).toHaveProperty("listEl");
    });
  });
});

describe("TestHubSettingTab.markDestructive()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const markDestructive = (tab: TestHubSettingTab, button: unknown): void =>
    (tab as unknown as { markDestructive(b: unknown): void }).markDestructive(button);

  it("uses setDestructive() when present (Obsidian 1.13+)", () => {
    const tab = makeTab();
    const setDestructive = vi.fn();
    const setWarning = vi.fn();
    markDestructive(tab, { setDestructive, setWarning });
    expect(setDestructive).toHaveBeenCalledOnce();
    expect(setWarning).not.toHaveBeenCalled();
  });

  it("falls back to setWarning() on pre-1.13 builds without setDestructive()", () => {
    const tab = makeTab();
    const setWarning = vi.fn();
    markDestructive(tab, { setWarning });
    expect(setWarning).toHaveBeenCalledOnce();
  });
});

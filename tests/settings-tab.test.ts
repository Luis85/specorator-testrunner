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
 * display() directly). The eslint-disable-next-line directives below are
 * intentional — do not remove them.
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

  describe("pre-1.13 fallback (base prototype has no display)", () => {
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

    it("renders the requires-1.13 notice text into containerEl", () => {
      const tab = makeTab();
      // Capture the text passed to createEl so we can assert on it.
      let capturedText = "";
      const emptySpy = vi.fn();
      const createElSpy = vi.fn((_tag: string, opts: { text?: string }) => {
        capturedText = opts?.text ?? "";
        return {};
      });
      // Replace containerEl with a minimal test double.
      (tab as unknown as { containerEl: unknown }).containerEl = {
        empty: emptySpy,
        createEl: createElSpy,
      };

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      tab.display();

      expect(emptySpy).toHaveBeenCalledOnce();
      expect(createElSpy).toHaveBeenCalledOnce();
      expect(capturedText).toContain("Specorator Testrunner");
      expect(capturedText).toContain("Obsidian 1.13");
      expect(capturedText).toContain("Update Obsidian");
    });
  });
});

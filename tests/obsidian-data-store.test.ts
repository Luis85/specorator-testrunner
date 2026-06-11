import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import { ObsidianDataStore } from "../src/infrastructure/obsidian/obsidian-data-store";
import { silentLogger } from "./fakes";

/** Minimal Plugin stand-in: only loadData/saveData are touched by the adapter. */
const pluginWith = (over: Partial<Pick<Plugin, "loadData" | "saveData">>): Plugin =>
  ({
    loadData: async () => undefined,
    saveData: async () => undefined,
    ...over,
  }) as Plugin;

describe("ObsidianDataStore", () => {
  it("passes loaded data through", async () => {
    const store = new ObsidianDataStore(pluginWith({ loadData: async () => ({ a: 1 }) }));
    expect(await store.load()).toEqual({ a: 1 });
  });

  it("degrades a corrupt data.json to undefined instead of rejecting through onload (F1)", async () => {
    const error = vi.fn();
    const store = new ObsidianDataStore(
      pluginWith({
        // Obsidian's loadData JSON.parses data.json; a sync-truncated file rejects.
        loadData: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      }),
      { ...silentLogger, error },
    );
    await expect(store.load()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });

  it("returns ok on a successful save", async () => {
    const saveData = vi.fn(async () => undefined);
    const store = new ObsidianDataStore(pluginWith({ saveData }));
    const result = await store.save({ a: 1 });
    expect(result.ok).toBe(true);
    expect(saveData).toHaveBeenCalledWith({ a: 1 });
  });

  it("reports a disk failure as a typed err, never a thrown exception (F2)", async () => {
    const store = new ObsidianDataStore(
      pluginWith({ saveData: () => Promise.reject(new Error("EACCES: permission denied")) }),
    );
    const result = await store.save({ a: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SETTINGS_SAVE_FAILED");
      expect(result.error.cause).toContain("EACCES");
    }
  });
});

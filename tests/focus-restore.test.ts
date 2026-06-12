import { describe, expect, it, vi } from "vitest";
import { captureFocus, restoreFocus } from "../src/presentation/views/focus-restore";

const input = (key: string | null, selection?: { start: number; end: number }) => ({
  getAttribute: (name: string) => (name === "data-focus-key" ? key : null),
  focus: vi.fn(),
  selectionStart: selection?.start ?? null,
  selectionEnd: selection?.end ?? null,
  setSelectionRange: vi.fn(),
});

const rootWith = (found: unknown) => ({
  contains: () => true,
  querySelector: vi.fn(() => found),
});

describe("captureFocus", () => {
  it("captures the focus key and text selection of the active element", () => {
    const active = input("scenario:1/step:2:text", { start: 3, end: 7 });
    expect(captureFocus(rootWith(null), active)).toEqual({
      key: "scenario:1/step:2:text",
      selectionStart: 3,
      selectionEnd: 7,
    });
  });

  it("returns null when nothing is focused, the element is outside the root, or unkeyed", () => {
    expect(captureFocus(rootWith(null), null)).toBeNull();
    expect(
      captureFocus({ contains: () => false, querySelector: () => null }, input("k")),
    ).toBeNull();
    expect(captureFocus(rootWith(null), input(null))).toBeNull();
  });
});

describe("restoreFocus", () => {
  it("re-focuses the matching element and restores the selection", () => {
    const target = input("scenario:1/step:2:text");
    const root = rootWith(target);
    restoreFocus(root, { key: "scenario:1/step:2:text", selectionStart: 3, selectionEnd: 7 });
    expect(root.querySelector).toHaveBeenCalledWith('[data-focus-key="scenario:1/step:2:text"]');
    expect(target.focus).toHaveBeenCalled();
    expect(target.setSelectionRange).toHaveBeenCalledWith(3, 7);
  });

  it("is a no-op for a null snapshot or a vanished element, and survives selection failures", () => {
    restoreFocus(rootWith(null), null);
    restoreFocus(rootWith(null), { key: "gone", selectionStart: null, selectionEnd: null });
    const stubborn = {
      ...input("k"),
      setSelectionRange: vi.fn(() => {
        throw new Error("type=number refuses ranges");
      }),
    };
    expect(() =>
      restoreFocus(rootWith(stubborn), { key: "k", selectionStart: 0, selectionEnd: 0 }),
    ).not.toThrow();
    expect(stubborn.focus).toHaveBeenCalled();
  });
});

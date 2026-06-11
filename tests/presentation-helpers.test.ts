import { describe, expect, it, vi } from "vitest";
import { activateOnEnterOrSpace } from "../src/presentation/views/keyboard-activation";
import { openOrNotice, submitOnEnter } from "../src/presentation/views/modal-helpers";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";
import { ok } from "../src/shared/result/result";

/** Captures every Notice the helpers raise, on top of the obsidian stub. */
const noticeMessages: string[] = [];
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    Notice: class {
      constructor(message: string) {
        noticeMessages.push(message);
      }
    },
  };
});

/**
 * Minimal element stand-in (no jsdom in this suite): captures the keydown
 * listener so the tests can drive it with synthetic events directly.
 */
const fakeElement = () => {
  let handler: ((event: KeyboardEvent) => void) | undefined;
  return {
    el: {
      addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => {
        handler = listener;
      },
    },
    fire: (key: string) => {
      const event = { key, preventDefault: vi.fn() };
      handler?.(event as unknown as KeyboardEvent);
      return event;
    },
  };
};

describe("submitOnEnter", () => {
  it("submits on Enter and suppresses the default", () => {
    const { el, fire } = fakeElement();
    const submit = vi.fn();
    submitOnEnter(el as unknown as HTMLInputElement, submit);
    const event = fire("Enter");
    expect(submit).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("ignores other keys", () => {
    const { el, fire } = fakeElement();
    const submit = vi.fn();
    submitOnEnter(el as unknown as HTMLInputElement, submit);
    fire("a");
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("activateOnEnterOrSpace", () => {
  it("activates on Enter and on Space, preventing the synthesized click", () => {
    const { el, fire } = fakeElement();
    const activate = vi.fn();
    activateOnEnterOrSpace(el as unknown as HTMLElement, activate);
    const enter = fire("Enter");
    const space = fire(" ");
    expect(activate).toHaveBeenCalledTimes(2);
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(space.preventDefault).toHaveBeenCalledOnce();
  });

  it("ignores other keys", () => {
    const { el, fire } = fakeElement();
    const activate = vi.fn();
    activateOnEnterOrSpace(el as unknown as HTMLElement, activate);
    fire("Escape");
    expect(activate).not.toHaveBeenCalled();
  });
});

describe("openOrNotice", () => {
  it("opens silently on success", async () => {
    const openFile = vi.fn(async () => ok(undefined));
    await openOrNotice({ openFile }, unsafeVaultPath("Test Evidence/run.md"));
    expect(openFile).toHaveBeenCalledWith("Test Evidence/run.md");
  });

  it("surfaces a failed open as a Notice instead of a silent no-op", async () => {
    const openFile = vi.fn(async () => ({
      ok: false as const,
      error: { code: "RUNNER_MISSING_FILE" as const, message: "missing note" },
    }));
    await openOrNotice({ openFile }, unsafeVaultPath("Test Evidence/gone.md"));
    expect(openFile).toHaveBeenCalledOnce();
    expect(noticeMessages.some((m) => m.includes("Test Evidence/gone.md"))).toBe(true);
  });
});

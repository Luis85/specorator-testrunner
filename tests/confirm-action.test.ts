import { describe, expect, it, vi } from "vitest";

import type { ButtonComponent } from "obsidian";

import {
  buttonComponentControl,
  buttonElementControl,
  type ConfirmControl,
  markDestructive,
  wireConfirmAction,
} from "../src/presentation/views/confirm-action";

/**
 * A {@link ConfirmControl} test double: records label/destructive state and
 * exposes the registered handlers so a test can drive clicks and blur directly,
 * plus a manual disarm scheduler so the timer is deterministic (no real clock).
 */
const makeControl = () => {
  let label = "";
  let destructive = false;
  let ariaLabel: string | undefined;
  let ariaWrites = 0;
  let click: () => void = () => {};
  let blur: () => void = () => {};
  const control: ConfirmControl = {
    setLabel: (l) => {
      label = l;
    },
    setAriaLabel: (l) => {
      ariaLabel = l;
      ariaWrites += 1;
    },
    setDestructive: (on) => {
      destructive = on;
    },
    onClick: (h) => {
      click = h;
    },
    onBlur: (h) => {
      blur = h;
    },
  };
  return {
    control,
    state: () => ({ label, destructive }),
    aria: () => ({ ariaLabel, ariaWrites }),
    click: () => click(),
    blur: () => blur(),
  };
};

/** A manual disarm scheduler: fire it on demand; track cancellation. */
const makeScheduler = () => {
  let pending: (() => void) | undefined;
  let cancelled = false;
  const schedule = (run: () => void): (() => void) => {
    pending = run;
    cancelled = false;
    return () => {
      cancelled = true;
      pending = undefined;
    };
  };
  return {
    schedule,
    fire: () => pending?.(),
    wasCancelled: () => cancelled,
  };
};

const benignConfig = {
  idleLabel: "Delete",
  armedLabel: "Delete — click again to confirm",
  destructiveWhenIdle: false,
};

/** Benign config that also carries aria labels (the PRD-delete shape). */
const ariaConfig = {
  ...benignConfig,
  idleAriaLabel: "Delete PRD PRD-003",
  armedAriaLabel: "Delete PRD PRD-003 — click again to confirm",
};

describe("wireConfirmAction()", () => {
  it("renders the resting label and is not destructive at rest (benign config)", () => {
    const c = makeControl();
    wireConfirmAction(c.control, { config: benignConfig, onConfirm: vi.fn() });
    expect(c.state()).toEqual({ label: "Delete", destructive: false });
  });

  it("never writes an aria-label when the config supplies none (visible text is the name)", () => {
    const c = makeControl();
    wireConfirmAction(c.control, {
      config: benignConfig,
      onConfirm: vi.fn(),
      scheduleDisarm: makeScheduler().schedule,
    });
    c.click(); // arm
    expect(c.aria()).toEqual({ ariaLabel: undefined, ariaWrites: 0 });
  });

  it("syncs the accessible name on rest, arm, and disarm when aria labels are configured", () => {
    const c = makeControl();
    const scheduler = makeScheduler();
    wireConfirmAction(c.control, {
      config: ariaConfig,
      onConfirm: vi.fn(),
      scheduleDisarm: scheduler.schedule,
    });
    // Rest: the disambiguating accessible name, not the bare visible "Delete".
    expect(c.aria().ariaLabel).toBe("Delete PRD PRD-003");
    c.click(); // arm — the confirm prompt must be announced, keeping the id
    expect(c.aria().ariaLabel).toBe("Delete PRD PRD-003 — click again to confirm");
    scheduler.fire(); // disarm — restore the resting accessible name
    expect(c.aria().ariaLabel).toBe("Delete PRD PRD-003");
  });

  it("arms on the first click without confirming", () => {
    const c = makeControl();
    const onConfirm = vi.fn();
    wireConfirmAction(c.control, {
      config: benignConfig,
      onConfirm,
      scheduleDisarm: makeScheduler().schedule,
    });
    c.click();
    expect(c.state()).toEqual({
      label: "Delete — click again to confirm",
      destructive: true,
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms on the second click and returns to the resting state", () => {
    const c = makeControl();
    const onConfirm = vi.fn();
    wireConfirmAction(c.control, {
      config: benignConfig,
      onConfirm,
      scheduleDisarm: makeScheduler().schedule,
    });
    c.click();
    c.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(c.state()).toEqual({ label: "Delete", destructive: false });
  });

  it("disarms when the timer fires, requiring a fresh arm before confirming", () => {
    const c = makeControl();
    const onConfirm = vi.fn();
    const scheduler = makeScheduler();
    wireConfirmAction(c.control, {
      config: benignConfig,
      onConfirm,
      scheduleDisarm: scheduler.schedule,
    });
    c.click();
    scheduler.fire();
    expect(c.state()).toEqual({ label: "Delete", destructive: false });
    c.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disarms on blur only when opted in", () => {
    const armed = makeControl();
    wireConfirmAction(armed.control, {
      config: benignConfig,
      onConfirm: vi.fn(),
      scheduleDisarm: makeScheduler().schedule,
      disarmOnBlur: true,
    });
    armed.click();
    armed.blur();
    expect(armed.state()).toEqual({ label: "Delete", destructive: false });

    const noBlur = makeControl();
    wireConfirmAction(noBlur.control, {
      config: benignConfig,
      onConfirm: vi.fn(),
      scheduleDisarm: makeScheduler().schedule,
    });
    noBlur.click();
    noBlur.blur();
    expect(noBlur.state().label).toBe("Delete — click again to confirm");
  });

  it("cancels the pending disarm timer on confirm and on dispose", () => {
    const c = makeControl();
    const scheduler = makeScheduler();
    const dispose = wireConfirmAction(c.control, {
      config: benignConfig,
      onConfirm: vi.fn(),
      scheduleDisarm: scheduler.schedule,
    });
    c.click(); // arms → schedules
    c.click(); // confirms → should cancel
    expect(scheduler.wasCancelled()).toBe(true);
    dispose(); // idempotent, no throw
  });

  it("keeps an always-dangerous control styled destructive at rest and after disarm", () => {
    const c = makeControl();
    const scheduler = makeScheduler();
    wireConfirmAction(c.control, {
      config: {
        idleLabel: "Reset",
        armedLabel: "Reset — click again to confirm",
        destructiveWhenIdle: true,
      },
      onConfirm: vi.fn(),
      scheduleDisarm: scheduler.schedule,
    });
    expect(c.state().destructive).toBe(true);
    c.click();
    scheduler.fire();
    expect(c.state()).toEqual({ label: "Reset", destructive: true });
  });

  it("falls back to the window-timer scheduler when none is supplied", () => {
    let captured: (() => void) | undefined;
    const setTimeoutSpy = vi.fn((run: () => void) => {
      captured = run;
      return 7;
    });
    const clearTimeoutSpy = vi.fn();
    vi.stubGlobal("window", { setTimeout: setTimeoutSpy, clearTimeout: clearTimeoutSpy });
    try {
      const c = makeControl();
      const onConfirm = vi.fn();
      wireConfirmAction(c.control, { config: benignConfig, onConfirm });
      c.click();
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 4000);
      captured?.(); // fire the window timer → disarm
      expect(c.state().label).toBe("Delete");
      c.click();
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("markDestructive()", () => {
  type Button = Parameters<typeof markDestructive>[0];

  it("prefers setDestructive() when present", () => {
    const setDestructive = vi.fn();
    const setWarning = vi.fn();
    markDestructive({ setDestructive, setWarning } as unknown as Button);
    expect(setDestructive).toHaveBeenCalledOnce();
    expect(setWarning).not.toHaveBeenCalled();
  });

  it("falls back to setWarning() on pre-1.13 builds", () => {
    const setWarning = vi.fn();
    markDestructive({ setWarning } as unknown as Button);
    expect(setWarning).toHaveBeenCalledOnce();
  });

  it("is a no-op when neither styler exists", () => {
    expect(() => markDestructive({} as unknown as Button)).not.toThrow();
  });
});

describe("buttonComponentControl()", () => {
  const makeButton = () => {
    const removeClass = vi.fn();
    const setButtonText = vi.fn();
    const setDestructive = vi.fn();
    const onClick = vi.fn();
    const listeners: Record<string, () => void> = {};
    const button = {
      setButtonText,
      setDestructive,
      buttonEl: {
        removeClass,
        addEventListener: (type: string, h: () => void) => {
          listeners[type] = h;
        },
      },
      onClick,
    } as unknown as ButtonComponent;
    return { button, removeClass, setButtonText, setDestructive, onClick, listeners };
  };

  it("sets the label through setButtonText", () => {
    const { button, setButtonText } = makeButton();
    buttonComponentControl(button).setLabel("Reset");
    expect(setButtonText).toHaveBeenCalledWith("Reset");
  });

  it("marks destructive on and removes mod-warning off", () => {
    const { button, removeClass, setDestructive } = makeButton();
    const control = buttonComponentControl(button);
    control.setDestructive(true);
    expect(setDestructive).toHaveBeenCalledOnce();
    control.setDestructive(false);
    expect(removeClass).toHaveBeenCalledWith("mod-warning");
  });

  it("registers click and blur handlers", () => {
    const { button, onClick, listeners } = makeButton();
    const control = buttonComponentControl(button);
    const onClickSpy = vi.fn();
    const onBlurSpy = vi.fn();
    control.onClick(onClickSpy);
    control.onBlur(onBlurSpy);
    expect(onClick).toHaveBeenCalledWith(onClickSpy);
    listeners.blur?.();
    expect(onBlurSpy).toHaveBeenCalledOnce();
  });
});

describe("buttonElementControl()", () => {
  const makeEl = () => {
    const setText = vi.fn();
    const toggleClass = vi.fn();
    const setAttribute = vi.fn();
    const listeners: Record<string, () => void> = {};
    const el = {
      setText,
      toggleClass,
      setAttribute,
      addEventListener: (type: string, h: () => void) => {
        listeners[type] = h;
      },
    } as unknown as HTMLButtonElement;
    return { el, setText, toggleClass, setAttribute, listeners };
  };

  it("sets the label through setText", () => {
    const { el, setText } = makeEl();
    buttonElementControl(el).setLabel("Delete");
    expect(setText).toHaveBeenCalledWith("Delete");
  });

  it("syncs the accessible name through setAttribute('aria-label', …)", () => {
    const { el, setAttribute } = makeEl();
    buttonElementControl(el).setAriaLabel?.("Delete PRD PRD-003 — click again to confirm");
    expect(setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Delete PRD PRD-003 — click again to confirm",
    );
  });

  it("toggles mod-warning for the destructive style", () => {
    const { el, toggleClass } = makeEl();
    const control = buttonElementControl(el);
    control.setDestructive(true);
    expect(toggleClass).toHaveBeenCalledWith("mod-warning", true);
    control.setDestructive(false);
    expect(toggleClass).toHaveBeenCalledWith("mod-warning", false);
  });

  it("registers click and blur handlers", () => {
    const { el, listeners } = makeEl();
    const control = buttonElementControl(el);
    const onClickSpy = vi.fn();
    const onBlurSpy = vi.fn();
    control.onClick(onClickSpy);
    control.onBlur(onBlurSpy);
    listeners.click?.();
    listeners.blur?.();
    expect(onClickSpy).toHaveBeenCalledOnce();
    expect(onBlurSpy).toHaveBeenCalledOnce();
  });
});

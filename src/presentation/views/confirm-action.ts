import type { ButtonComponent } from "obsidian";

import {
  type ConfirmActionConfig,
  type ConfirmActionDirective,
  type ConfirmPhase,
  initialDirective,
  onClick,
  onDisarm,
} from "./confirm-action-state";

/**
 * Thin DOM wiring over the pure {@link import("./confirm-action-state")}
 * transitions: turns any clickable control into a two-click destructive confirm
 * (first click arms + re-labels, second within {@link CONFIRM_DISARM_MS}
 * executes, blur/timeout/teardown disarms). The state lives in the pure module;
 * this file only renders the directive onto the control and owns the timer. The
 * settings tab (remove-environment, reset) and the PRD explorer (delete) wire
 * through here so the destructive UX is defined once.
 */

/** How long an armed control stays armed before auto-reverting. */
const CONFIRM_DISARM_MS = 4000;

/**
 * Styles a button as destructive across Obsidian versions. `setDestructive()`
 * is the 1.13 API; pre-1.13 builds only have the (now-deprecated)
 * `setWarning()`. Both are reached through a narrowed cast — so neither the
 * missing-method crash on pre-1.13 nor the no-deprecated lint on `setWarning()`
 * can bite — and both add the `mod-warning` class the disarm paths remove.
 * Canonical home is the confirm primitive (settings-shared re-exports it).
 */
export const markDestructive = (button: ButtonComponent): void => {
  const styler = button as unknown as {
    setDestructive?: () => void;
    setWarning?: () => void;
  };
  if (typeof styler.setDestructive === "function") styler.setDestructive();
  else if (typeof styler.setWarning === "function") styler.setWarning();
};

/**
 * The minimal control surface the wirer drives — implemented over both an
 * Obsidian {@link ButtonComponent} (the settings rows) and a raw `<button>`
 * (the PRD explorer tree rows). Keeps the wirer free of any single widget's API.
 */
export interface ConfirmControl {
  setLabel(label: string): void;
  /**
   * Syncs the accessible name (`aria-label`). Optional — only invoked when the
   * config supplied aria labels (a control whose `aria-label` differs from its
   * visible text, e.g. the PRD Delete button). For controls whose visible text
   * already is their accessible name, the config omits aria labels and this is
   * never called, so no stale/blank `aria-label` is written.
   */
  setAriaLabel?(label: string): void;
  setDestructive(on: boolean): void;
  /** Registers the click handler; the wirer supplies the per-click behaviour. */
  onClick(handler: () => void): void;
  /** Fires when focus leaves the control, so an armed control can disarm on blur. */
  onBlur(handler: () => void): void;
}

export interface WireConfirmActionOptions {
  config: ConfirmActionConfig;
  /** Run on the confirming (second) click. */
  onConfirm: () => void;
  /**
   * Schedule a one-shot disarm timer, returning a canceller. Defaults to
   * `window.setTimeout`; the settings tab passes a variant that also registers
   * the handle so the tab can clear it on re-render/close (no orphaned fire).
   */
  scheduleDisarm?: (run: () => void, ms: number) => () => void;
  /** Disarm window in ms; defaults to {@link CONFIRM_DISARM_MS}. */
  disarmMs?: number;
  /**
   * Also disarm when focus leaves the control. Off by default to preserve the
   * timeout-only UX the settings call sites shipped; opt in for new surfaces.
   */
  disarmOnBlur?: boolean;
}

const defaultScheduleDisarm = (run: () => void, ms: number): (() => void) => {
  // `window.setTimeout` (popout-window-safe, per the obsidianmd lint rule). The
  // settings call sites override this to also register the handle for teardown.
  const handle = window.setTimeout(run, ms);
  return () => window.clearTimeout(handle);
};

/**
 * Wires `control` as a two-click confirm. Returns a `dispose` that clears any
 * pending disarm timer (call it on teardown). Behaviour-preserving for the
 * existing settings call sites; the only new consumer is PRD delete.
 */
export const wireConfirmAction = (
  control: ConfirmControl,
  options: WireConfirmActionOptions,
): (() => void) => {
  const { config, onConfirm } = options;
  const scheduleDisarm = options.scheduleDisarm ?? defaultScheduleDisarm;
  const disarmMs = options.disarmMs ?? CONFIRM_DISARM_MS;

  let phase: ConfirmPhase = "idle";
  let cancelDisarm: (() => void) | undefined;

  const apply = (directive: ConfirmActionDirective): void => {
    control.setLabel(directive.label);
    // Keep the accessible name in sync so screen-reader users hear the armed
    // confirm prompt — `aria-label` otherwise overrides the visible text. Only
    // when the config provides aria labels (else leave the accessible name to
    // the visible text — unchanged for the settings call sites).
    if (directive.ariaLabel !== undefined) control.setAriaLabel?.(directive.ariaLabel);
    control.setDestructive(directive.destructive);
  };

  const clearTimer = (): void => {
    cancelDisarm?.();
    cancelDisarm = undefined;
  };

  const disarm = (): void => {
    if (phase === "idle") return;
    clearTimer();
    const { phase: next, directive } = onDisarm(config);
    phase = next;
    apply(directive);
  };

  apply(initialDirective(config));

  control.onClick(() => {
    const { phase: next, directive } = onClick(phase, config);
    phase = next;
    apply(directive);
    if (directive.startDisarmTimer) {
      clearTimer();
      cancelDisarm = scheduleDisarm(disarm, disarmMs);
    } else {
      clearTimer();
    }
    if (directive.execute) onConfirm();
  });

  if (options.disarmOnBlur === true) control.onBlur(disarm);

  return clearTimer;
};

/** Adapts an Obsidian {@link ButtonComponent} to the {@link ConfirmControl} seam. */
export const buttonComponentControl = (button: ButtonComponent): ConfirmControl => ({
  setLabel: (label) => {
    button.setButtonText(label);
  },
  setAriaLabel: (label) => {
    button.buttonEl.setAttribute("aria-label", label);
  },
  setDestructive: (on) => {
    if (on) markDestructive(button);
    else button.buttonEl.removeClass("mod-warning");
  },
  onClick: (handler) => {
    button.onClick(handler);
  },
  onBlur: (handler) => {
    button.buttonEl.addEventListener("blur", handler);
  },
});

/** Adapts a raw `<button>` element to the {@link ConfirmControl} seam. */
export const buttonElementControl = (button: HTMLButtonElement): ConfirmControl => ({
  setLabel: (label) => {
    button.setText(label);
  },
  setAriaLabel: (label) => {
    button.setAttribute("aria-label", label);
  },
  setDestructive: (on) => {
    button.toggleClass("mod-warning", on);
  },
  onClick: (handler) => {
    button.addEventListener("click", handler);
  },
  onBlur: (handler) => {
    button.addEventListener("blur", handler);
  },
});

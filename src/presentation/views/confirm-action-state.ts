/**
 * Pure state machine for the two-click destructive-confirm primitive — the
 * arm/disarm pattern proven in the settings tab (`settings-environments.ts`
 * remove-environment, `settings-maintenance.ts` reset) and now the headline fix
 * for PRD delete (05-M3). The first click *arms* the control (re-labels, optional
 * warning style); a second click within the disarm window *executes*; an
 * intervening blur, timeout, or re-render *disarms*. This module owns the
 * transitions so they are unit-tested once, leaving the DOM wiring
 * ({@link import("./confirm-action").wireConfirmAction}) thin.
 *
 * Nothing here touches the DOM or Obsidian APIs: a transition takes the current
 * phase and reports the next phase plus the directive the caller should apply
 * (which label to show, whether to style destructive, whether to execute, and
 * whether a disarm timer should be (re)started). The caller renders the
 * directive; this module never renders.
 */

/** The two stable phases of a confirm control. */
export type ConfirmPhase = "idle" | "armed";

/** Static copy + styling for a confirm control, supplied once at wiring time. */
export interface ConfirmActionConfig {
  /** Label in the resting (idle) state, e.g. "Remove environment" or "Delete". */
  idleLabel: string;
  /** Label once armed, e.g. "Remove — click again to confirm". */
  armedLabel: string;
  /**
   * When `true` the control is styled destructive from the start (reset is
   * always dangerous); when `false` the warning style is applied only on arm
   * (the environment remove button is benign-looking until armed). Preserves the
   * differing UX of the two existing call sites.
   */
  destructiveWhenIdle: boolean;
}

/**
 * What the caller must apply after a transition: the label to display, whether
 * the destructive style should now be present, whether to execute the action,
 * and whether to (re)start the disarm timer. A directive is the *whole* visible
 * outcome of a transition — the caller applies it verbatim and holds no extra
 * state beyond the returned {@link ConfirmActionTransition.phase}.
 */
export interface ConfirmActionDirective {
  label: string;
  destructive: boolean;
  /** True only on the confirming (second) click — the caller runs the action. */
  execute: boolean;
  /** True when the caller should (re)start the disarm timer (i.e. just armed). */
  startDisarmTimer: boolean;
}

/** A transition's result: the next phase plus the directive to apply. */
export interface ConfirmActionTransition {
  phase: ConfirmPhase;
  directive: ConfirmActionDirective;
}

/** The resting directive for a freshly-wired (idle) control. */
export const initialDirective = (config: ConfirmActionConfig): ConfirmActionDirective => ({
  label: config.idleLabel,
  destructive: config.destructiveWhenIdle,
  execute: false,
  startDisarmTimer: false,
});

/**
 * Click transition. From `idle` it arms (new label, destructive style on, start
 * the disarm timer) without executing; from `armed` it executes (and the caller
 * should clear the disarm timer it started). Pure: the same inputs always yield
 * the same transition.
 */
export const onClick = (
  phase: ConfirmPhase,
  config: ConfirmActionConfig,
): ConfirmActionTransition => {
  if (phase === "idle") {
    return {
      phase: "armed",
      directive: {
        label: config.armedLabel,
        destructive: true,
        execute: false,
        startDisarmTimer: true,
      },
    };
  }
  return {
    phase: "idle",
    directive: {
      label: config.idleLabel,
      destructive: config.destructiveWhenIdle,
      execute: true,
      startDisarmTimer: false,
    },
  };
};

/**
 * Disarm transition — fired by the timeout, a blur, or a re-render teardown.
 * Idempotent: disarming an already-idle control returns the resting directive
 * (no execute), so a late timer firing after a manual disarm is harmless.
 */
export const onDisarm = (config: ConfirmActionConfig): ConfirmActionTransition => ({
  phase: "idle",
  directive: initialDirective(config),
});

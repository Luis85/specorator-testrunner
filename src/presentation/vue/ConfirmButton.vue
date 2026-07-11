<script setup lang="ts">
/**
 * The Vue twin of `wireConfirmAction` (ADR-0033): a two-click destructive
 * confirm button. It drives the SAME pure {@link confirm-action-state}
 * transitions the imperative wirer does — first click arms (re-labels, styles
 * `mod-warning`, starts a disarm timer); a second click within the window emits
 * `confirm`; an intervening blur (when `disarmOnBlur`), the timeout, or unmount
 * disarms. The state machine is unit-tested once in `confirm-action-state`; this
 * component only renders its directive onto a `<button>` and owns the timer,
 * exactly as the imperative adapter did.
 */
import { onUnmounted, ref } from "vue";
import {
  type ConfirmActionConfig,
  type ConfirmActionDirective,
  type ConfirmPhase,
  initialDirective,
  onClick as clickTransition,
  onDisarm,
} from "../views/confirm-action-state";

const props = withDefaults(
  defineProps<{
    config: ConfirmActionConfig;
    /** Base class(es) for the button; `mod-warning` is added while destructive. */
    buttonClass?: string;
    /** Disarm window in ms (defaults to the shared 4s). */
    disarmMs?: number;
    /** Also disarm when focus leaves the button (the PRD tree rows opt in). */
    disarmOnBlur?: boolean;
  }>(),
  { buttonClass: "", disarmMs: 4000, disarmOnBlur: false },
);
const emit = defineEmits<{ confirm: [] }>();

// The phase is plain (non-reactive) local state — only the rendered directive
// needs to be reactive, mirroring the imperative wirer holding `phase` in a
// closure and applying the directive to the DOM.
let phase: ConfirmPhase = "idle";
const directive = ref<ConfirmActionDirective>(initialDirective(props.config));
let cancelDisarm: (() => void) | undefined;

const clearTimer = (): void => {
  cancelDisarm?.();
  cancelDisarm = undefined;
};

const disarm = (): void => {
  if (phase === "idle") return;
  clearTimer();
  const next = onDisarm(props.config);
  phase = next.phase;
  directive.value = next.directive;
};

const handleClick = (): void => {
  const next = clickTransition(phase, props.config);
  phase = next.phase;
  directive.value = next.directive;
  clearTimer();
  if (next.directive.startDisarmTimer) {
    // window.setTimeout is popout-window-safe (the obsidianmd lint rule).
    const handle = window.setTimeout(disarm, props.disarmMs);
    cancelDisarm = () => window.clearTimeout(handle);
  }
  if (next.directive.execute) emit("confirm");
};

const handleBlur = (): void => {
  if (props.disarmOnBlur) disarm();
};

// Teardown mirrors the wirer's returned disposer: cancel any pending disarm so a
// late timer can't fire after the button is gone.
onUnmounted(clearTimer);
</script>

<template>
  <button
    :class="[buttonClass, { 'mod-warning': directive.destructive }]"
    :aria-label="directive.ariaLabel"
    @click="handleClick"
    @blur="handleBlur"
  >
    {{ directive.label }}
  </button>
</template>

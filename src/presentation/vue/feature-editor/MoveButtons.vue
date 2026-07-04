<script setup lang="ts">
/**
 * The ↑/↓ reorder pair used by scenario heads and step rows alike (ADR-0033) —
 * the Vue twin of `appendMoveButtons`. Moves the item in the reactive `array` and
 * commits only when it actually moved.
 */
import { inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import { moveItem } from "../../views/feature-editor-format";

const props = defineProps<{ array: unknown[]; index: number; noun: string }>();
const ctrl = inject(FEATURE_EDITOR)!;

const move = (delta: -1 | 1): void => {
  if (moveItem(props.array, props.index, delta)) ctrl.commit();
};
</script>

<template>
  <button :aria-label="`Move ${noun} up`" @click="move(-1)">↑</button>
  <button :aria-label="`Move ${noun} down`" @click="move(1)">↓</button>
</template>

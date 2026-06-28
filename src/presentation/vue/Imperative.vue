<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

/**
 * Mounts an imperative DOM writer (the existing tested `renderX` helpers) inside
 * the Vue tree, re-painting whenever the writer closure changes (ADR-0033).
 *
 * This lets a migrated view REUSE the proven DOM writers — `renderLoopRail`,
 * `renderChecklist`, `renderLoadError`, `renderEmptyState` — verbatim while Vue
 * owns lifecycle, state, and event wiring, so the painted DOM (and its theme
 * classes) is identical by construction rather than re-derived. Pass a fresh
 * `paint` closure each render (e.g. `(el) => renderLoopRail(el, rail, onAction)`);
 * its changing identity drives the repaint.
 */
const props = defineProps<{ paint: (el: HTMLElement) => void }>();
const host = ref<HTMLElement | null>(null);

const repaint = (): void => {
  if (host.value === null) return;
  // Clear first: the appending writers (renderLoadError/renderEmptyState) assume
  // a fresh container, and the clearing writers (renderLoopRail/renderChecklist)
  // empty() anyway, so this is safe for both.
  host.value.replaceChildren();
  props.paint(host.value);
};

onMounted(repaint);
watch(() => props.paint, repaint);
</script>

<template>
  <div ref="host"></div>
</template>

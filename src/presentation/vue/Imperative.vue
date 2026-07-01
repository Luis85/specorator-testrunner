<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

/**
 * Mounts an imperative DOM writer (the existing tested `renderX` helpers) inside
 * the Vue tree, re-painting whenever the writer closure changes (ADR-0033).
 *
 * This lets a migrated view REUSE the proven DOM writers — `renderLoopRail`,
 * `renderChecklist`, `renderLoadError`, `renderEmptyState`, and the hub's async
 * section-body renderers — verbatim while Vue owns lifecycle, state, and event
 * wiring, so the painted DOM (and its theme classes) is identical by construction
 * rather than re-derived. Pass a fresh `paint` closure each render (e.g.
 * `(el) => renderLoopRail(el, rail, onAction)`); its changing identity drives the
 * repaint.
 *
 * Each repaint paints into a FRESH child element, replacing the previous one. This
 * isolates ASYNC paints: a body writer still awaiting a service read holds a
 * reference to the child it was given, so when a newer repaint (a filter change, a
 * refresh event) swaps in a new child, the stale write lands in a now-DETACHED
 * node and never appears — exactly as the pre-Vue hub created a fresh body element
 * per refresh so late writes fell into a detached container.
 */
const props = defineProps<{ paint: (el: HTMLElement) => void }>();
const host = ref<HTMLElement | null>(null);

const repaint = (): void => {
  if (host.value === null) return;
  const target = document.createElement("div");
  // replaceChildren detaches the previous target, so any in-flight async paint
  // that captured it writes into a detached node instead of this live host.
  host.value.replaceChildren(target);
  props.paint(target);
};

onMounted(repaint);
watch(() => props.paint, repaint);
</script>

<template>
  <div ref="host"></div>
</template>

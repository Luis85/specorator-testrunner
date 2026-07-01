<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

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
 *
 * Because the host `<div>` is a PERMANENT wrapper (unlike the pre-Vue hub, which
 * painted straight into the section slot), a slot's `:empty` collapse rule can no
 * longer see through it — a painter that renders nothing (recent-runs before init,
 * the dismissed onboarding rail) would otherwise leave the slot un-collapsed. So
 * the component reports emptiness via the `empty` event, kept LIVE with a
 * MutationObserver since painters write asynchronously; the slot binds it to an
 * `is-empty` class it collapses on, restoring the pre-Vue `:empty` behaviour.
 */
const props = defineProps<{ paint: (el: HTMLElement) => void }>();
const emit = defineEmits<{ empty: [boolean] }>();
const host = ref<HTMLElement | null>(null);
let observer: MutationObserver | null = null;

const reportEmpty = (target: HTMLElement): void => {
  emit("empty", target.childNodes.length === 0);
};

const repaint = (): void => {
  if (host.value === null) return;
  const target = document.createElement("div");
  // replaceChildren detaches the previous target, so any in-flight async paint
  // that captured it writes into a detached node instead of this live host.
  host.value.replaceChildren(target);
  observer?.disconnect();
  // Painters write asynchronously (after a service read), so a one-shot check
  // after paint would miss content that lands later; observe the fresh target
  // and re-report emptiness on every mutation. Bound to THIS target, so a newer
  // repaint's disconnect stops the stale observer.
  observer = new MutationObserver(() => reportEmpty(target));
  observer.observe(target, { childList: true, subtree: true });
  props.paint(target);
  reportEmpty(target);
};

onMounted(repaint);
watch(() => props.paint, repaint);
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div ref="host"></div>
</template>

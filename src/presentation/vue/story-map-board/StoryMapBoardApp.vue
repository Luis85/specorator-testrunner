<script setup lang="ts">
/**
 * The Story Map board leaf (ADR-0033 Phase 4). This is a deliberately THIN Vue
 * shell around a preserved imperative engine: the board renders an interactive
 * SVG, drags cards/headers via interact.js, mounts inline `<foreignObject>` rename
 * editors, and runs a debounced/serialized save with optimistic-concurrency and
 * origin-filtered event subscriptions — none of which map cleanly onto reactive
 * templates. Per the ADR gate, the interact.js adapter and the custom EventBus
 * filtering are kept verbatim inside {@link StoryMapBoardController}, which owns
 * its own RenderScheduler; this component just gives it a host element and bridges
 * the Obsidian view lifecycle (mount/retarget/unmount).
 */
import { inject, onMounted, onUnmounted, ref, watch } from "vue";
import { StoryMapBoardController } from "./story-map-board-controller";
import {
  STORY_MAP_BOARD_APP,
  STORY_MAP_BOARD_CONTROLLER,
  STORY_MAP_BOARD_DEPS,
  STORY_MAP_BOARD_ID,
} from "./story-map-board-deps";

const deps = inject(STORY_MAP_BOARD_DEPS)!;
const app = inject(STORY_MAP_BOARD_APP)!;
const storyMapId = inject(STORY_MAP_BOARD_ID)!;
// The view provides this slot so its onClose can await close() before unmount.
const controllerRef = inject(STORY_MAP_BOARD_CONTROLLER)!;

const host = ref<HTMLElement | null>(null);
let controller: StoryMapBoardController | null = null;

onMounted(() => {
  if (host.value === null) return;
  controller = new StoryMapBoardController(host.value, app, deps, storyMapId.value);
  controllerRef.value = controller;
  void controller.open();
});

// Re-target (leaf reused for another map): the view's setState wrote the new id
// into the ref; drive the controller's retarget (which flushes the old map first).
watch(storyMapId, (next) => void controller?.setStoryMapId(next));

onUnmounted(() => {
  // close() is idempotent — the view's onClose awaits it first (to persist the
  // last edit), and this is the backstop teardown.
  void controller?.close();
  controller = null;
  controllerRef.value = null;
});
</script>

<template>
  <div ref="host" class="sm-board-container"></div>
</template>

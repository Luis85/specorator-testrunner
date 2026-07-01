<script setup lang="ts">
/**
 * One Story Map card (ADR-0033): the title (opens the board) + status pill, a
 * meta row (id + product anchor + count chips), and a compact icon action bar
 * (settings, open note, refresh tables, delete). DOM + classes mirror the
 * imperative `renderRow` so the theme is identical; the count chips come from the
 * pure {@link storyMapChips} projection. Delete is immediate here (the original
 * wired no confirm for Story Maps), matching the pre-Vue behaviour.
 */
import { Notice } from "obsidian";
import { computed } from "vue";
import Icon from "../Icon.vue";
import { storyMapChips } from "../../views/story-map-rows";
import { openOrNotice } from "../../views/modal-helpers";
import type { StoryMap } from "../../../domain/entities/story-map";
import type { StoryMapBodyDeps } from "./story-map-body-deps";

const props = defineProps<{
  map: StoryMap;
  deps: StoryMapBodyDeps;
  /** The body's re-render, run after a delete settles (a useEventBus refresh). */
  refresh: () => void;
}>();

const chips = computed(() => storyMapChips(props.map));

// The four icon actions, in bar order. `danger` styles Delete; each handler is a
// thunk so the template stays declarative.
const actions = computed(() => [
  {
    icon: "settings",
    title: "Settings",
    ariaLabel: `Edit settings for ${props.map.id}`,
    danger: false,
    onClick: () => props.deps.openMapSettings(props.map),
  },
  {
    icon: "file-text",
    title: "Open note",
    ariaLabel: `Open the ${props.map.id} note`,
    danger: false,
    onClick: () => void openOrNotice(props.deps.workspace, props.map.path),
  },
  {
    icon: "refresh-cw",
    title: "Refresh tables",
    ariaLabel: `Refresh the Markdown tables for ${props.map.id}`,
    danger: false,
    onClick: () => void rebuildGrid(),
  },
  {
    icon: "trash-2",
    title: "Delete",
    ariaLabel: `Delete Story Map ${props.map.id}`,
    danger: true,
    onClick: () => void deleteStoryMap(),
  },
]);

async function rebuildGrid(): Promise<void> {
  const result = await props.deps.storyMapService.rebuildGrid(props.map.id);
  new Notice(
    result.ok
      ? `Refreshed the tables for ${props.map.id}.`
      : `Could not refresh ${props.map.id}: ${result.error.message}`,
  );
}

async function deleteStoryMap(): Promise<void> {
  const result = await props.deps.storyMapService.deleteStoryMap(props.map.id);
  if (!result.ok) {
    new Notice(`Could not delete ${props.map.id}: ${result.error.message}`);
    return;
  }
  const preserved = result.value.preservedFiles;
  const suffix =
    preserved > 0 ? ` (kept ${preserved} other file${preserved === 1 ? "" : "s"})` : "";
  new Notice(`Deleted ${props.map.id}${suffix}.`);
  props.refresh();
}
</script>

<template>
  <li class="e2e-test-hub-story-map-node">
    <div class="spec-panel e2e-test-hub-story-map-card">
      <div class="e2e-test-hub-story-map-card-title-row">
        <button
          class="e2e-test-hub-story-map-card-title"
          :aria-label="`Open the board for ${map.id} ${map.title}`"
          @click="deps.openStoryMapBoard(map.id)"
        >
          {{ map.title }}
        </button>
        <span class="spec-pill" :data-status="map.status" :title="`Map status: ${map.status}`">
          {{ map.status }}
        </span>
      </div>

      <div class="e2e-test-hub-story-map-card-meta">
        <span class="e2e-test-hub-story-map-card-id">{{ map.id }}</span>
        <span class="e2e-test-hub-story-map-card-product" :title="`Anchored to ${map.product}`">
          {{ map.product }}
        </span>
        <div class="e2e-test-hub-story-map-card-chips">
          <span v-for="chip in chips" :key="chip" class="e2e-test-hub-story-map-chip">{{
            chip
          }}</span>
        </div>
      </div>

      <div class="e2e-test-hub-story-map-card-actions">
        <button
          v-for="action in actions"
          :key="action.icon"
          :class="[
            'e2e-test-hub-story-map-action',
            { 'e2e-test-hub-story-map-action-danger': action.danger },
          ]"
          :aria-label="action.ariaLabel"
          :title="action.title"
          @click="action.onClick()"
        >
          <Icon :name="action.icon" />
        </button>
      </div>
    </div>
  </li>
</template>

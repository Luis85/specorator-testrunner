<script setup lang="ts">
/**
 * The "Story Maps" body (ADR-0033 Phase 3): the flat list of Story Maps
 * (PRD-sibling overlays) with product anchor + count chips + actions, or the
 * empty/error state. Self-loads and stays live via useEventBus. The Vue twin of
 * `renderStoryMapExplorerBody`; the standalone leaf and the hub's Plan section
 * mount the same component.
 */
import { ref } from "vue";
import { useEventBus } from "../use-event-bus";
import ListHeader from "../ListHeader.vue";
import StoryMapRow from "./StoryMapRow.vue";
import type { StoryMap } from "../../../domain/entities/story-map";
import type { DomainEventType } from "../../../domain/events/domain-event";
import type { StoryMapBodyDeps } from "./story-map-body-deps";

const props = defineProps<{ deps: StoryMapBodyDeps }>();

// The list depends only on Story Map entities (each card's counts are internal),
// so the storymap.* trio is the complete set — the same events HUB_REFRESH_ON
// would have repainted this body on, so a direct Vue body loses nothing.
const REFRESH_ON: DomainEventType[] = ["storymap.created", "storymap.updated", "storymap.deleted"];

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; maps: StoryMap[] };

const state = ref<ViewState>({ kind: "loading" });

// Loaded through useEventBus (RenderScheduler SERIALIZES loads). Clear stale rows
// synchronously before the await so an event-driven refresh in a slow vault never
// leaves the old cards' Open/Delete actions live (the shared Phase 3 guard).
async function load(): Promise<void> {
  state.value = { kind: "loading" };
  const maps = await props.deps.storyMapService.findAll();
  if (!maps.ok) {
    state.value = { kind: "error", message: maps.error.message };
    return;
  }
  state.value = { kind: "loaded", maps: maps.value };
}

const { refresh } = useEventBus(props.deps.eventBus, REFRESH_ON, load);
</script>

<template>
  <div>
    <ListHeader
      header-cls="e2e-test-hub-story-map-header"
      title="Story Maps"
      action-label="New Story Map"
      @action="deps.openStoryMapBuilder()"
    />

    <template v-if="state.kind === 'error'">
      <p>Could not load Story Maps: {{ state.message }}</p>
      <button class="mod-cta" aria-label="Retry loading the Story Maps" @click="refresh">
        Retry
      </button>
    </template>

    <p v-else-if="state.kind === 'loaded' && state.maps.length === 0" class="spec-empty">
      No Story Maps yet. Create one to shape the product journey across PRDs.
    </p>

    <ul v-else-if="state.kind === 'loaded'" class="e2e-test-hub-story-map-list">
      <StoryMapRow
        v-for="map in state.maps"
        :key="map.id"
        :map="map"
        :deps="deps"
        :refresh="refresh"
      />
    </ul>
  </div>
</template>

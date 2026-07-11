<script setup lang="ts">
/**
 * The loop rail (WS-C1, ADR-0033): the forward-momentum spine — Use Case ·
 * Feature · Steps · Suite · Run — rendered from the pure {@link projectLoopRail}
 * model. Each node carries its `done`/`current`/`todo` state via `data-state`;
 * connector segments between nodes carry the LEFT node's state; only the
 * `current` node shows its live `--spec-accent` action button. The Vue twin of
 * `renderLoopRail` (identical DOM/classes/ARIA).
 */
import type { LoopRail, LoopRailAction, LoopRailNode } from "../../views/loop-rail-rows";

defineProps<{ rail: LoopRail }>();
const emit = defineEmits<{ action: [Exclude<LoopRailAction, null>] }>();

// The current node's button is the only interactive element; guard the emit so
// its payload is the non-null action the button implies.
const onNode = (node: LoopRailNode): void => {
  if (node.action !== null) emit("action", node.action);
};
</script>

<template>
  <div class="spec-loop-rail">
    <div class="spec-loop-rail-strip" role="list" aria-label="Authoring loop progress">
      <template v-for="(node, index) in rail.nodes" :key="node.stage">
        <div
          v-if="index > 0"
          class="spec-loop-rail-connector"
          :data-state="rail.nodes[index - 1].state"
        ></div>
        <div
          class="spec-loop-rail-node"
          role="listitem"
          :data-state="node.state"
          :data-stage="node.stage"
        >
          <span class="spec-loop-rail-label">{{ node.label }}</span>
          <button
            v-if="node.action !== null"
            class="spec-loop-rail-action"
            :aria-label="`${node.actionLabel} — the next step for this Use Case`"
            @click="onNode(node)"
          >
            {{ node.actionLabel }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

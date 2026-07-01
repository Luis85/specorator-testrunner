<script setup lang="ts">
/**
 * One node of the PRD tree (ADR-0033), rendered recursively: the PRD row (open
 * link with its Use Case count, optional "Open Use Cases" deep-link, status
 * pill, "＋ sub-PRD", and — for sub-PRDs only — a two-click confirm Delete), then
 * its children as a nested tree. DOM + classes mirror the imperative `renderNode`
 * exactly so the theme is identical. Recursive self-reference resolves by the
 * component's filename (`PrdNode`).
 */
import { Notice } from "obsidian";
import { computed } from "vue";
import ConfirmButton from "../ConfirmButton.vue";
import type { PrdTreeNode } from "../../views/prd-explorer-body";
import { firstUseCaseIdOfPrd, type UseCaseOfPrdInput } from "../../navigation/use-cases-of-prd";
import { artifactTarget } from "../../navigation/navigation-target";
import type { PrdBodyDeps } from "./prd-body-deps";

const props = defineProps<{
  node: PrdTreeNode;
  useCases: readonly UseCaseOfPrdInput[];
  deps: PrdBodyDeps;
  /** The body's re-render, run after a delete settles (a useEventBus refresh). */
  refresh: () => void;
}>();

const ucLabel = computed(() => (props.node.ucCount === 1 ? "1 UC" : `${props.node.ucCount} UCs`));
const openLabel = computed(
  () => `${props.node.prd.id}: ${props.node.prd.title} (${ucLabel.value})`,
);
// The per-row "Open Use Cases" deep-link is only offered when the PRD actually
// has a linked Use Case (avoids a dead affordance).
const firstUcId = computed(() => firstUseCaseIdOfPrd(props.useCases, props.node.prd.id));
// The root PRD anchors the tree and is never deletable (the service refuses it);
// only sub-PRDs (those with a parent) get the Delete button.
const deletable = computed(() => props.node.prd.parentPrdId !== undefined);

const openPrd = (): void => props.deps.navigate(artifactTarget(props.node.prd.id));
const openUseCases = (): void => {
  if (firstUcId.value !== null) props.deps.navigate(artifactTarget(firstUcId.value));
};
const addSubPrd = (): void => props.deps.openPrdBuilder(props.node.prd.id);

const deleteConfig = computed(() => ({
  idleLabel: "Delete",
  armedLabel: "Delete — click again to confirm",
  // The visible text is just "Delete"; the accessible name disambiguates WHICH
  // PRD (aria-label otherwise overrides the visible text), carried through arm.
  idleAriaLabel: `Delete PRD ${props.node.prd.id}`,
  armedAriaLabel: `Delete PRD ${props.node.prd.id} — click again to confirm`,
  destructiveWhenIdle: false,
}));

async function deletePrd(): Promise<void> {
  const result = await props.deps.prdService.deletePrd(props.node.prd.id);
  if (!result.ok) {
    new Notice(`Could not delete ${props.node.prd.id}: ${result.error.message}`);
    return;
  }
  const preserved = result.value.preservedFiles;
  const suffix =
    preserved > 0 ? ` (kept ${preserved} other file${preserved === 1 ? "" : "s"})` : "";
  new Notice(`Deleted ${props.node.prd.id}${suffix}.`);
  props.refresh();
}
</script>

<template>
  <li class="e2e-test-hub-prd-node">
    <div class="e2e-test-hub-prd-row">
      <button
        class="e2e-test-hub-link-button"
        :aria-label="`Open PRD ${node.prd.id} ${node.prd.title}`"
        @click="openPrd"
      >
        {{ openLabel }}
      </button>

      <button
        v-if="firstUcId !== null"
        class="e2e-test-hub-link-button"
        :aria-label="`Open the Use Cases of PRD ${node.prd.id}`"
        @click="openUseCases"
      >
        Open Use Cases
      </button>

      <span class="spec-pill" :data-status="node.prd.status">{{ node.prd.status }}</span>

      <button
        class="e2e-test-hub-link-button"
        :aria-label="`Add a sub-PRD under ${node.prd.id}`"
        @click="addSubPrd"
      >
        ＋ sub-PRD
      </button>

      <ConfirmButton
        v-if="deletable"
        :config="deleteConfig"
        button-class="e2e-test-hub-link-button"
        :disarm-on-blur="true"
        @confirm="deletePrd"
      />
    </div>

    <ul v-if="node.children.length > 0" class="e2e-test-hub-prd-tree">
      <PrdNode
        v-for="child in node.children"
        :key="child.prd.id"
        :node="child"
        :use-cases="useCases"
        :deps="deps"
        :refresh="refresh"
      />
    </ul>
  </li>
</template>

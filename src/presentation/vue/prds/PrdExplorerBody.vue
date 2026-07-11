<script setup lang="ts">
/**
 * The "PRDs" body (ADR-0033 Phase 3): the hierarchical PRD tree with per-PRD Use
 * Case counts, or the empty/error state. Self-loads its data and stays live via
 * useEventBus, reusing the PURE {@link buildPrdTree} projection so the tree
 * shaping is unchanged. The Vue twin of `renderPrdExplorerBody`; the standalone
 * PRDs leaf and the hub's Plan section mount the same component.
 */
import { ref } from "vue";
import { useEventBus } from "../use-event-bus";
import ListHeader from "../ListHeader.vue";
import PrdNode from "./PrdNode.vue";
import { buildPrdTree, type PrdTreeNode } from "../../views/prd-explorer-body";
import type { UseCaseOfPrdInput } from "../../navigation/use-cases-of-prd";
import type { DomainEventType } from "../../../domain/events/domain-event";
import type { PrdBodyDeps } from "./prd-body-deps";

const props = defineProps<{ deps: PrdBodyDeps }>();

// A PRD created/deleted, or a Use Case created/updated/deleted, refreshes the
// tree: the per-PRD Use Case counts (countUseCasesByPrd) and the "Open Use
// Cases" deep-link (firstUseCaseIdOfPrd) both depend on the Use Case set, so a
// deletion must reload or a removed UC lingers in the count/deep-link. As a
// direct Vue body this self-subscribes (it is not driven by the hub's broad
// repaint tick), so `usecase.deleted` is included here where the old
// Imperative-hosted body relied on HUB_REFRESH_ON for it.
const REFRESH_ON: DomainEventType[] = [
  "prd.created",
  "prd.deleted",
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
];

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; tree: PrdTreeNode[]; useCases: UseCaseOfPrdInput[] };

const state = ref<ViewState>({ kind: "loading" });

// Loaded through useEventBus (RenderScheduler SERIALIZES loads). Clear stale
// rows synchronously before the awaits so an event-driven refresh in a slow
// vault cannot leave the old tree's Open/Delete buttons actionable — the
// imperative renderer got this for free by rebuilding the body before its first
// await (matching the Suites/Use-Case-Detail fixes).
async function load(): Promise<void> {
  state.value = { kind: "loading" };
  const [prds, counts, useCases] = await Promise.all([
    props.deps.prdService.findAll(),
    props.deps.useCaseService.countUseCasesByPrd(),
    props.deps.useCaseService.findAll(),
  ]);
  if (!prds.ok) {
    state.value = { kind: "error", message: prds.error.message };
    return;
  }
  const tree = buildPrdTree(prds.value, counts.ok ? counts.value : new Map<string, number>());
  // The flat Use Case list (best-effort) backs the per-row "Open Use Cases"
  // deep-link; a list-load failure just hides that affordance.
  const list = useCases.ok ? useCases.value : [];
  state.value = { kind: "loaded", tree, useCases: list };
}

const { refresh } = useEventBus(props.deps.eventBus, REFRESH_ON, load);
</script>

<template>
  <div>
    <ListHeader
      header-cls="e2e-test-hub-prd-header"
      title="PRDs"
      action-label="New PRD"
      @action="deps.openPrdBuilder()"
    />

    <template v-if="state.kind === 'error'">
      <p>Could not load PRDs: {{ state.message }}</p>
      <button class="mod-cta" aria-label="Retry loading the PRDs" @click="refresh">Retry</button>
    </template>

    <p v-else-if="state.kind === 'loaded' && state.tree.length === 0" class="spec-empty">
      No PRDs yet. Create PRD-000 (the product vision) to get started.
    </p>

    <ul v-else-if="state.kind === 'loaded'" class="e2e-test-hub-prd-tree">
      <PrdNode
        v-for="node in state.tree"
        :key="node.prd.id"
        :node="node"
        :use-cases="state.useCases"
        :deps="deps"
        :refresh="refresh"
      />
    </ul>
  </div>
</template>

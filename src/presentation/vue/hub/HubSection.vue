<script setup lang="ts">
import { computed, inject, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Imperative from "../Imperative.vue";
import { OBSIDIAN_APP } from "../obsidian-app";
import { useEventBus } from "../use-event-bus";
import { HUB_DEPS, HUB_REFRESH_ON } from "./hub-deps";
import { useHubStore } from "./hub-store";
import {
  HUB_SECTION_DESCRIPTORS,
  resolveActiveSection,
  type HubBodyId,
  type HubContentRef,
  type HubSectionDescriptor,
} from "../../navigation/hub-sections";
import { renderOverviewHeroBody } from "../../views/overview-hero-body";
import { renderRecentRunsBody } from "../../views/recent-runs-body";
import { renderUseCaseDashboardBody } from "../../views/use-case-dashboard-body";
import { renderEvidenceExplorerBody } from "../../views/evidence-explorer-body";
import SuiteDashboardBody from "../suites/SuiteDashboardBody.vue";
import PrdExplorerBody from "../prds/PrdExplorerBody.vue";
import StoryMapExplorerBody from "../story-maps/StoryMapExplorerBody.vue";

const deps = inject(HUB_DEPS)!;
const app = inject(OBSIDIAN_APP)!;
const store = useHubStore();
const route = useRoute();
const router = useRouter();

// Emptiness of each Imperative-hosted body by its content index, so its slot can
// collapse (the `:empty`/`is-empty` rule) when the painter renders nothing —
// e.g. recent-runs before the vault is initialized. Imperative reports it.
const bodyEmpty = reactive<Record<number, boolean>>({});

const sectionParam = computed(() =>
  resolveActiveSection(typeof route.params.section === "string" ? route.params.section : undefined),
);
const descriptor = computed<HubSectionDescriptor>(
  () => HUB_SECTION_DESCRIPTORS[sectionParam.value],
);

// The active section repaints its bodies on any refresh event; a hidden section
// (a different route) has no mounted bodies, so its events repaint nothing —
// exactly the hand-rolled hub's "re-render only the active section" contract.
const tick = ref(0);
const refresh = (): void => {
  tick.value += 1;
};
useEventBus(deps.eventBus, HUB_REFRESH_ON, refresh);

// Builds the paint closure for one in-hub body, wiring the hub-owned callbacks
// (KPI-tile → Build with the funnel filter; recent-runs "view all" → Review; the
// Evidence/Use Cases ephemeral filters from the store). Reading the reactive
// store/tick DURING render (this runs inside the `:paint` binding) makes them
// render deps, so a change re-renders and Imperative repaints the body.
// A flat one-arm-per-body dispatch (cognitive 1) — the direct analogue of the
// hand-rolled HubView.renderBody, whose body-id switch carried the same note.
// fallow-ignore-next-line complexity
function bodyPaint(body: HubBodyId): (el: HTMLElement) => void {
  void tick.value;
  const useCaseFilter = store.useCaseFilter;
  const evidenceFilter = store.evidenceFilter;
  const evidenceVisibleLimit = store.evidenceVisibleLimit;
  switch (body) {
    case "kpi-overview":
      return (el) =>
        void renderOverviewHeroBody(el, app, {
          ...deps.hero,
          navigate: (target) => {
            store.setUseCaseFilter(target.filter);
            void router.push("/build");
          },
          refresh,
        });
    case "recent-runs":
      return (el) =>
        void renderRecentRunsBody(el, {
          ...deps.recentRuns,
          openEvidenceExplorer: () => void router.push("/review"),
          refresh,
        });
    case "prd-roadmap":
      // Migrated to the PrdExplorerBody Vue component (Phase 3); rendered
      // directly (not via Imperative). This arm only keeps the switch
      // exhaustive — it is never reached.
      return () => undefined;
    case "story-maps":
      // Migrated to the StoryMapExplorerBody Vue component (Phase 3); rendered
      // directly (not via Imperative). This arm only keeps the switch
      // exhaustive — it is never reached.
      return () => undefined;
    case "use-cases":
      return (el) =>
        void renderUseCaseDashboardBody(el, {
          ...deps.useCases,
          refresh,
          filter: useCaseFilter,
          clearFilter: store.clearUseCaseFilter,
        });
    case "suites":
      // Migrated to the SuiteDashboardBody Vue component (Phase 3); it self-loads
      // and subscribes, so it is rendered directly (not via Imperative). This arm
      // only keeps the switch exhaustive — it is never reached.
      return () => undefined;
    case "evidence":
      return (el) =>
        void renderEvidenceExplorerBody(
          el,
          { ...deps.evidence, refresh },
          {
            filter: evidenceFilter,
            visibleLimit: evidenceVisibleLimit,
            onFilterChange: store.setEvidenceFilter,
            onLoadOlder: store.loadOlderEvidence,
          },
        );
  }
}

const leafLabel = (content: Extract<HubContentRef, { kind: "leaf" }>): string =>
  content.viewType === "e2e-test-hub-console" ? "Open Test Console" : "Open";
const openLeaf = (content: Extract<HubContentRef, { kind: "leaf" }>): void =>
  void deps.workspace.openView(content.viewType, content.location);
</script>

<template>
  <div>
    <template v-for="(content, i) in descriptor.contents" :key="i">
      <div
        v-if="content.kind === 'section-body'"
        class="spec-hub-section-body"
        :class="{ 'is-empty': bodyEmpty[i] }"
      >
        <!-- Vue-native bodies (Phase 3) self-load + subscribe, so they render
             directly; the rest still paint through the Imperative bridge. -->
        <SuiteDashboardBody
          v-if="content.body === 'suites'"
          :deps="{ ...deps.suites, eventBus: deps.eventBus }"
        />
        <PrdExplorerBody
          v-else-if="content.body === 'prd-roadmap'"
          :deps="{ ...deps.prds, eventBus: deps.eventBus }"
        />
        <StoryMapExplorerBody
          v-else-if="content.body === 'story-maps'"
          :deps="{ ...deps.storyMaps, eventBus: deps.eventBus }"
        />
        <Imperative v-else :paint="bodyPaint(content.body)" @empty="bodyEmpty[i] = $event" />
      </div>
      <div v-else class="spec-hub-section-actions">
        <button
          class="spec-hub-section-action mod-cta"
          :aria-label="`${leafLabel(content)} (${descriptor.label} section)`"
          @click="openLeaf(content)"
        >
          {{ leafLabel(content) }}
        </button>
      </div>
    </template>
  </div>
</template>

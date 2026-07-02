<script setup lang="ts">
import { computed, inject } from "vue";
import { useRoute, useRouter } from "vue-router";
import { HUB_DEPS } from "./hub-deps";
import { useHubStore } from "./hub-store";
import {
  HUB_SECTION_DESCRIPTORS,
  resolveActiveSection,
  type HubContentRef,
  type HubSectionDescriptor,
} from "../../navigation/hub-sections";
import type { DashboardNavTarget } from "../../views/dashboard-rows";
import OverviewHeroBody from "../overview/OverviewHeroBody.vue";
import RecentRunsBody from "../overview/RecentRunsBody.vue";
import SuiteDashboardBody from "../suites/SuiteDashboardBody.vue";
import PrdExplorerBody from "../prds/PrdExplorerBody.vue";
import StoryMapExplorerBody from "../story-maps/StoryMapExplorerBody.vue";
import UseCaseDashboardBody from "../use-cases/UseCaseDashboardBody.vue";
import EvidenceExplorerBody from "../evidence/EvidenceExplorerBody.vue";

const deps = inject(HUB_DEPS)!;
const store = useHubStore();
const route = useRoute();
const router = useRouter();

const sectionParam = computed(() =>
  resolveActiveSection(typeof route.params.section === "string" ? route.params.section : undefined),
);
const descriptor = computed<HubSectionDescriptor>(
  () => HUB_SECTION_DESCRIPTORS[sectionParam.value],
);

// The hub-owned section drilldowns the Overview bodies fire: a KPI funnel tile
// switches to Build carrying its funnel filter (via the store); "View all runs"
// opens the Review section. Every section body is now a Vue-native component
// (Phase 3) that self-loads and self-subscribes to the bus, so HubSection holds
// no repaint machinery — it just wires each body's deps and renders it.
const heroNavigate = (target: DashboardNavTarget): void => {
  store.setUseCaseFilter(target.filter);
  void router.push("/build");
};
const openEvidenceExplorer = (): void => void router.push("/review");

const leafLabel = (content: Extract<HubContentRef, { kind: "leaf" }>): string =>
  content.viewType === "e2e-test-hub-console" ? "Open Test Console" : "Open";
const openLeaf = (content: Extract<HubContentRef, { kind: "leaf" }>): void =>
  void deps.workspace.openView(content.viewType, content.location);
</script>

<template>
  <div>
    <template v-for="(content, i) in descriptor.contents" :key="i">
      <!-- Each section body is a Vue-native component; a body that renders
           nothing (recent-runs pre-init) collapses via the slot's `:empty` rule
           (its root `v-if` leaves only a comment, which `:empty` ignores). -->
      <div v-if="content.kind === 'section-body'" class="spec-hub-section-body">
        <OverviewHeroBody
          v-if="content.body === 'kpi-overview'"
          :deps="{ ...deps.hero, navigate: heroNavigate, eventBus: deps.eventBus }"
        />
        <RecentRunsBody
          v-else-if="content.body === 'recent-runs'"
          :deps="{ ...deps.recentRuns, openEvidenceExplorer, eventBus: deps.eventBus }"
        />
        <PrdExplorerBody
          v-else-if="content.body === 'prd-roadmap'"
          :deps="{ ...deps.prds, eventBus: deps.eventBus }"
        />
        <StoryMapExplorerBody
          v-else-if="content.body === 'story-maps'"
          :deps="{ ...deps.storyMaps, eventBus: deps.eventBus }"
        />
        <UseCaseDashboardBody
          v-else-if="content.body === 'use-cases'"
          :deps="{ ...deps.useCases, eventBus: deps.eventBus }"
          :filter="store.useCaseFilter"
          :clear-filter="store.clearUseCaseFilter"
        />
        <EvidenceExplorerBody
          v-else-if="content.body === 'evidence'"
          :deps="{ ...deps.evidence, eventBus: deps.eventBus }"
          :filter="store.evidenceFilter"
          :visible-limit="store.evidenceVisibleLimit"
          :on-filter-change="store.setEvidenceFilter"
          :on-load-older="store.loadOlderEvidence"
        />
        <SuiteDashboardBody
          v-else-if="content.body === 'suites'"
          :deps="{ ...deps.suites, eventBus: deps.eventBus }"
        />
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

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
import SuiteDashboardBody from "../suites/SuiteDashboardBody.vue";
import PrdExplorerBody from "../prds/PrdExplorerBody.vue";
import StoryMapExplorerBody from "../story-maps/StoryMapExplorerBody.vue";
import UseCaseDashboardBody from "../use-cases/UseCaseDashboardBody.vue";
import EvidenceExplorerBody from "../evidence/EvidenceExplorerBody.vue";

const deps = inject(HUB_DEPS)!;
const app = inject(OBSIDIAN_APP)!;
const store = useHubStore();
const route = useRoute();
const router = useRouter();

// Emptiness of each Imperative-hosted body by its STABLE body id, so its slot can
// collapse (the `:empty`/`is-empty` rule) when the painter renders nothing —
// e.g. recent-runs before the vault is initialized. Imperative reports it.
// Keyed by body id, NOT content index: vue-router reuses this HubSection instance
// across section switches, so a positional key would carry a hidden section's
// stale `is-empty` onto whatever body lands at the same index next (e.g. Plan's
// story-maps inheriting Overview's empty recent-runs, then never cleared because
// a Vue-native body emits no `empty`). Body ids are unique per body, so no carry.
const bodyEmpty = reactive<Partial<Record<HubBodyId, boolean>>>({});

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

// The paint closure per in-hub body, wiring the hub-owned callbacks (KPI-tile →
// Build with the funnel filter; recent-runs "view all" → Review; the Evidence
// ephemeral filters from the store).
//
// Crucially this is a COMPUTED over ONLY the real repaint inputs (`tick` + the
// Evidence store fields it reads) — NOT `bodyEmpty`. Imperative repaints when its
// `paint` prop changes identity; if the paint were rebuilt on every render, an
// async painter (empty → content → empty…) whose emptiness event re-renders this
// component would hand Imperative a fresh closure each time and self-trigger an
// ENDLESS repaint loop (P1). Keeping the closures out of the emptiness-dependent
// render path holds their identity stable across `bodyEmpty` changes, so an
// emptiness toggle updates the `is-empty` class only and never repaints.
// A flat one-arm-per-body map — the direct analogue of the hand-rolled
// HubView.renderBody, whose body-id switch carried the same note. Only the
// Overview hero + recent-runs remain Imperative-hosted; the rest are Vue-native
// (Phase 3) and render directly, so their arms are never reached — they only
// keep the record exhaustive over HubBodyId.
const bodyPaints = computed<Record<HubBodyId, (el: HTMLElement) => void>>(() => {
  void tick.value;
  const migrated = (): void => undefined;
  return {
    "kpi-overview": (el) =>
      void renderOverviewHeroBody(el, app, {
        ...deps.hero,
        navigate: (target) => {
          store.setUseCaseFilter(target.filter);
          void router.push("/build");
        },
        refresh,
      }),
    "recent-runs": (el) =>
      void renderRecentRunsBody(el, {
        ...deps.recentRuns,
        openEvidenceExplorer: () => void router.push("/review"),
        refresh,
      }),
    "prd-roadmap": migrated,
    "story-maps": migrated,
    "use-cases": migrated,
    suites: migrated,
    evidence: migrated,
  };
});

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
        :class="{ 'is-empty': bodyEmpty[content.body] }"
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
        <Imperative
          v-else
          :paint="bodyPaints[content.body]"
          @empty="bodyEmpty[content.body] = $event"
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

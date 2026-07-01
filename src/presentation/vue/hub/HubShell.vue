<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import Icon from "../Icon.vue";
import Imperative from "../Imperative.vue";
import { useEventBus } from "../use-event-bus";
import { HUB_DEPS, HUB_REFRESH_ON } from "./hub-deps";
import { useHubStore } from "./hub-store";
import {
  projectHubRail,
  resolveActiveSection,
  type HubSectionId,
} from "../../navigation/hub-sections";
import { renderOnboardingRailBody } from "../../views/onboarding-rail-body";

const deps = inject(HUB_DEPS)!;
const store = useHubStore();
const route = useRoute();
const router = useRouter();

const section = computed(() =>
  resolveActiveSection(typeof route.params.section === "string" ? route.params.section : undefined),
);
const rail = computed(() => projectHubRail(section.value));

// The docked onboarding rail persists across section switches (a sibling of the
// content panel), so it lives here on the shell and repaints on the same events.
const tick = ref(0);
const refresh = (): void => {
  tick.value += 1;
};
useEventBus(deps.eventBus, HUB_REFRESH_ON, refresh);

const switchSection = (id: HubSectionId): void => void router.push(`/${id}`);

function onboardingPaint(): (el: HTMLElement) => void {
  void tick.value;
  const collapsed = store.onboardingCollapsed;
  return (el) =>
    void renderOnboardingRailBody(el, {
      ...deps.onboarding,
      collapsed,
      onToggleCollapsed: store.toggleOnboardingCollapsed,
      refresh,
    });
}
</script>

<template>
  <div class="spec-hub">
    <div class="spec-hub-identity">
      <Icon name="layout-dashboard" class="spec-hub-wordmark-icon" />
      <span class="spec-hub-wordmark">Test Hub</span>
    </div>
    <div class="spec-hub-layout">
      <nav class="spec-hub-rail" aria-label="Test Hub sections">
        <button
          v-for="node in rail.nodes"
          :key="node.descriptor.id"
          :class="node.active ? 'spec-hub-rail-node is-active' : 'spec-hub-rail-node'"
          :aria-label="node.descriptor.ariaLabel"
          :aria-current="node.active ? 'page' : 'false'"
          @click="switchSection(node.descriptor.id)"
        >
          <Icon :name="node.descriptor.icon" class="spec-hub-rail-icon" />
          <span class="spec-hub-rail-label">{{ node.descriptor.label }}</span>
        </button>
      </nav>
      <div class="spec-hub-panel"><RouterView /></div>
    </div>
    <div class="spec-hub-onboarding-rail"><Imperative :paint="onboardingPaint()" /></div>
  </div>
</template>

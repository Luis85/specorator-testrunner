<script setup lang="ts">
import { computed, inject } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import Icon from "../Icon.vue";
import OnboardingRailBody from "../onboarding/OnboardingRailBody.vue";
import { HUB_DEPS } from "./hub-deps";
import { useHubStore } from "./hub-store";
import {
  projectHubRail,
  resolveActiveSection,
  type HubSectionId,
} from "../../navigation/hub-sections";

const deps = inject(HUB_DEPS)!;
const store = useHubStore();
const route = useRoute();
const router = useRouter();

const section = computed(() =>
  resolveActiveSection(typeof route.params.section === "string" ? route.params.section : undefined),
);
const rail = computed(() => projectHubRail(section.value));

const switchSection = (id: HubSectionId): void => void router.push(`/${id}`);
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
    <!-- The docked onboarding rail: a Vue-native body that self-loads + subscribes
         and collapses to nothing (a `hidden` projection → root v-if comment) via
         the slot's `:empty` rule when there's no rail to show. -->
    <div class="spec-hub-onboarding-rail">
      <OnboardingRailBody
        :deps="{ ...deps.onboarding, eventBus: deps.eventBus }"
        :collapsed="store.onboardingCollapsed"
        :on-toggle-collapsed="store.toggleOnboardingCollapsed"
      />
    </div>
  </div>
</template>

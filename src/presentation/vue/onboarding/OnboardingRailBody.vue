<script setup lang="ts">
/**
 * The docked onboarding rail (ADR-0033 Phase 3): resolves the three live inputs
 * (init signal, Use Case count, tour state), projects the single next action via
 * the pure {@link projectOnboarding}, and renders it — the Initialize CTA, the
 * first-Use-Case CTA, the tour checklist (shared {@link TourStep}), or the
 * dismissible done line — with the collapse chrome. The Vue twin of
 * `renderOnboardingRailBody`.
 *
 * When the projection is `hidden` (a dismissed / not-applicable rail) the root
 * v-if renders only a comment, so the enclosing `.spec-hub-onboarding-rail` is
 * `:empty` and collapses (the pre-Vue behaviour) — no emptiness plumbing needed.
 */
import { shallowRef } from "vue";
import { useEventBus } from "../use-event-bus";
import { HUB_REFRESH_ON } from "../hub/hub-deps";
import TourStep from "../guided-tour/TourStep.vue";
import {
  projectOnboarding,
  type OnboardingInit,
  type OnboardingRail,
} from "../../views/onboarding-rail-rows";
import type { OnboardingBodyDeps } from "./onboarding-body-deps";

const props = defineProps<{
  deps: OnboardingBodyDeps;
  /** Hub-owned ephemeral collapse (chrome) — distinct from Dismiss (persisted). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}>();

type ViewState =
  | { kind: "loading" }
  | { kind: "load-failed" }
  | { kind: "rail"; rail: OnboardingRail };

const state = shallowRef<ViewState>({ kind: "loading" });

// The rail derives from the snapshot (Use Case count) + tour state, so it depends
// on the full hub refresh set (the same the hand-rolled hub's tick fired on).
async function load(): Promise<void> {
  state.value = { kind: "loading" };
  const init: OnboardingInit = (await props.deps.isInitialized())
    ? "initialized"
    : "not-initialized";
  if (init === "not-initialized") {
    state.value = { kind: "rail", rail: projectOnboarding(init, 0, props.deps.tour.getState()) };
    return;
  }
  // A failed snapshot read → the retryable load error, NOT a mis-projected empty
  // hub (the wiring maps a Result.err to null).
  const ucCount = await loadUcCount();
  if (ucCount === null) {
    state.value = { kind: "load-failed" };
    return;
  }
  state.value = {
    kind: "rail",
    rail: projectOnboarding(init, ucCount, props.deps.tour.getState()),
  };
}

async function loadUcCount(): Promise<number | null> {
  try {
    return await props.deps.ucCount();
  } catch {
    return null;
  }
}

const { refresh } = useEventBus(props.deps.eventBus, HUB_REFRESH_ON, load);

// GuidedTourService.dismiss() PERSISTS the flag but publishes no tour event, so
// without this explicit refresh the rail would linger until an unrelated event
// (restart/start publish tour.started, which the refresh set covers).
const dismiss = (): void => void props.deps.tour.dismiss().then(refresh);
const restart = (): void => void props.deps.tour.restart();

// The compact header line (shown collapsed, and above the body expanded).
const headerText = (rail: Exclude<OnboardingRail, { kind: "hidden" }>): string => {
  switch (rail.kind) {
    case "initialize":
    case "first-use-case":
      return rail.title;
    case "tour":
      return `Next: ${rail.nextAction}`;
    case "done":
      return rail.message;
  }
};
</script>

<template>
  <div v-if="state.kind !== 'loading' && !(state.kind === 'rail' && state.rail.kind === 'hidden')">
    <template v-if="state.kind === 'load-failed'">
      <p>Could not load the onboarding rail.</p>
      <button class="mod-cta" aria-label="Retry loading the onboarding rail" @click="refresh">
        Retry
      </button>
    </template>

    <div
      v-else-if="state.rail.kind !== 'hidden'"
      :class="collapsed ? 'spec-hub-onboarding is-collapsed' : 'spec-hub-onboarding'"
      role="group"
      :aria-label="state.rail.ariaLabel"
    >
      <div class="spec-hub-onboarding-header">
        <button
          class="spec-hub-onboarding-toggle"
          :aria-expanded="collapsed ? 'false' : 'true'"
          :aria-label="collapsed ? 'Expand the onboarding rail' : 'Collapse the onboarding rail'"
          @click="onToggleCollapsed()"
        >
          {{ collapsed ? "▸" : "▾" }}
        </button>
        <div class="spec-hub-onboarding-title">{{ headerText(state.rail) }}</div>
      </div>

      <div v-if="!collapsed" class="spec-hub-onboarding-body">
        <template v-if="state.rail.kind === 'initialize'">
          <div class="spec-hub-onboarding-teach">{{ state.rail.teach }}</div>
          <button
            class="spec-hub-onboarding-cta mod-cta"
            :aria-label="state.rail.cta.ariaLabel"
            @click="deps.openWizard()"
          >
            {{ state.rail.cta.label }}
          </button>
        </template>

        <template v-else-if="state.rail.kind === 'first-use-case'">
          <div class="spec-hub-onboarding-teach">{{ state.rail.teach }}</div>
          <div class="spec-hub-onboarding-actions">
            <button
              class="spec-hub-onboarding-cta mod-cta"
              :aria-label="state.rail.primary.ariaLabel"
              @click="deps.openCreateUseCase()"
            >
              {{ state.rail.primary.label }}
            </button>
            <button
              class="spec-hub-onboarding-cta"
              :aria-label="state.rail.secondary.ariaLabel"
              @click="deps.startTour()"
            >
              {{ state.rail.secondary.label }}
            </button>
          </div>
        </template>

        <template v-else-if="state.rail.kind === 'tour'">
          <div class="spec-hub-onboarding-steps">
            <TourStep
              v-for="row in state.rail.tour.rows"
              :key="row.id"
              :row="row"
              @dispatch="deps.dispatchTourAction"
              @mark-done="(id) => deps.tour.markDone(id)"
              @skip="(id) => deps.tour.skip(id)"
            />
          </div>
          <div class="spec-hub-onboarding-progress">{{ state.rail.tour.progressLabel }}</div>
          <div class="spec-hub-onboarding-actions">
            <button
              class="spec-hub-onboarding-cta"
              aria-label="Hide the onboarding rail"
              @click="dismiss"
            >
              Dismiss
            </button>
          </div>
        </template>

        <template v-else>
          <div class="spec-hub-onboarding-teach">{{ state.rail.message }}</div>
          <div class="spec-hub-onboarding-actions">
            <button
              class="spec-hub-onboarding-cta mod-cta"
              aria-label="Hide the onboarding rail"
              @click="dismiss"
            >
              Dismiss
            </button>
            <button
              class="spec-hub-onboarding-cta"
              aria-label="Restart the guided tour from the beginning"
              @click="restart"
            >
              Restart tour
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

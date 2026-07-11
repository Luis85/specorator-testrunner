<script setup lang="ts">
import { inject, ref } from "vue";
import { GUIDED_TOUR_DEPS } from "./guided-tour-deps";
import TourStep from "./TourStep.vue";
import { useEventBus } from "../use-event-bus";
import { projectTour, TOUR_DONE_MESSAGE, type TourViewModel } from "../../views/guided-tour-rows";
import { dispatchTourAction } from "../../views/tour-actions";
import type { TourActionId, TourStepId } from "../../../domain/onboarding/tour-steps";

// Injected by GuidedTourView.onOpen (mountVueView's setup). The `!` is safe: the
// view always provides the key before mounting.
const deps = inject(GUIDED_TOUR_DEPS)!;

// The same pure projection the hand-rolled view used; the view stays thin, all
// decisions live in projectTour (AGENTS.md). Re-projected on every tour event
// through the serialized useEventBus refresh — the Vue replacement for
// LiveRefresh (the tour service drives progress; evidence.generated arms the
// manual step's hint, which publishes no tour event).
const model = ref<TourViewModel>(projectTour(deps.tour.getState()));
useEventBus(
  deps.eventBus,
  [
    "tour.started",
    "tour.step.completed",
    "tour.step.skipped",
    "tour.completed",
    "evidence.generated",
  ],
  () => {
    model.value = projectTour(deps.tour.getState());
  },
);

const dispatch = (id: TourActionId): void => dispatchTourAction(id, deps);
const markDone = (id: TourStepId): void => void deps.tour.markDone(id);
const skip = (id: TourStepId): void => void deps.tour.skip(id);
const restart = (): void => void deps.tour.restart();
const dismiss = (): void => void deps.tour.dismiss();
</script>

<template>
  <div>
    <h2>Guided tour</h2>
    <div class="e2e-test-hub-tour-progress">{{ model.progressLabel }}</div>
    <p v-if="model.completed">{{ TOUR_DONE_MESSAGE }}</p>
    <p v-else class="e2e-test-hub-tour-hint">
      Each step completes by itself when you perform the real action.
    </p>

    <TourStep
      v-for="row in model.rows"
      :key="row.id"
      :row="row"
      @dispatch="dispatch"
      @mark-done="markDone"
      @skip="skip"
    />

    <div class="e2e-test-hub-tour-actions">
      <button aria-label="Restart the guided tour from the beginning" @click="restart">
        Restart tour
      </button>
      <button
        v-if="!model.dismissed && !model.completed"
        aria-label="Hide the guided tour call to action on the dashboard"
        @click="dismiss"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>

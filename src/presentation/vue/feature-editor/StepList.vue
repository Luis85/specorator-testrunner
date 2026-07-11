<script setup lang="ts">
/**
 * A step list + "+ step" button (ADR-0033), shared by the Background card and
 * every scenario card. The Vue twin of `renderStepList`: it renders one
 * {@link StepRow} per step and appends a guided-keyword step on demand. The
 * optional `onRemoved` lets a caller (the Background) drop itself once emptied.
 */
import { inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import StepRow from "./StepRow.vue";
import { newStep } from "../../views/feature-editor-format";
import type { GherkinStep } from "../../../domain/entities/specification";

const props = defineProps<{ steps: GherkinStep[]; onRemoved?: () => void }>();
const ctrl = inject(FEATURE_EDITOR)!;

const addStep = (): void => {
  props.steps.push(newStep(props.steps));
  ctrl.commit();
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor-steps">
    <StepRow
      v-for="(step, index) in steps"
      :key="index"
      :steps="steps"
      :index="index"
      :on-removed="onRemoved"
    />
    <button class="e2e-test-hub-feature-editor-add" @click="addStep">+ step</button>
  </div>
</template>

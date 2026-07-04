<script setup lang="ts">
/**
 * One editable step row (ADR-0033): keyword select, datalist-backed text input
 * with a live "missing step definition" flag, ↑/↓ reorder, delete, and the
 * optional data-table / doc-string extras. The Vue twin of `renderStepRow`.
 *
 * The step's fields bind through `v-model` on the reactive `step`, so a keystroke
 * never rebuilds the input — Vue preserves the DOM and caret. `.lazy` commits on
 * change (blur/Enter), matching the imperative row's change-event commit.
 */
import { computed, inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import { STEP_DATALIST_ID } from "./datalist-ids";
import MoveButtons from "./MoveButtons.vue";
import StepExtras from "./StepExtras.vue";
import { stepIsImplemented } from "../../views/feature-editor-format";
import type { GherkinStep } from "../../../domain/entities/specification";

const props = defineProps<{ steps: GherkinStep[]; index: number; onRemoved?: () => void }>();
const ctrl = inject(FEATURE_EDITOR)!;

const step = computed(() => props.steps[props.index]);
// Re-evaluates as the step text and the loaded patterns change; empty text is
// "incomplete", not "missing" (the validation strip owns that complaint).
const implemented = computed(() => stepIsImplemented(step.value.text, ctrl.stepPatterns.value));

const remove = (): void => {
  props.steps.splice(props.index, 1);
  props.onRemoved?.();
  ctrl.commit();
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor-step" :class="{ 'is-missing-step': !implemented }">
    <select v-model.lazy="step.keyword" aria-label="Step keyword" @change="ctrl.commit()">
      <option
        v-for="value in ['Given', 'When', 'Then', 'And', 'But', '*']"
        :key="value"
        :value="value"
      >
        {{ value }}
      </option>
    </select>
    <input
      v-model.lazy.trim="step.text"
      type="text"
      class="e2e-test-hub-feature-editor-step-text"
      placeholder="Step text"
      :list="STEP_DATALIST_ID"
      aria-label="Step text"
      @change="ctrl.commit()"
    />
    <span
      class="e2e-test-hub-feature-editor-step-flag"
      :title="implemented ? '' : 'No step definition matches this step.'"
    >
      {{ implemented ? "" : "!" }}
    </span>
    <MoveButtons :array="steps" :index="index" noun="step" />
    <button aria-label="Delete step" @click="remove">×</button>
  </div>
  <StepExtras :step="step" />
</template>

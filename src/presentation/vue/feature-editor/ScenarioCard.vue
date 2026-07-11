<script setup lang="ts">
/**
 * One scenario card (ADR-0033): the head (keyword type, name, ↑/↓, delete), the
 * tag editor, the step list, and — for a Scenario Outline — its Examples grids.
 * The Vue twin of `renderScenarioCard` + `renderScenarioExamples`.
 *
 * The keyword select can't use `v-model` because switching type has side effects
 * on the model (an Outline needs Examples; a plain Scenario can carry none), so it
 * binds `:value` + a change handler — the same transitions the imperative select
 * ran.
 */
import { computed, inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import MoveButtons from "./MoveButtons.vue";
import TagEditor from "./TagEditor.vue";
import StepList from "./StepList.vue";
import ExamplesGrid from "./ExamplesGrid.vue";
import { newExamplesBlock } from "../../views/feature-editor-format";
import {
  isScenarioOutline,
  type FeatureSpecification,
} from "../../../domain/entities/specification";

const props = defineProps<{ spec: FeatureSpecification; index: number }>();
const ctrl = inject(FEATURE_EDITOR)!;

const scenario = computed(() => props.spec.scenarios[props.index]);
const isOutline = computed(() => isScenarioOutline(scenario.value));

const changeKeyword = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value;
  const current = scenario.value;
  if (value === "Scenario Outline") {
    current.keyword = "Scenario Outline";
    current.examples ??= [newExamplesBlock()];
  } else {
    // A plain Scenario cannot carry Examples; switching back drops them
    // (Obsidian's File Recovery snapshots are the undo path).
    delete current.keyword;
    delete current.examples;
  }
  ctrl.commit();
};
const remove = (): void => {
  props.spec.scenarios.splice(props.index, 1);
  ctrl.commit();
};
const addExamplesBlock = (): void => {
  const blocks = (scenario.value.examples ??= []);
  blocks.push(newExamplesBlock());
  ctrl.commit();
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor-card">
    <div class="e2e-test-hub-feature-editor-scenario-head">
      <select
        :value="scenario.keyword ?? 'Scenario'"
        aria-label="Scenario type"
        @change="changeKeyword"
      >
        <option v-for="value in ['Scenario', 'Scenario Outline']" :key="value" :value="value">
          {{ value }}
        </option>
      </select>
      <input
        v-model.lazy.trim="scenario.name"
        type="text"
        placeholder="Scenario name"
        aria-label="Scenario name"
        @change="ctrl.commit()"
      />
      <MoveButtons :array="spec.scenarios" :index="index" noun="scenario" />
      <button aria-label="Delete scenario" @click="remove">Delete</button>
    </div>

    <TagEditor :tags="scenario.tags" label="Scenario tags" />
    <StepList :steps="scenario.steps" />

    <template v-if="isOutline">
      <ExamplesGrid
        v-for="(examplesBlock, blockIndex) in scenario.examples ?? []"
        :key="blockIndex"
        :blocks="scenario.examples ?? []"
        :index="blockIndex"
      />
      <button @click="addExamplesBlock">+ Examples block</button>
    </template>
  </div>
</template>

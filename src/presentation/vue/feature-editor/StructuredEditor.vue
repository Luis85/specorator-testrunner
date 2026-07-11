<script setup lang="ts">
/**
 * The structured `.feature` editor body (ADR-0033): the shared autocomplete
 * datalists, the ✓/✗/! validation strip, the Feature header card (name, tags,
 * description), the Background card, and the scenario cards. The Vue twin of the
 * imperative view's `renderStructured`.
 *
 * Every field binds to the reactive spec through `v-model` / change handlers that
 * call `ctrl.commit()`, which re-serialises the spec into the raw `data` and
 * debounce-saves — without re-projecting, so the caret survives the edit.
 */
import { computed, inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import { STEP_DATALIST_ID, TAG_DATALIST_ID } from "./datalist-ids";
import TagEditor from "./TagEditor.vue";
import StepList from "./StepList.vue";
import ScenarioCard from "./ScenarioCard.vue";
import {
  asDescriptionLines,
  newScenario,
  newStep,
  stepSuggestions,
  validationDisplayEntries,
} from "../../views/feature-editor-format";
import type { FeatureSpecification } from "../../../domain/entities/specification";

const props = defineProps<{ spec: FeatureSpecification }>();
const ctrl = inject(FEATURE_EDITOR)!;

const stepOptions = computed(() => stepSuggestions(ctrl.stepPatterns.value));
const validation = computed(() =>
  validationDisplayEntries(props.spec, ctrl.baselineScenarioNames.value),
);
const descriptionText = computed(() => (props.spec.description ?? []).join("\n"));

const renameFeature = (): void => ctrl.commit();
const changeDescription = (event: Event): void => {
  const textarea = event.target as HTMLTextAreaElement;
  const lines = asDescriptionLines(textarea.value);
  if (lines.length > 0) props.spec.description = lines;
  else delete props.spec.description;
  textarea.value = lines.join("\n"); // reflect dropped non-description lines
  ctrl.commit();
};
const addBackground = (): void => {
  props.spec.background = [newStep([])];
  ctrl.commit();
};
const dropEmptyBackground = (): void => {
  // Serialisation omits an empty Background; drop it from the model too.
  if (props.spec.background && props.spec.background.length === 0) delete props.spec.background;
};
const addScenario = (): void => {
  props.spec.scenarios.push(newScenario());
  ctrl.commit();
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor-body">
    <datalist :id="STEP_DATALIST_ID">
      <option v-for="value in stepOptions" :key="value" :value="value"></option>
    </datalist>
    <datalist :id="TAG_DATALIST_ID">
      <option v-for="value in ctrl.knownTags.value" :key="value" :value="value"></option>
    </datalist>

    <div class="e2e-test-hub-feature-editor-validation" aria-live="polite">
      <div
        v-for="(item, i) in validation"
        :key="i"
        class="e2e-test-hub-feature-editor-check"
        :data-level="item.level"
      >
        {{ item.symbol }} {{ item.message }}
      </div>
    </div>

    <div class="e2e-test-hub-feature-editor-card">
      <input
        v-model.lazy.trim="spec.featureName"
        type="text"
        class="e2e-test-hub-feature-editor-name"
        placeholder="Feature name"
        aria-label="Feature name"
        @change="renameFeature"
      />
      <TagEditor :tags="spec.tags" label="Feature tags" />
      <textarea
        :value="descriptionText"
        class="e2e-test-hub-feature-editor-description"
        placeholder="Description (optional)"
        aria-label="Feature description"
        rows="2"
        @change="changeDescription"
      ></textarea>
    </div>

    <div class="e2e-test-hub-feature-editor-card">
      <h3>Background</h3>
      <StepList v-if="spec.background" :steps="spec.background" :on-removed="dropEmptyBackground" />
      <button v-else @click="addBackground">+ Background</button>
    </div>

    <ScenarioCard
      v-for="(scenario, index) in spec.scenarios"
      :key="index"
      :spec="spec"
      :index="index"
    />
    <button class="e2e-test-hub-feature-editor-add" @click="addScenario">+ Scenario</button>
  </div>
</template>

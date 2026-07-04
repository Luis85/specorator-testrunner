<script setup lang="ts">
/**
 * The Feature Editor root (ADR-0033 Phase 4): the mode toolbar (Structured / Raw
 * text / ▶ Run / ✓ Validate), the inline validate result, and the active body —
 * the structured editor or the raw textarea. The Vue rewrite of the imperative
 * `FeatureEditorView.render` + `renderToolbar` + `renderRaw`.
 *
 * The whole surface is driven by the injected {@link FeatureEditorController},
 * which the owning TextFileView creates and provides so its data/save lifecycle
 * stays the single source of truth. Structured mode binds to the reactive spec, so
 * editing never rebuilds the inputs (no focus-restore machinery).
 */
import { computed, inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import StructuredEditor from "./StructuredEditor.vue";
import Icon from "../Icon.vue";
import ChecklistRows from "../ChecklistRows.vue";

const ctrl = inject(FEATURE_EDITOR)!;

const structuredActive = computed(
  () => ctrl.mode.value === "structured" && ctrl.spec.value !== null,
);
const showBanner = computed(() => ctrl.spec.value === null && ctrl.data.value.trim() !== "");

const onRawInput = (event: Event): void => {
  ctrl.onRawInput((event.target as HTMLTextAreaElement).value);
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor">
    <div class="e2e-test-hub-feature-editor-toolbar">
      <button
        :class="{ 'mod-cta': structuredActive }"
        :aria-pressed="structuredActive"
        @click="ctrl.toStructured()"
      >
        Structured
      </button>
      <button
        :class="{ 'mod-cta': !structuredActive }"
        :aria-pressed="!structuredActive"
        @click="ctrl.toRaw()"
      >
        Raw text
      </button>

      <div class="e2e-test-hub-feature-editor-toolbar-forward">
        <button class="mod-cta" aria-label="Run this feature" @click="ctrl.runFeature()">
          <Icon name="play" class="e2e-test-hub-feature-editor-toolbar-icon" />
          <span>Run</span>
        </button>
        <button aria-label="Validate this feature" @click="ctrl.validateFeature()">
          <Icon name="check" class="e2e-test-hub-feature-editor-toolbar-icon" />
          <span>Validate</span>
        </button>
      </div>
    </div>

    <div
      v-if="ctrl.validateResult.value"
      class="e2e-test-hub-feature-editor-validate-result"
      aria-live="polite"
    >
      <ChecklistRows :rows="ctrl.validateResult.value" />
    </div>

    <StructuredEditor v-if="structuredActive" :spec="ctrl.spec.value!" />

    <template v-else>
      <div v-if="showBanner" class="spec-banner" data-status="warning">
        Structured editing is unavailable: the file is not a parseable Feature or contains
        constructs the editor can't preserve (comments, Rule: blocks).
      </div>
      <textarea
        class="e2e-test-hub-feature-editor-raw"
        aria-label="Raw Gherkin"
        :value="ctrl.data.value"
        @input="onRawInput"
      ></textarea>
    </template>
  </div>
</template>

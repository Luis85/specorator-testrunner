<script setup lang="ts">
import { inject, onMounted, ref } from "vue";
import { USE_CASE_DETAIL_DEPS } from "./use-case-detail-deps";
import ChecklistRows from "../ChecklistRows.vue";
import type { ChecklistRow } from "../../views/checklist";
import { featureTarget } from "../../navigation/navigation-target";
import {
  detectMissingStepsOutcome,
  featureHealthLine,
  generateStepDefinitionsOutcome,
  validateFeatureOutcome,
  type FeatureHealthLine,
  type FeatureRow as FeatureRowModel,
} from "../../views/use-case-detail-rows";

const props = defineProps<{ row: FeatureRowModel }>();
const deps = inject(USE_CASE_DETAIL_DEPS)!;

// The muted per-Feature health line (Wave F), loaded once on mount; an
// unreadable/unparseable Feature simply leaves the line empty (Validate explains
// why). Vue's reactivity replaces the hand-rolled isConnected guard.
const health = ref<FeatureHealthLine | null>(null);
onMounted(async () => {
  const result = await deps.featureInsight.healthFor(props.row.path);
  if (result.ok) health.value = featureHealthLine(result.value);
});

// The inline validate/detect/generate outcome (the wizard's ✓/✗/! vocabulary).
const result = ref<ChecklistRow[] | null>(null);
const pending = (text: string): ChecklistRow[] => [{ status: "pending", icon: "…", text }];

const open = (): void => deps.navigate(featureTarget(props.row.path));
const run = (): void => void deps.runLauncher.launch({ scope: "feature", target: props.row.path });

const validate = async (): Promise<void> => {
  result.value = pending("Validating…");
  result.value = await validateFeatureOutcome(deps.specificationService, props.row.path);
};
const detect = async (): Promise<void> => {
  result.value = pending("Detecting…");
  result.value = await detectMissingStepsOutcome(deps.specificationService, props.row.path);
};
const generate = async (): Promise<void> => {
  result.value = pending("Generating step definitions…");
  result.value = await generateStepDefinitionsOutcome(
    deps.specificationService,
    deps.stepDefinitionService,
    props.row.path,
  );
};
</script>

<template>
  <div class="e2e-test-hub-uc-detail-feature">
    <div class="e2e-test-hub-uc-detail-feature-head">
      <span class="e2e-test-hub-uc-detail-feature-name" :title="row.path">{{ row.label }}</span>
      <div class="e2e-test-hub-uc-detail-feature-actions">
        <button :aria-label="`Open ${row.label}`" @click="open">Open</button>
        <button :aria-label="`Run ${row.label}`" @click="run">Run</button>
        <button :aria-label="`Validate ${row.label}`" @click="validate">Validate</button>
        <button :aria-label="`Detect missing steps in ${row.label}`" @click="detect">
          Detect missing steps
        </button>
        <button :aria-label="`Generate step definitions for ${row.label}`" @click="generate">
          Generate step definitions
        </button>
      </div>
    </div>
    <div v-if="health" class="e2e-test-hub-uc-detail-feature-health">
      <span>{{ health.text }}</span>
      <span
        v-for="badge in health.badges"
        :key="badge.text"
        :class="badge.cls"
        :title="badge.tooltip"
        :aria-label="badge.tooltip"
        >{{ badge.text }}</span
      >
    </div>
    <div class="e2e-test-hub-uc-detail-feature-result" aria-live="polite">
      <ChecklistRows v-if="result" :rows="result" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, ref, watch } from "vue";
import { USE_CASE_DETAIL_DEPS } from "./use-case-detail-deps";
import ChecklistRows from "../ChecklistRows.vue";
import type { ChecklistRow } from "../../views/checklist";
import { featureTarget } from "../../navigation/navigation-target";
import {
  featureHealthLine,
  validateFeatureOutcome,
  type FeatureHealthLine,
  type FeatureRow as FeatureRowModel,
} from "../../views/use-case-detail-rows";

const props = defineProps<{ row: FeatureRowModel }>();
const deps = inject(USE_CASE_DETAIL_DEPS)!;

// The muted per-Feature health line (Wave F). An unreadable/unparseable Feature
// leaves the line empty (Validate explains why).
const health = ref<FeatureHealthLine | null>(null);
// The inline Validate outcome (the wizard's ✓/✗/! vocabulary).
const result = ref<ChecklistRow[] | null>(null);

// A monotonic generation counter, bumped on every refresh (row-prop change). Any
// in-flight async read captures the current generation and drops its write if a
// refresh has happened since — the Vue equivalent of the pre-Vue captured-element
// isConnected guard, which skipped writing into a result element a re-render had
// detached. Rows are keyed by path, so the component is REUSED across a
// same-Feature refresh, which is exactly when a stale write could otherwise land.
let generation = 0;

async function loadHealth(): Promise<void> {
  const gen = generation;
  const loaded = await deps.featureInsight.healthFor(props.row.path);
  if (gen === generation) health.value = loaded.ok ? featureHealthLine(loaded.value) : null;
}

// Rows are keyed by path, so a refresh that keeps a Feature reuses this component
// with a fresh `row` object (projectFeatureRows builds new objects each reload) —
// onMounted would only run once. Re-run the health load on every such change and
// clear any stale inline result, mirroring the pre-Vue render() which re-ran
// renderFeatureHealth() and rebuilt a fresh result element on every refresh.
watch(
  () => props.row,
  () => {
    generation += 1;
    result.value = null;
    void loadHealth();
  },
  { immediate: true },
);

const pending = (text: string): ChecklistRow[] => [{ status: "pending", icon: "…", text }];

const open = (): void => deps.navigate(featureTarget(props.row.path));
const run = (): void => void deps.runLauncher.launch({ scope: "feature", target: props.row.path });

// The inline Validate handler renders pending, awaits the outcome, then commits
// ONLY if no refresh intervened (so a result from the pre-edit Feature can't
// repopulate the row after the watcher cleared it).
async function runAction(
  pendingText: string,
  outcome: () => Promise<ChecklistRow[]>,
): Promise<void> {
  const gen = generation;
  result.value = pending(pendingText);
  const rows = await outcome();
  if (gen === generation) result.value = rows;
}

const validate = (): void =>
  void runAction("Validating…", () =>
    validateFeatureOutcome(deps.specificationService, props.row.path),
  );

// WS1/C2: the merged Steps action opens the Pending Steps companion (which owns
// detect/generate + the read-only stub viewer) targeted at THIS Feature, instead
// of detecting/generating inline on the row.
const steps = (): void => deps.openPendingSteps({ kind: "feature", featurePath: props.row.path });
</script>

<template>
  <div class="e2e-test-hub-uc-detail-feature">
    <div class="e2e-test-hub-uc-detail-feature-head">
      <span class="e2e-test-hub-uc-detail-feature-name" :title="row.path">{{ row.label }}</span>
      <div class="e2e-test-hub-uc-detail-feature-actions">
        <button :aria-label="`Open ${row.label}`" @click="open">Open</button>
        <button :aria-label="`Run ${row.label}`" @click="run">Run</button>
        <button :aria-label="`Validate ${row.label}`" @click="validate">Validate</button>
        <button :aria-label="`Open pending steps for ${row.label}`" @click="steps">Steps</button>
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

<script setup lang="ts">
/**
 * One Feature's group in the Pending Steps panel (WS1/C2): progress line + bar,
 * the undefined-step rows, the Verify/Generate/Open actions, and — after a
 * generate — the read-only stub viewer highlighting the inserted ranges.
 * Dumb by design: all async work lives in the parent (App), which passes the
 * group state down and receives action events up.
 */
import { computed } from "vue";
import ChecklistRows from "../ChecklistRows.vue";
import type { ChecklistRow } from "../../views/checklist";
import type { PendingFeatureGroup } from "../../views/pending-steps-rows";
import type { StubInsertion } from "../../../application/content/step-definitions";
import type { VaultPath } from "../../../domain/value-objects/identifiers";

export interface StubViewerState {
  // Kept branded (not a bare string) so the App's "Open step file" can hand it
  // straight to workspace.openInSystemEditor(VaultPath) without re-validating.
  stepFile: VaultPath;
  /** The step file's full content, split into lines for range highlighting. */
  lines: string[];
  insertions: StubInsertion[];
}

const props = defineProps<{
  group: PendingFeatureGroup;
  busy: boolean;
  result: ChecklistRow[] | null;
  viewer: StubViewerState | null;
}>();

const emit = defineEmits<{
  verify: [];
  generate: [];
  openFile: [];
}>();

const progressPercent = computed(() =>
  props.group.totalSteps === 0
    ? 0
    : Math.round((props.group.definedSteps / props.group.totalSteps) * 100),
);

const highlighted = (line: number): boolean =>
  (props.viewer?.insertions ?? []).some(
    (entry) => line >= entry.startLine && line <= entry.endLine,
  );

const copyStub = (): void => {
  const viewer = props.viewer;
  if (viewer === null) return;
  const text = viewer.insertions
    .map((entry) => viewer.lines.slice(entry.startLine - 1, entry.endLine).join("\n"))
    .join("\n\n");
  void navigator.clipboard.writeText(text);
};
</script>

<template>
  <section class="spec-pending-feature" :data-status="group.complete ? 'ok' : 'pending'">
    <header class="spec-pending-feature-head">
      <span class="spec-pending-feature-name" :title="group.path">{{ group.label }}</span>
      <span class="spec-pending-feature-progress-text">
        {{ group.progressText }}
        <span class="spec-pending-feature-tier"
          >({{ group.tier === "bddgen" ? "verified" : "static check" }})</span
        >
      </span>
    </header>
    <div
      class="spec-pending-feature-progress"
      role="progressbar"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${group.label}: ${group.progressText}`"
    >
      <div class="spec-pending-feature-progress-fill" :style="{ width: `${progressPercent}%` }" />
    </div>

    <ul v-if="group.missing.length > 0" class="spec-pending-feature-missing">
      <li v-for="step in group.missing" :key="step">{{ step }}</li>
    </ul>
    <p v-else-if="group.complete" class="spec-pending-feature-done">Every step has a definition.</p>

    <div class="spec-pending-feature-actions">
      <button
        :disabled="busy"
        :aria-label="`Verify ${group.label} with bddgen`"
        @click="emit('verify')"
      >
        Verify
      </button>
      <button
        class="mod-cta"
        :disabled="busy || group.missing.length === 0"
        :aria-label="`Generate step stubs for ${group.label}`"
        @click="emit('generate')"
      >
        Generate stubs
      </button>
      <button
        :aria-label="`Open the step file for ${group.label} in the system editor`"
        @click="emit('openFile')"
      >
        Open step file
      </button>
    </div>

    <div class="spec-pending-feature-result" aria-live="polite">
      <ChecklistRows v-if="result" :rows="result" />
    </div>

    <details v-if="viewer" class="spec-pending-stub-viewer" open>
      <summary>
        Generated stubs in {{ viewer.stepFile }}
        <button aria-label="Copy the generated stubs" @click.prevent="copyStub">Copy</button>
      </summary>
      <pre class="spec-pending-stub-code"><code><span
        v-for="(line, i) in viewer.lines"
        :key="i"
        class="spec-pending-stub-line"
        :class="{ 'is-inserted': highlighted(i + 1) }"
      >{{ line }}
</span></code></pre>
    </details>
  </section>
</template>

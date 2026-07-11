<script setup lang="ts">
/**
 * One guided-tour checklist step (ADR-0033): a title line that expands (when the
 * step is active) into its teach line, copyable snippets, hint, and the
 * action/mark-done/skip affordances. The Vue twin of `renderTourStep`, shared by
 * the standalone Guided Tour leaf and the hub's onboarding rail so both render a
 * step IDENTICALLY (the pre-Vue reason `tour-step-body` was extracted). Each host
 * keeps its own dispatch table + tour service; this owns the per-step DOM once.
 */
import { Notice } from "obsidian";
import type { TourActionId, TourStepId } from "../../../domain/onboarding/tour-steps";
import type { TourStepRow } from "../../views/guided-tour-rows";

defineProps<{ row: TourStepRow }>();
const emit = defineEmits<{
  dispatch: [TourActionId];
  markDone: [TourStepId];
  skip: [TourStepId];
}>();

const copySnippet = (code: string): void => {
  // Promise.resolve().then keeps a synchronously-missing clipboard API on the
  // SAME failure path as a rejected write, so the manual-selection fallback
  // notice always fires (mirrors the hand-rolled tour-step-body behaviour).
  void Promise.resolve()
    .then(() => navigator.clipboard.writeText(code))
    .then(() => new Notice("Copied to clipboard."))
    .catch(() => new Notice("Could not copy — select the snippet text manually.", 10000));
};
</script>

<template>
  <div class="e2e-test-hub-tour-step" :data-status="row.status" :aria-label="row.ariaLabel">
    <div class="e2e-test-hub-tour-step-title">
      {{ row.statusIcon }} {{ row.index }}. {{ row.title }}
    </div>
    <template v-if="row.expanded">
      <div class="e2e-test-hub-tour-teach">{{ row.teach }}</div>
      <div v-for="snippet in row.snippets" :key="snippet.title" class="e2e-test-hub-tour-snippet">
        <div class="e2e-test-hub-tour-step-title">{{ snippet.title }}</div>
        <pre><code>{{ snippet.code }}</code></pre>
        <button
          :aria-label="`Copy the ${snippet.title} snippet`"
          @click="copySnippet(snippet.code)"
        >
          Copy
        </button>
      </div>
      <div v-if="row.hint" class="e2e-test-hub-tour-hint">{{ row.hint }}</div>
      <div class="e2e-test-hub-tour-actions">
        <button
          v-if="row.action"
          class="mod-cta"
          :aria-label="row.action.ariaLabel"
          @click="emit('dispatch', row.action.id)"
        >
          {{ row.action.label }}
        </button>
        <button
          v-if="row.showMarkDone"
          :aria-label="`Mark step ${row.index} done`"
          @click="emit('markDone', row.id)"
        >
          Mark done
        </button>
        <button
          v-if="row.showSkip"
          :aria-label="`Skip step ${row.index}`"
          @click="emit('skip', row.id)"
        >
          Skip
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ChecklistRow } from "../views/checklist";

/**
 * Renders the shared inline-validation checklist (ADR-0033) — the Vue twin of
 * `renderChecklist`: one `e2e-test-hub-settings-check-row` div per row, the same
 * `{icon} {text}` content and `data-status` colour contract, so every inline
 * surface keeps reading alike.
 */
defineProps<{ rows: readonly ChecklistRow[] }>();
</script>

<template>
  <div
    v-for="(row, i) in rows"
    :key="i"
    class="e2e-test-hub-settings-check-row"
    :data-status="row.status"
  >
    {{ row.icon }} {{ row.text }}
  </div>
</template>

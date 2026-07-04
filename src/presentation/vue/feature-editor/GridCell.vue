<script setup lang="ts">
/**
 * One editable `<td>` of a data-table / Examples grid (ADR-0033): a text input
 * bound to `cells[cellIndex]`, sanitised (trim) and committed on change. The Vue
 * twin of `renderGridCell` — shared by the step data-table and the Examples grid.
 * `v-model.lazy.trim` is `sanitizeCell` (trim) on the change event.
 */
import { inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";

defineProps<{
  cells: string[];
  cellIndex: number;
  rowIndex: number;
  labelPrefix: string;
}>();
const ctrl = inject(FEATURE_EDITOR)!;
</script>

<template>
  <td>
    <input
      v-model.lazy.trim="cells[cellIndex]"
      type="text"
      :aria-label="`${labelPrefix} cell ${rowIndex + 1},${cellIndex + 1}`"
      @change="ctrl.commit()"
    />
  </td>
</template>

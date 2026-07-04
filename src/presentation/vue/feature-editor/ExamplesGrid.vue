<script setup lang="ts">
/**
 * One `Examples:` block of a Scenario Outline (ADR-0033): optional name, tag
 * editor, an editable header + data grid, and add/remove row/column controls.
 * The Vue twin of `renderExamples`. Column renames fall back to the CURRENT model
 * value (never the render-time capture), so clearing the input can't revert an
 * earlier rename — the same guard the imperative handler carried.
 */
import { inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import GridCell from "./GridCell.vue";
import TagEditor from "./TagEditor.vue";
import {
  addExamplesColumn,
  addExamplesRow,
  removeExamplesColumn,
  sanitizeCell,
} from "../../views/feature-editor-format";
import type { ExamplesBlock } from "../../../domain/entities/specification";

const props = defineProps<{ blocks: ExamplesBlock[]; index: number }>();
const ctrl = inject(FEATURE_EDITOR)!;

const block = (): ExamplesBlock => props.blocks[props.index];

const renameBlock = (event: Event): void => {
  const b = block();
  const trimmed = (event.target as HTMLInputElement).value.trim();
  if (trimmed) b.name = trimmed;
  else delete b.name;
  ctrl.commit();
};
const removeBlock = (): void => {
  props.blocks.splice(props.index, 1);
  ctrl.commit();
};
const renameColumn = (columnIndex: number, event: Event): void => {
  const b = block();
  const input = event.target as HTMLInputElement;
  b.header[columnIndex] = sanitizeCell(input.value) || b.header[columnIndex];
  input.value = b.header[columnIndex];
  ctrl.commit();
};
const removeColumn = (columnIndex: number): void => {
  removeExamplesColumn(block(), columnIndex);
  ctrl.commit();
};
const removeRow = (rowIndex: number): void => {
  block().rows.splice(rowIndex, 1);
  ctrl.commit();
};
const addRow = (): void => {
  addExamplesRow(block());
  ctrl.commit();
};
const addColumn = (): void => {
  addExamplesColumn(block());
  ctrl.commit();
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor-examples">
    <div class="e2e-test-hub-feature-editor-examples-head">
      <h4>Examples</h4>
      <input
        :value="blocks[index].name ?? ''"
        type="text"
        placeholder="Examples name (optional)"
        aria-label="Examples name"
        @change="renameBlock"
      />
      <button aria-label="Delete Examples block" @click="removeBlock">Delete</button>
    </div>

    <TagEditor :tags="blocks[index].tags" label="Examples tags" />

    <table class="e2e-test-hub-feature-editor-grid">
      <tbody>
        <tr>
          <th v-for="(column, columnIndex) in blocks[index].header" :key="columnIndex">
            <input
              :value="column"
              type="text"
              :aria-label="`Column ${columnIndex + 1} name`"
              @change="renameColumn(columnIndex, $event)"
            />
            <button :aria-label="`Remove column ${column}`" @click="removeColumn(columnIndex)">
              ×
            </button>
          </th>
          <th></th>
        </tr>
        <tr v-for="(cells, rowIndex) in blocks[index].rows" :key="rowIndex">
          <GridCell
            v-for="(cell, cellIndex) in cells"
            :key="cellIndex"
            :cells="cells"
            :cell-index="cellIndex"
            :row-index="rowIndex"
            label-prefix="Examples"
          />
          <td>
            <button :aria-label="`Remove row ${rowIndex + 1}`" @click="removeRow(rowIndex)">
              ×
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <button @click="addRow">+ row</button>
    <button @click="addColumn">+ column</button>
  </div>
</template>

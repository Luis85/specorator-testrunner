<script setup lang="ts">
/**
 * The optional data-table / doc-string argument editors under one step (ADR-0033).
 * A Gherkin step carries at most ONE argument (TD-002), so the add buttons show
 * only while the step has none — the editor can't produce an unparsable
 * table+docString combination. The Vue twin of `renderStepExtras`.
 */
import { computed, inject } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import GridCell from "./GridCell.vue";
import { fenceFor, sanitizeDocStringLines } from "../../views/feature-editor-format";
import { stepDocString, stepTable, type GherkinStep } from "../../../domain/entities/specification";

const props = defineProps<{ step: GherkinStep }>();
const ctrl = inject(FEATURE_EDITOR)!;

const table = computed(() => stepTable(props.step));
const docString = computed(() => stepDocString(props.step));

// The doc string binds through a computed getter/setter: the setter splits the
// textarea, escapes fence-terminating lines (sanitizeDocStringLines), and stores
// the chosen fence — the same transform the imperative change handler ran.
const docText = computed<string>({
  get: () => docString.value?.lines.join("\n") ?? "",
  set: (value) => {
    const ds = docString.value;
    if (!ds) return;
    const lines = value.split("\n");
    const fence = fenceFor(lines);
    ds.lines = sanitizeDocStringLines(lines, fence);
    ds.fence = fence;
    ctrl.commit();
  },
});

const addTableRow = (): void => {
  const rows = table.value;
  if (!rows) return;
  rows.push((rows[0] ?? [""]).map(() => ""));
  ctrl.commit();
};
const addTableColumn = (): void => {
  const rows = table.value;
  if (!rows) return;
  for (const cells of rows) cells.push("");
  ctrl.commit();
};
const removeArgument = (): void => {
  delete props.step.argument;
  ctrl.commit();
};
const addTable = (): void => {
  props.step.argument = { kind: "table", rows: [["value"]] };
  ctrl.commit();
};
const addDoc = (): void => {
  props.step.argument = { kind: "docString", docString: { fence: '"""', lines: [""] } };
  ctrl.commit();
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor-step-extras">
    <template v-if="table">
      <table class="e2e-test-hub-feature-editor-grid">
        <tbody>
          <tr v-for="(cells, rowIndex) in table" :key="rowIndex">
            <GridCell
              v-for="(cell, cellIndex) in cells"
              :key="cellIndex"
              :cells="cells"
              :cell-index="cellIndex"
              :row-index="rowIndex"
              label-prefix="Table"
            />
          </tr>
        </tbody>
      </table>
      <button @click="addTableRow">+ row</button>
      <button @click="addTableColumn">+ column</button>
      <button @click="removeArgument">Remove table</button>
    </template>

    <template v-else-if="docString">
      <textarea
        v-model.lazy="docText"
        class="e2e-test-hub-feature-editor-docstring"
        aria-label="Doc string"
        rows="4"
      ></textarea>
      <button @click="removeArgument">Remove text block</button>
    </template>

    <template v-else>
      <button @click="addTable">+ data table</button>
      <button @click="addDoc">+ text block</button>
    </template>
  </div>
</template>

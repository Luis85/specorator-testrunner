import type { StepDefinitionPattern } from "../../application/content/step-definitions";
import type { GherkinStep } from "../../domain/entities/specification";
import { stepDocString, stepTable } from "../../domain/entities/specification";
import {
  fenceFor,
  moveItem,
  newStep,
  normalizeTag,
  sanitizeCell,
  sanitizeDocStringLines,
  stepIsImplemented,
} from "./feature-editor-format";

/** Shared autocomplete datalist ids, referenced by the step/tag inputs below. */
export const STEP_DATALIST_ID = "e2e-test-hub-step-suggestions";
export const TAG_DATALIST_ID = "e2e-test-hub-tag-suggestions";

/**
 * The two things the structured sub-renderers need from the {@link
 * FeatureEditorView} that owns them: `commit` (serialise the working spec,
 * debounce-save, re-render with focus restored) and a live read of the loaded
 * step-definition patterns (for the per-row "missing step" flag). Extracted out
 * of the view so the bulk of the DOM-building stays off the composition-root /
 * size-budgeted view class while still driving the view's single commit path.
 */
export interface StructuredEditorCtx {
  commit: () => void;
  stepPatterns: () => readonly StepDefinitionPattern[];
}

/** Tag chips + a datalist-backed input; click a chip to remove its tag. */
export const renderTagEditor = (
  ctx: StructuredEditorCtx,
  parent: HTMLElement,
  tags: string[],
  label: string,
  keyPrefix: string,
): void => {
  const wrap = parent.createDiv({ cls: "e2e-test-hub-feature-editor-tags" });
  const chips = wrap.createDiv({ cls: "e2e-test-hub-feature-editor-tag-chips" });
  const input = wrap.createEl("input", {
    type: "text",
    attr: {
      placeholder: "Add tag…",
      list: TAG_DATALIST_ID,
      "aria-label": label,
      "data-focus-key": `${keyPrefix}:tags:add`,
    },
  });
  const renderChips = (): void => {
    chips.empty();
    tags.forEach((tag, index) => {
      const chip = chips.createEl("button", {
        text: `${tag} ×`,
        cls: "e2e-test-hub-feature-editor-tag-chip",
        attr: {
          "aria-label": `Remove ${tag}`,
          "data-focus-key": `${keyPrefix}:tags:${index}:remove`,
        },
      });
      chip.addEventListener("click", () => {
        tags.splice(index, 1);
        renderChips();
        ctx.commit();
      });
    });
  };
  const addTag = (): void => {
    const tag = normalizeTag(input.value);
    input.value = "";
    if (tag === null || tags.includes(tag)) return;
    tags.push(tag);
    renderChips();
    ctx.commit();
  };
  input.addEventListener("change", addTag);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
  });
  renderChips();
};

/** The ↑/↓ pair used by scenario heads and step rows alike. */
export const appendMoveButtons = (
  ctx: StructuredEditorCtx,
  parent: HTMLElement,
  noun: string,
  array: unknown[],
  index: number,
  keyPrefix: string,
): void => {
  const up = parent.createEl("button", {
    text: "↑",
    attr: { "aria-label": `Move ${noun} up`, "data-focus-key": `${keyPrefix}:up` },
  });
  up.addEventListener("click", () => {
    if (moveItem(array, index, -1)) ctx.commit();
  });
  const down = parent.createEl("button", {
    text: "↓",
    attr: { "aria-label": `Move ${noun} down`, "data-focus-key": `${keyPrefix}:down` },
  });
  down.addEventListener("click", () => {
    if (moveItem(array, index, 1)) ctx.commit();
  });
};

export const renderStepList = (
  ctx: StructuredEditorCtx,
  parent: HTMLElement,
  steps: GherkinStep[],
  keyPrefix: string,
  onRemoved?: () => void,
): void => {
  const list = parent.createDiv({ cls: "e2e-test-hub-feature-editor-steps" });
  steps.forEach((step, index) =>
    renderStepRow(ctx, list, steps, step, index, `${keyPrefix}/step:${index}`, onRemoved),
  );
  const add = list.createEl("button", {
    text: "+ step",
    cls: "e2e-test-hub-feature-editor-add",
    attr: { "data-focus-key": `${keyPrefix}:add-step` },
  });
  add.addEventListener("click", () => {
    steps.push(newStep(steps));
    ctx.commit();
  });
};

const renderStepRow = (
  ctx: StructuredEditorCtx,
  list: HTMLElement,
  steps: GherkinStep[],
  step: GherkinStep,
  index: number,
  keyPrefix: string,
  onRemoved?: () => void,
): void => {
  const row = list.createDiv({ cls: "e2e-test-hub-feature-editor-step" });

  const keyword = row.createEl("select", {
    attr: { "aria-label": "Step keyword", "data-focus-key": `${keyPrefix}:keyword` },
  });
  for (const value of ["Given", "When", "Then", "And", "But", "*"] as const) {
    const option = keyword.createEl("option", { text: value, attr: { value } });
    option.selected = step.keyword === value;
  }
  keyword.addEventListener("change", () => {
    step.keyword = keyword.value as GherkinStep["keyword"];
    ctx.commit();
  });

  const text = row.createEl("input", {
    type: "text",
    value: step.text,
    cls: "e2e-test-hub-feature-editor-step-text",
    attr: {
      placeholder: "Step text",
      list: STEP_DATALIST_ID,
      "aria-label": "Step text",
      "data-focus-key": `${keyPrefix}:text`,
    },
  });
  const flag = row.createSpan({ cls: "e2e-test-hub-feature-editor-step-flag" });
  const refreshFlag = (): void => {
    const implemented = stepIsImplemented(step.text, ctx.stepPatterns());
    flag.setText(implemented ? "" : "!");
    flag.setAttr("title", implemented ? "" : "No step definition matches this step.");
    row.toggleClass("is-missing-step", !implemented);
  };
  refreshFlag();
  text.addEventListener("change", () => {
    step.text = text.value.trim();
    ctx.commit();
    refreshFlag();
  });

  appendMoveButtons(ctx, row, "step", steps, index, keyPrefix);
  const remove = row.createEl("button", {
    text: "×",
    attr: { "aria-label": "Delete step", "data-focus-key": `${keyPrefix}:remove` },
  });
  remove.addEventListener("click", () => {
    steps.splice(index, 1);
    onRemoved?.();
    ctx.commit();
  });

  renderStepExtras(ctx, list, step, keyPrefix);
};

/** The optional data-table / doc-string argument editors under one step. */
const renderStepExtras = (
  ctx: StructuredEditorCtx,
  parent: HTMLElement,
  step: GherkinStep,
  keyPrefix: string,
): void => {
  const extras = parent.createDiv({ cls: "e2e-test-hub-feature-editor-step-extras" });

  const table = stepTable(step);
  const docString = stepDocString(step);

  if (table) {
    const tableKey = `${keyPrefix}/table`;
    const grid = extras.createEl("table", { cls: "e2e-test-hub-feature-editor-grid" });
    table.forEach((cells, rowIndex) => {
      const tr = grid.createEl("tr");
      cells.forEach((cell, cellIndex) => {
        renderGridCell(ctx, tr, cells, cellIndex, cell, rowIndex, "Table", tableKey);
      });
    });
    const addRow = extras.createEl("button", {
      text: "+ row",
      attr: { "data-focus-key": `${tableKey}:add-row` },
    });
    addRow.addEventListener("click", () => {
      table.push((table[0] ?? [""]).map(() => ""));
      ctx.commit();
    });
    const addColumn = extras.createEl("button", {
      text: "+ column",
      attr: { "data-focus-key": `${tableKey}:add-column` },
    });
    addColumn.addEventListener("click", () => {
      for (const cells of table) cells.push("");
      ctx.commit();
    });
    const removeTable = extras.createEl("button", {
      text: "Remove table",
      attr: { "data-focus-key": `${tableKey}:remove` },
    });
    removeTable.addEventListener("click", () => {
      delete step.argument;
      ctx.commit();
    });
  }

  if (docString) {
    const textarea = extras.createEl("textarea", {
      cls: "e2e-test-hub-feature-editor-docstring",
      attr: { "aria-label": "Doc string", rows: "4", "data-focus-key": `${keyPrefix}:doc-text` },
    });
    textarea.value = docString.lines.join("\n");
    textarea.addEventListener("change", () => {
      const lines = textarea.value.split("\n");
      const fence = fenceFor(lines);
      docString.lines = sanitizeDocStringLines(lines, fence);
      docString.fence = fence;
      textarea.value = docString.lines.join("\n"); // reflect escaped delimiter lines
      ctx.commit();
    });
    const removeDoc = extras.createEl("button", {
      text: "Remove text block",
      attr: { "data-focus-key": `${keyPrefix}:doc-remove` },
    });
    removeDoc.addEventListener("click", () => {
      delete step.argument;
      ctx.commit();
    });
  }

  // A Gherkin step carries at most ONE argument (TD-002): the add buttons
  // render only while the step has no argument, so the editor cannot produce
  // a table + doc string combination the Gherkin parser would refuse to parse.
  if (step.argument === undefined) {
    const addTable = extras.createEl("button", {
      text: "+ data table",
      attr: { "data-focus-key": `${keyPrefix}:add-table` },
    });
    addTable.addEventListener("click", () => {
      step.argument = { kind: "table", rows: [["value"]] };
      ctx.commit();
    });
    const addDoc = extras.createEl("button", {
      text: "+ text block",
      attr: { "data-focus-key": `${keyPrefix}:add-doc` },
    });
    addDoc.addEventListener("click", () => {
      step.argument = { kind: "docString", docString: { fence: '"""', lines: [""] } };
      ctx.commit();
    });
  }
};

/**
 * One editable `<td>` of a data-table / Examples grid: a text input seeded
 * with `cell`, labelled `<labelPrefix> cell r,c`, focus-keyed under
 * `focusKeyBase`, that sanitises and commits the row back on change. Shared by
 * the step data-table and the scenario-outline Examples grids.
 */
export const renderGridCell = (
  ctx: StructuredEditorCtx,
  tr: HTMLElement,
  cells: string[],
  cellIndex: number,
  cell: string,
  rowIndex: number,
  labelPrefix: string,
  focusKeyBase: string,
): void => {
  const td = tr.createEl("td");
  const input = td.createEl("input", {
    type: "text",
    value: cell,
    attr: {
      "aria-label": `${labelPrefix} cell ${rowIndex + 1},${cellIndex + 1}`,
      "data-focus-key": `${focusKeyBase}:${rowIndex}:${cellIndex}`,
    },
  });
  input.addEventListener("change", () => {
    cells[cellIndex] = sanitizeCell(input.value);
    input.value = cells[cellIndex];
    ctx.commit();
  });
};

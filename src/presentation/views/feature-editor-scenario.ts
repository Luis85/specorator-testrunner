import type {
  ExamplesBlock,
  FeatureSpecification,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import { isScenarioOutline } from "../../domain/entities/specification";
import {
  addExamplesColumn,
  addExamplesRow,
  newExamplesBlock,
  removeExamplesColumn,
  sanitizeCell,
} from "./feature-editor-format";
import {
  appendMoveButtons,
  renderGridCell,
  renderStepList,
  renderTagEditor,
  type StructuredEditorCtx,
} from "./feature-editor-structured";

/**
 * The per-scenario card + its scenario-outline Examples grids — the larger half
 * of the Feature Editor's structured sub-renderers, split out of
 * feature-editor-structured.ts to keep both files under the size budget. Calls
 * the leaf renderers (tag editor, step list, move buttons, grid cell) the
 * companion module owns; DOM-building only.
 */
export const renderScenarioCard = (
  ctx: StructuredEditorCtx,
  parent: HTMLElement,
  spec: FeatureSpecification,
  scenario: ScenarioSpecification,
  index: number,
): void => {
  const owner = `scenario:${index}`;
  const card = parent.createDiv({ cls: "e2e-test-hub-feature-editor-card" });
  const head = card.createDiv({ cls: "e2e-test-hub-feature-editor-scenario-head" });

  const keyword = head.createEl("select", {
    attr: { "aria-label": "Scenario type", "data-focus-key": `${owner}:keyword` },
  });
  for (const value of ["Scenario", "Scenario Outline"] as const) {
    const option = keyword.createEl("option", { text: value, attr: { value } });
    option.selected = (scenario.keyword ?? "Scenario") === value;
  }
  keyword.addEventListener("change", () => {
    if (keyword.value === "Scenario Outline") {
      scenario.keyword = "Scenario Outline";
      scenario.examples ??= [newExamplesBlock()];
    } else {
      // A plain Scenario cannot carry Examples; switching back drops them
      // (Obsidian's File Recovery snapshots are the undo path).
      delete scenario.keyword;
      delete scenario.examples;
    }
    ctx.commit();
  });

  const name = head.createEl("input", {
    type: "text",
    value: scenario.name,
    attr: {
      placeholder: "Scenario name",
      "aria-label": "Scenario name",
      "data-focus-key": `${owner}:name`,
    },
  });
  name.addEventListener("change", () => {
    scenario.name = name.value.trim();
    ctx.commit();
  });

  appendMoveButtons(ctx, head, "scenario", spec.scenarios, index, owner);
  const remove = head.createEl("button", {
    text: "Delete",
    attr: { "aria-label": "Delete scenario", "data-focus-key": `${owner}:remove` },
  });
  remove.addEventListener("click", () => {
    spec.scenarios.splice(index, 1);
    ctx.commit();
  });

  renderTagEditor(ctx, card, scenario.tags, "Scenario tags", owner);
  renderStepList(ctx, card, scenario.steps, owner);
  renderScenarioExamples(ctx, card, scenario, owner);
};

/** The Examples blocks + "add block" button shown only for a Scenario Outline. */
const renderScenarioExamples = (
  ctx: StructuredEditorCtx,
  card: HTMLElement,
  scenario: ScenarioSpecification,
  owner: string,
): void => {
  if (!isScenarioOutline(scenario)) return;
  const blocks = (scenario.examples ??= []);
  blocks.forEach((block, blockIndex) =>
    renderExamples(ctx, card, blocks, block, blockIndex, owner),
  );
  const addBlock = card.createEl("button", {
    text: "+ Examples block",
    attr: { "data-focus-key": `${owner}:add-examples` },
  });
  addBlock.addEventListener("click", () => {
    blocks.push(newExamplesBlock());
    ctx.commit();
  });
};

const renderExamples = (
  ctx: StructuredEditorCtx,
  parent: HTMLElement,
  blocks: ExamplesBlock[],
  block: ExamplesBlock,
  blockIndex: number,
  keyPrefix: string,
): void => {
  const blockKey = `${keyPrefix}/examples:${blockIndex}`;
  const wrap = parent.createDiv({ cls: "e2e-test-hub-feature-editor-examples" });
  const head = wrap.createDiv({ cls: "e2e-test-hub-feature-editor-examples-head" });
  head.createEl("h4", { text: "Examples" });
  const name = head.createEl("input", {
    type: "text",
    value: block.name ?? "",
    attr: {
      placeholder: "Examples name (optional)",
      "aria-label": "Examples name",
      "data-focus-key": `${blockKey}:name`,
    },
  });
  name.addEventListener("change", () => {
    const trimmed = name.value.trim();
    if (trimmed) block.name = trimmed;
    else delete block.name;
    ctx.commit();
  });
  const remove = head.createEl("button", {
    text: "Delete",
    attr: { "aria-label": "Delete Examples block", "data-focus-key": `${blockKey}:remove` },
  });
  remove.addEventListener("click", () => {
    blocks.splice(blockIndex, 1);
    ctx.commit();
  });

  renderTagEditor(ctx, wrap, block.tags, "Examples tags", blockKey);

  const grid = wrap.createEl("table", { cls: "e2e-test-hub-feature-editor-grid" });
  const headerRow = grid.createEl("tr");
  block.header.forEach((column, columnIndex) => {
    const th = headerRow.createEl("th");
    const input = th.createEl("input", {
      type: "text",
      value: column,
      attr: {
        "aria-label": `Column ${columnIndex + 1} name`,
        "data-focus-key": `${blockKey}/head:${columnIndex}`,
      },
    });
    input.addEventListener("change", () => {
      // Fall back to the CURRENT model value, not the render-time capture,
      // so clearing the input cannot revert an earlier rename.
      block.header[columnIndex] = sanitizeCell(input.value) || block.header[columnIndex];
      input.value = block.header[columnIndex];
      ctx.commit();
    });
    const removeColumn = th.createEl("button", {
      text: "×",
      attr: {
        "aria-label": `Remove column ${column}`,
        "data-focus-key": `${blockKey}/head:${columnIndex}:remove`,
      },
    });
    removeColumn.addEventListener("click", () => {
      removeExamplesColumn(block, columnIndex);
      ctx.commit();
    });
  });
  headerRow.createEl("th"); // actions column
  block.rows.forEach((cells, rowIndex) => {
    const tr = grid.createEl("tr");
    cells.forEach((cell, cellIndex) => {
      renderGridCell(ctx, tr, cells, cellIndex, cell, rowIndex, "Examples", `${blockKey}/cell`);
    });
    const actions = tr.createEl("td");
    const removeRow = actions.createEl("button", {
      text: "×",
      attr: {
        "aria-label": `Remove row ${rowIndex + 1}`,
        "data-focus-key": `${blockKey}/cell:${rowIndex}:remove`,
      },
    });
    removeRow.addEventListener("click", () => {
      block.rows.splice(rowIndex, 1);
      ctx.commit();
    });
  });
  const addRow = wrap.createEl("button", {
    text: "+ row",
    attr: { "data-focus-key": `${blockKey}:add-row` },
  });
  addRow.addEventListener("click", () => {
    addExamplesRow(block);
    ctx.commit();
  });
  const addColumn = wrap.createEl("button", {
    text: "+ column",
    attr: { "data-focus-key": `${blockKey}:add-column` },
  });
  addColumn.addEventListener("click", () => {
    addExamplesColumn(block);
    ctx.commit();
  });
};

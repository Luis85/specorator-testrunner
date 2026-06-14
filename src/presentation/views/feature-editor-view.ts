import { Notice, TextFileView, type WorkspaceLeaf } from "obsidian";

import {
  parseFeature,
  roundTripsLosslessly,
  serialiseFeature,
} from "../../application/content/gherkin";
import type { StepDefinitionPattern } from "../../application/content/step-definitions";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SpecificationService } from "../../application/services/specification-service";
import type {
  ExamplesBlock,
  FeatureSpecification,
  GherkinStep,
  ScenarioSpecification,
} from "../../domain/entities/specification";
import { isScenarioOutline, stepDocString, stepTable } from "../../domain/entities/specification";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { captureFocus, restoreFocus } from "./focus-restore";
import {
  addExamplesColumn,
  addExamplesRow,
  asDescriptionLines,
  fenceFor,
  moveItem,
  newExamplesBlock,
  newScenario,
  newStep,
  normalizeTag,
  projectValidation,
  removeExamplesColumn,
  sanitizeCell,
  sanitizeDocStringLines,
  stepIsImplemented,
  stepSuggestions,
} from "./feature-editor-format";

export const FEATURE_EDITOR_VIEW_TYPE = "e2e-test-hub-feature-editor";

const STEP_DATALIST_ID = "e2e-test-hub-step-suggestions";
const TAG_DATALIST_ID = "e2e-test-hub-tag-suggestions";

export interface FeatureEditorDeps {
  specifications: Pick<SpecificationService, "announceUpdated" | "listStepPatterns">;
  featureInsight: Pick<FeatureInsightService, "listKnownTags">;
}

/**
 * Structured editor for `.feature` files — the registered file handler for
 * the extension. The RAW TEXT is the single source of truth (`this.data`,
 * TextFileView's load/save lifecycle); structured mode is a projection that
 * mutates an in-memory FeatureSpecification, re-serialises on every committed
 * edit, and debounce-saves via requestSave(). Files the extended parser
 * cannot reproduce losslessly (comments, Rule: blocks, exotic spacing) open
 * in raw-text mode behind roundTripsLosslessly — the structured editor can
 * never destroy content it does not model.
 */
export class FeatureEditorView extends TextFileView {
  private mode: "structured" | "raw" = "structured";
  private specification: FeatureSpecification | null = null;
  private stepPatterns: StepDefinitionPattern[] = [];
  private knownTags: string[] = [];
  private validationEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: FeatureEditorDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return FEATURE_EDITOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Feature";
  }

  getIcon(): string {
    return "file-code";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "feature";
  }

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    // Re-project on every load — an external change (sync, git) must rebuild
    // the structured UI rather than leave a stale in-memory spec.
    this.specification = this.project();
    if (this.specification === null) this.mode = "raw";
    this.render();
  }

  clear(): void {
    this.data = "";
    this.specification = null;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    // Authoring aids load once per view; they degrade silently on failure
    // (no suggestions, no flags) and never block editing.
    void this.loadAids();
  }

  /** Announce the save so dashboards/explorers refresh (spec Part 4). */
  async save(clear = false): Promise<void> {
    await super.save(clear);
    if (!this.file) return;
    const parsed = parseFeature(this.data, unsafeVaultPath(this.file.path));
    if (parsed !== null) await this.deps.specifications.announceUpdated(parsed);
  }

  // --- projection ----------------------------------------------------------

  /** The spec to edit, or null when the file can't be projected losslessly. */
  private project(): FeatureSpecification | null {
    if (!this.file) return null;
    const path = unsafeVaultPath(this.file.path);
    if (!roundTripsLosslessly(this.data, path)) return null;
    return parseFeature(this.data, path);
  }

  /**
   * Serialises the working spec, schedules a debounced save, and re-renders.
   * Re-rendering is always safe (TD-004): focus/caret are captured by
   * `data-focus-key` and restored after the rebuild, so call sites no longer
   * classify their change as structural vs field-level.
   */
  private commit(): void {
    if (!this.specification) return;
    this.data = serialiseFeature(this.specification);
    this.requestSave();
    // `activeDocument` (not the global `document`) keeps focus capture correct
    // when the editor is torn out into an Obsidian popout window.
    const snapshot = captureFocus(this.contentEl, activeDocument.activeElement);
    this.render();
    restoreFocus(this.contentEl, snapshot);
  }

  private async loadAids(): Promise<void> {
    const [patterns, tags] = await Promise.all([
      this.deps.specifications.listStepPatterns(),
      this.deps.featureInsight.listKnownTags(),
    ]);
    if (patterns.ok) this.stepPatterns = patterns.value;
    if (tags.ok) this.knownTags = tags.value;
    // A full render would rebuild every input from the model, discarding any
    // focused-but-uncommitted edit (fields commit on change/blur). When the
    // user is already typing, fill the datalists in place instead — the
    // missing-step flags re-evaluate per row on the next change anyway.
    if (this.contentEl.querySelector("input:focus, textarea:focus, select:focus") === null) {
      this.render();
      return;
    }
    this.populateDatalists();
  }

  /** (Re)fills the shared autocomplete datalists without touching the DOM around them. */
  private populateDatalists(): void {
    const stepList = this.contentEl.querySelector<HTMLElement>(`#${STEP_DATALIST_ID}`);
    if (stepList) {
      stepList.empty();
      for (const suggestion of stepSuggestions(this.stepPatterns)) {
        stepList.createEl("option", { attr: { value: suggestion } });
      }
    }
    const tagList = this.contentEl.querySelector<HTMLElement>(`#${TAG_DATALIST_ID}`);
    if (tagList) {
      tagList.empty();
      for (const tag of this.knownTags) tagList.createEl("option", { attr: { value: tag } });
    }
  }

  // --- rendering -----------------------------------------------------------

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("e2e-test-hub-feature-editor");
    this.renderToolbar(root);
    if (this.mode === "structured" && this.specification !== null) {
      this.renderStructured(root, this.specification);
    } else {
      this.renderRaw(root);
    }
  }

  private renderToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "e2e-test-hub-feature-editor-toolbar" });
    const structuredActive = this.mode === "structured" && this.specification !== null;
    const make = (label: string, action: string, active: boolean): HTMLButtonElement =>
      bar.createEl("button", {
        text: label,
        ...(active ? { cls: "mod-cta" } : {}),
        attr: { "aria-pressed": String(active), "data-focus-key": `toolbar:${action}` },
      });
    make("Structured", "structured", structuredActive).addEventListener("click", () => {
      const spec = this.project();
      if (spec === null) {
        new Notice(
          "This file contains Gherkin the structured editor can't preserve " +
            "(e.g. comments or Rule: blocks); keep editing it as raw text.",
          8000,
        );
        return;
      }
      this.specification = spec;
      this.mode = "structured";
      this.render();
    });
    make("Raw text", "raw", !structuredActive).addEventListener("click", () => {
      this.mode = "raw";
      this.render();
    });
  }

  private renderRaw(root: HTMLElement): void {
    if (this.specification === null && this.data.trim() !== "") {
      root.createDiv({
        cls: "e2e-test-hub-feature-editor-banner",
        text:
          "Structured editing is unavailable: the file is not a parseable Feature " +
          "or contains constructs the editor can't preserve (comments, Rule: blocks).",
      });
    }
    const textarea = root.createEl("textarea", {
      cls: "e2e-test-hub-feature-editor-raw",
      attr: { "aria-label": "Raw Gherkin" },
    });
    textarea.value = this.data;
    textarea.addEventListener("input", () => {
      this.data = textarea.value;
      // Keep the projection in sync so the Structured toggle and the banner
      // state stay truthful (features are small; per-keystroke parse is cheap).
      this.specification = this.project();
      this.requestSave();
    });
  }

  private renderStructured(root: HTMLElement, spec: FeatureSpecification): void {
    const body = root.createDiv({ cls: "e2e-test-hub-feature-editor-body" });

    // Native datalist autocomplete shared by the step/tag inputs.
    body.createEl("datalist", { attr: { id: STEP_DATALIST_ID } });
    body.createEl("datalist", { attr: { id: TAG_DATALIST_ID } });
    this.populateDatalists();

    this.validationEl = body.createDiv({
      cls: "e2e-test-hub-feature-editor-validation",
      attr: { "aria-live": "polite" },
    });
    this.refreshValidation();

    // Feature header card.
    const header = body.createDiv({ cls: "e2e-test-hub-feature-editor-card" });
    const name = header.createEl("input", {
      type: "text",
      value: spec.featureName,
      cls: "e2e-test-hub-feature-editor-name",
      attr: {
        placeholder: "Feature name",
        "aria-label": "Feature name",
        "data-focus-key": "feature:name",
      },
    });
    name.addEventListener("change", () => {
      spec.featureName = name.value.trim();
      this.commit();
    });
    this.renderTagEditor(header, spec.tags, "Feature tags", "feature");
    const description = header.createEl("textarea", {
      cls: "e2e-test-hub-feature-editor-description",
      attr: {
        placeholder: "Description (optional)",
        "aria-label": "Feature description",
        rows: "2",
        "data-focus-key": "feature:description",
      },
    });
    description.value = (spec.description ?? []).join("\n");
    description.addEventListener("change", () => {
      const lines = asDescriptionLines(description.value);
      if (lines.length > 0) spec.description = lines;
      else delete spec.description;
      description.value = lines.join("\n"); // reflect dropped non-description lines
      this.commit();
    });

    // Background.
    const backgroundCard = body.createDiv({ cls: "e2e-test-hub-feature-editor-card" });
    backgroundCard.createEl("h3", { text: "Background" });
    if (spec.background) {
      const steps = spec.background;
      this.renderStepList(backgroundCard, steps, "background", () => {
        // Serialisation omits an empty Background; drop it from the model too.
        if (steps.length === 0) delete spec.background;
      });
    } else {
      const add = backgroundCard.createEl("button", {
        text: "+ Background",
        attr: { "data-focus-key": "background:add" },
      });
      add.addEventListener("click", () => {
        spec.background = [newStep([])];
        this.commit();
      });
    }

    // Scenarios.
    spec.scenarios.forEach((scenario, index) => {
      this.renderScenarioCard(body, spec, scenario, index);
    });
    const addScenario = body.createEl("button", {
      text: "+ Scenario",
      cls: "e2e-test-hub-feature-editor-add",
      attr: { "data-focus-key": "feature:add-scenario" },
    });
    addScenario.addEventListener("click", () => {
      spec.scenarios.push(newScenario());
      this.commit();
    });
  }

  /** The ✓/✗/! strip, re-projected from the in-memory spec on every commit. */
  private refreshValidation(): void {
    if (!this.validationEl || !this.specification) return;
    this.validationEl.empty();
    const items = projectValidation(this.specification);
    const entries =
      items.length === 0 ? [{ level: "ok", message: "Feature is structurally valid." }] : items;
    for (const item of entries) {
      const symbol = item.level === "error" ? "✗" : item.level === "warning" ? "!" : "✓";
      this.validationEl.createDiv({
        cls: "e2e-test-hub-feature-editor-check",
        attr: { "data-level": item.level },
        text: `${symbol} ${item.message}`,
      });
    }
  }

  /** Tag chips + a datalist-backed input; click a chip to remove its tag. */
  private renderTagEditor(
    parent: HTMLElement,
    tags: string[],
    label: string,
    keyPrefix: string,
  ): void {
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
          this.commit();
        });
      });
    };
    const addTag = (): void => {
      const tag = normalizeTag(input.value);
      input.value = "";
      if (tag === null || tags.includes(tag)) return;
      tags.push(tag);
      renderChips();
      this.commit();
    };
    input.addEventListener("change", addTag);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTag();
      }
    });
    renderChips();
  }

  /** The ↑/↓ pair used by scenario heads and step rows alike. */
  private appendMoveButtons(
    parent: HTMLElement,
    noun: string,
    array: unknown[],
    index: number,
    keyPrefix: string,
  ): void {
    const up = parent.createEl("button", {
      text: "↑",
      attr: { "aria-label": `Move ${noun} up`, "data-focus-key": `${keyPrefix}:up` },
    });
    up.addEventListener("click", () => {
      if (moveItem(array, index, -1)) this.commit();
    });
    const down = parent.createEl("button", {
      text: "↓",
      attr: { "aria-label": `Move ${noun} down`, "data-focus-key": `${keyPrefix}:down` },
    });
    down.addEventListener("click", () => {
      if (moveItem(array, index, 1)) this.commit();
    });
  }

  private renderScenarioCard(
    parent: HTMLElement,
    spec: FeatureSpecification,
    scenario: ScenarioSpecification,
    index: number,
  ): void {
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
      this.commit();
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
      this.commit();
    });

    this.appendMoveButtons(head, "scenario", spec.scenarios, index, owner);
    const remove = head.createEl("button", {
      text: "Delete",
      attr: { "aria-label": "Delete scenario", "data-focus-key": `${owner}:remove` },
    });
    remove.addEventListener("click", () => {
      spec.scenarios.splice(index, 1);
      this.commit();
    });

    this.renderTagEditor(card, scenario.tags, "Scenario tags", owner);
    this.renderStepList(card, scenario.steps, owner);

    if (isScenarioOutline(scenario)) {
      const blocks = (scenario.examples ??= []);
      blocks.forEach((block, blockIndex) =>
        this.renderExamples(card, blocks, block, blockIndex, owner),
      );
      const addBlock = card.createEl("button", {
        text: "+ Examples block",
        attr: { "data-focus-key": `${owner}:add-examples` },
      });
      addBlock.addEventListener("click", () => {
        blocks.push(newExamplesBlock());
        this.commit();
      });
    }
  }

  private renderStepList(
    parent: HTMLElement,
    steps: GherkinStep[],
    keyPrefix: string,
    onRemoved?: () => void,
  ): void {
    const list = parent.createDiv({ cls: "e2e-test-hub-feature-editor-steps" });
    steps.forEach((step, index) =>
      this.renderStepRow(list, steps, step, index, `${keyPrefix}/step:${index}`, onRemoved),
    );
    const add = list.createEl("button", {
      text: "+ step",
      cls: "e2e-test-hub-feature-editor-add",
      attr: { "data-focus-key": `${keyPrefix}:add-step` },
    });
    add.addEventListener("click", () => {
      steps.push(newStep(steps));
      this.commit();
    });
  }

  private renderStepRow(
    list: HTMLElement,
    steps: GherkinStep[],
    step: GherkinStep,
    index: number,
    keyPrefix: string,
    onRemoved?: () => void,
  ): void {
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
      this.commit();
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
      const implemented = stepIsImplemented(step.text, this.stepPatterns);
      flag.setText(implemented ? "" : "!");
      flag.setAttr("title", implemented ? "" : "No step definition matches this step.");
      row.toggleClass("is-missing-step", !implemented);
    };
    refreshFlag();
    text.addEventListener("change", () => {
      step.text = text.value.trim();
      this.commit();
      refreshFlag();
    });

    this.appendMoveButtons(row, "step", steps, index, keyPrefix);
    const remove = row.createEl("button", {
      text: "×",
      attr: { "aria-label": "Delete step", "data-focus-key": `${keyPrefix}:remove` },
    });
    remove.addEventListener("click", () => {
      steps.splice(index, 1);
      onRemoved?.();
      this.commit();
    });

    this.renderStepExtras(list, step, keyPrefix);
  }

  /** The optional data-table / doc-string argument editors under one step. */
  private renderStepExtras(parent: HTMLElement, step: GherkinStep, keyPrefix: string): void {
    const extras = parent.createDiv({ cls: "e2e-test-hub-feature-editor-step-extras" });

    const table = stepTable(step);
    const docString = stepDocString(step);

    if (table) {
      const tableKey = `${keyPrefix}/table`;
      const grid = extras.createEl("table", { cls: "e2e-test-hub-feature-editor-grid" });
      table.forEach((cells, rowIndex) => {
        const tr = grid.createEl("tr");
        cells.forEach((cell, cellIndex) => {
          this.renderGridCell(tr, cells, cellIndex, cell, rowIndex, "Table", tableKey);
        });
      });
      const addRow = extras.createEl("button", {
        text: "+ row",
        attr: { "data-focus-key": `${tableKey}:add-row` },
      });
      addRow.addEventListener("click", () => {
        table.push((table[0] ?? [""]).map(() => ""));
        this.commit();
      });
      const addColumn = extras.createEl("button", {
        text: "+ column",
        attr: { "data-focus-key": `${tableKey}:add-column` },
      });
      addColumn.addEventListener("click", () => {
        for (const cells of table) cells.push("");
        this.commit();
      });
      const removeTable = extras.createEl("button", {
        text: "Remove table",
        attr: { "data-focus-key": `${tableKey}:remove` },
      });
      removeTable.addEventListener("click", () => {
        delete step.argument;
        this.commit();
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
        this.commit();
      });
      const removeDoc = extras.createEl("button", {
        text: "Remove text block",
        attr: { "data-focus-key": `${keyPrefix}:doc-remove` },
      });
      removeDoc.addEventListener("click", () => {
        delete step.argument;
        this.commit();
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
        this.commit();
      });
      const addDoc = extras.createEl("button", {
        text: "+ text block",
        attr: { "data-focus-key": `${keyPrefix}:add-doc` },
      });
      addDoc.addEventListener("click", () => {
        step.argument = { kind: "docString", docString: { fence: '"""', lines: [""] } };
        this.commit();
      });
    }
  }

  /**
   * One editable `<td>` of a data-table / Examples grid: a text input seeded
   * with `cell`, labelled `<labelPrefix> cell r,c`, focus-keyed under
   * `focusKeyBase`, that sanitises and commits the row back on change. Shared by
   * the step data-table and the scenario-outline Examples grids.
   */
  private renderGridCell(
    tr: HTMLElement,
    cells: string[],
    cellIndex: number,
    cell: string,
    rowIndex: number,
    labelPrefix: string,
    focusKeyBase: string,
  ): void {
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
      this.commit();
    });
  }

  private renderExamples(
    parent: HTMLElement,
    blocks: ExamplesBlock[],
    block: ExamplesBlock,
    blockIndex: number,
    keyPrefix: string,
  ): void {
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
      this.commit();
    });
    const remove = head.createEl("button", {
      text: "Delete",
      attr: { "aria-label": "Delete Examples block", "data-focus-key": `${blockKey}:remove` },
    });
    remove.addEventListener("click", () => {
      blocks.splice(blockIndex, 1);
      this.commit();
    });

    this.renderTagEditor(wrap, block.tags, "Examples tags", blockKey);

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
        this.commit();
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
        this.commit();
      });
    });
    headerRow.createEl("th"); // actions column
    block.rows.forEach((cells, rowIndex) => {
      const tr = grid.createEl("tr");
      cells.forEach((cell, cellIndex) => {
        this.renderGridCell(tr, cells, cellIndex, cell, rowIndex, "Examples", `${blockKey}/cell`);
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
        this.commit();
      });
    });
    const addRow = wrap.createEl("button", {
      text: "+ row",
      attr: { "data-focus-key": `${blockKey}:add-row` },
    });
    addRow.addEventListener("click", () => {
      addExamplesRow(block);
      this.commit();
    });
    const addColumn = wrap.createEl("button", {
      text: "+ column",
      attr: { "data-focus-key": `${blockKey}:add-column` },
    });
    addColumn.addEventListener("click", () => {
      addExamplesColumn(block);
      this.commit();
    });
  }
}

import { Notice, TextFileView, type WorkspaceLeaf } from "obsidian";

import {
  parseFeature,
  roundTripsLosslessly,
  serialiseFeature,
} from "../../application/content/gherkin";
import type { StepDefinitionPattern } from "../../application/content/step-definitions";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SpecificationService } from "../../application/services/specification-service";
import type { FeatureSpecification } from "../../domain/entities/specification";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { captureFocus, restoreFocus } from "./focus-restore";
import {
  asDescriptionLines,
  newScenario,
  newStep,
  stepSuggestions,
  validationDisplayEntries,
} from "./feature-editor-format";
import {
  renderStepList,
  renderTagEditor,
  STEP_DATALIST_ID,
  TAG_DATALIST_ID,
  type StructuredEditorCtx,
} from "./feature-editor-structured";
import { renderScenarioCard } from "./feature-editor-scenario";

export const FEATURE_EDITOR_VIEW_TYPE = "e2e-test-hub-feature-editor";

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
 *
 * The scenario/step/examples sub-renderers live in feature-editor-structured.ts
 * (size budget); they drive this view through {@link structuredCtx}.
 */
export class FeatureEditorView extends TextFileView {
  private mode: "structured" | "raw" = "structured";
  private specification: FeatureSpecification | null = null;
  /** Scenario names as last loaded from disk — the rename-advisory baseline (US-056). */
  private baselineScenarioNames: string[] | null = null;
  private stepPatterns: StepDefinitionPattern[] = [];
  private knownTags: string[] = [];
  private validationEl: HTMLElement | null = null;
  // Handed to the extracted structured sub-renderers so they drive this view's
  // single commit path (serialise → debounce-save → re-render) and read the
  // live step-definition patterns for the per-row "missing step" flag.
  private readonly structuredCtx: StructuredEditorCtx = {
    commit: () => this.commit(),
    stepPatterns: () => this.stepPatterns,
  };

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
    this.baselineScenarioNames = this.specification
      ? this.specification.scenarios.map((scenario) => scenario.name)
      : null;
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
    this.stepPatterns = patterns;
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
    this.fillDatalist(STEP_DATALIST_ID, stepSuggestions(this.stepPatterns));
    this.fillDatalist(TAG_DATALIST_ID, this.knownTags);
  }

  /** Replaces one datalist's `<option>`s in place; a no-op if it isn't mounted. */
  private fillDatalist(id: string, values: readonly string[]): void {
    const list = this.contentEl.querySelector<HTMLElement>(`#${id}`);
    if (!list) return;
    list.empty();
    for (const value of values) list.createEl("option", { attr: { value } });
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
    renderTagEditor(this.structuredCtx, header, spec.tags, "Feature tags", "feature");
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
      renderStepList(this.structuredCtx, backgroundCard, steps, "background", () => {
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
      renderScenarioCard(this.structuredCtx, body, spec, scenario, index);
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
    for (const item of validationDisplayEntries(this.specification, this.baselineScenarioNames)) {
      this.validationEl.createDiv({
        cls: "e2e-test-hub-feature-editor-check",
        attr: { "data-level": item.level },
        text: `${item.symbol} ${item.message}`,
      });
    }
  }
}

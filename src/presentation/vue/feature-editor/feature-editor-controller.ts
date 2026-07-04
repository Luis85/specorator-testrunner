import { type InjectionKey, ref, shallowRef, toRaw, type Ref } from "vue";
import { Notice } from "obsidian";
import {
  parseFeature,
  roundTripsLosslessly,
  serialiseFeature,
} from "../../../application/content/gherkin";
import type { StepDefinitionPattern } from "../../../application/content/step-definitions";
import type { FeatureInsightService } from "../../../application/services/feature-insight-service";
import type { SpecificationService } from "../../../application/services/specification-service";
import type { FeatureSpecification } from "../../../domain/entities/specification";
import type { VaultPath } from "../../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../../domain/value-objects/vault-path";
import type { RunLauncher } from "../../run/run-launcher";
import { checklistRow, type ChecklistRow } from "../../views/checklist";
import { validateFeatureOutcome } from "../../views/use-case-detail-rows";

/** The services the Feature Editor drives (unchanged from the imperative view). */
export interface FeatureEditorDeps {
  specifications: Pick<SpecificationService, "announceUpdated" | "listStepPatterns" | "validate">;
  featureInsight: Pick<FeatureInsightService, "listKnownTags">;
  // WS-C1: ▶ Run launches a Feature-scoped run through the SAME shared launcher.
  runLauncher: Pick<RunLauncher, "launch">;
}

/** The TextFileView hooks the controller calls back into (its data/save lifecycle). */
export interface FeatureEditorHooks {
  /** Schedule a debounced write of the current `data` (TextFileView.requestSave). */
  requestSave: () => void;
  /** Flush the write immediately, then announce the update (the view's save()). */
  save: () => Promise<void>;
  /** The open file's vault path, or null when none is open. */
  filePath: () => string | null;
}

/**
 * The reactive core of the Vue Feature Editor (ADR-0033 Phase 4). The RAW TEXT
 * (`data`) stays the single source of truth — the TextFileView's load/save
 * lifecycle reads/writes it; structured mode is a reactive projection (`spec`)
 * the editor mutates in place, re-serialising to `data` on every committed edit.
 *
 * The pivotal difference from the imperative view: the structured UI binds to the
 * REACTIVE spec (v-model), so a committed edit updates `data` for saving WITHOUT
 * re-projecting or re-rendering the inputs — Vue preserves the DOM and the caret.
 * The whole focus-capture/restore machinery (data-focus-key) is gone.
 */
export interface FeatureEditorController {
  /** The raw `.feature` text — the source of truth the view saves. */
  data: Ref<string>;
  /** The structured projection, or null when the file can't round-trip losslessly. */
  spec: Ref<FeatureSpecification | null>;
  mode: Ref<"structured" | "raw">;
  /** Scenario names as last loaded — the rename-advisory baseline (US-056). */
  baselineScenarioNames: Ref<string[] | null>;
  stepPatterns: Ref<StepDefinitionPattern[]>;
  knownTags: Ref<string[]>;
  /** The inline ✓ Validate result, or null when it has not been run / was cleared. */
  validateResult: Ref<ChecklistRow[] | null>;
  deps: FeatureEditorDeps;

  /** Load path (TextFileView.setViewData): re-project and reset the baseline. */
  setData(next: string): void;
  /** Raw-mode edit: update the text, keep the projection truthful, request a save. */
  onRawInput(value: string): void;
  /** A committed structured edit: re-serialise the spec into `data` and save. */
  commit(): void;
  /** Toolbar: switch to structured mode (Notice + stay raw when unparseable). */
  toStructured(): void;
  /** Toolbar: switch to raw-text mode. */
  toRaw(): void;
  /** Load the autocomplete aids (step patterns + known tags); degrade silently. */
  loadAids(): Promise<void>;
  /** Toolbar ▶ Run: flush the save first, then launch a Feature-scoped run. */
  runFeature(): Promise<void>;
  /** Toolbar ✓ Validate: flush the save, then render the outcome inline. */
  validateFeature(): Promise<void>;
}

export const FEATURE_EDITOR = Symbol("feature-editor") as InjectionKey<FeatureEditorController>;

const scenarioNames = (spec: FeatureSpecification | null): string[] | null =>
  spec === null ? null : spec.scenarios.map((scenario) => scenario.name);

export function createFeatureEditorController(
  deps: FeatureEditorDeps,
  hooks: FeatureEditorHooks,
): FeatureEditorController {
  const data = ref("");
  // A DEEP ref: the structured editor mutates the spec's nested fields/arrays in
  // place (v-model on a step's text, splice a scenario), and those must be
  // reactive so the UI + serialisation track them.
  const spec = ref<FeatureSpecification | null>(null);
  const mode = ref<"structured" | "raw">("structured");
  const baselineScenarioNames = shallowRef<string[] | null>(null);
  const stepPatterns = ref<StepDefinitionPattern[]>([]);
  const knownTags = ref<string[]>([]);
  const validateResult = shallowRef<ChecklistRow[] | null>(null);
  // Drops a validate result whose read resolves after a reload/mode-switch cleared
  // it (the imperative view's detached-resultEl isConnected guard).
  let validateGeneration = 0;

  const project = (): FeatureSpecification | null => {
    const raw = hooks.filePath();
    if (raw === null) return null;
    const path = unsafeVaultPath(raw);
    if (!roundTripsLosslessly(data.value, path)) return null;
    return parseFeature(data.value, path);
  };

  const clearValidate = (): void => {
    validateGeneration += 1;
    validateResult.value = null;
  };

  const setData = (next: string): void => {
    data.value = next;
    spec.value = project();
    baselineScenarioNames.value = scenarioNames(spec.value);
    // An unparseable file forces raw mode; a parseable one keeps the current mode.
    if (spec.value === null) mode.value = "raw";
    clearValidate();
  };

  const onRawInput = (value: string): void => {
    data.value = value;
    // Keep the projection in sync so the Structured toggle + banner stay truthful.
    spec.value = project();
    hooks.requestSave();
  };

  const commit = (): void => {
    if (spec.value === null) return;
    // toRaw: serialise the plain spec, not the reactive proxy.
    data.value = serialiseFeature(toRaw(spec.value));
    hooks.requestSave();
  };

  const toStructured = (): void => {
    const projected = project();
    if (projected === null) {
      new Notice(
        "This file contains Gherkin the structured editor can't preserve " +
          "(e.g. comments or Rule: blocks); keep editing it as raw text.",
        8000,
      );
      return;
    }
    spec.value = projected;
    mode.value = "structured";
    clearValidate();
  };

  const toRawMode = (): void => {
    mode.value = "raw";
    clearValidate();
  };

  const loadAids = async (): Promise<void> => {
    const [patterns, tags] = await Promise.all([
      deps.specifications.listStepPatterns(),
      deps.featureInsight.listKnownTags(),
    ]);
    stepPatterns.value = patterns;
    if (tags.ok) knownTags.value = tags.value;
  };

  const runFeature = async (): Promise<void> => {
    const raw = hooks.filePath();
    if (raw === null) {
      new Notice("Open a .feature file before running it.");
      return;
    }
    // Flush the debounced write FIRST: the runner executes the .feature from disk,
    // so a run fired right after an edit must not execute stale Gherkin.
    await hooks.save();
    await deps.runLauncher.launch({ scope: "feature", target: raw });
  };

  const validateFeature = async (): Promise<void> => {
    const raw = hooks.filePath();
    if (raw === null) {
      new Notice("Open a .feature file before validating it.");
      return;
    }
    const generation = ++validateGeneration;
    validateResult.value = [checklistRow("pending", "Validating…")];
    const path: VaultPath = unsafeVaultPath(raw);
    // Flush the debounced write so validation reads on-screen content from disk.
    await hooks.save();
    const rows = await validateFeatureOutcome(deps.specifications, path);
    // Drop a result a reload/mode-switch invalidated while we awaited.
    if (validateGeneration === generation) validateResult.value = rows;
  };

  return {
    data,
    spec,
    mode,
    baselineScenarioNames,
    stepPatterns,
    knownTags,
    validateResult,
    deps,
    setData,
    onRawInput,
    commit,
    toStructured,
    toRaw: toRawMode,
    loadAids,
    runFeature,
    validateFeature,
  };
}

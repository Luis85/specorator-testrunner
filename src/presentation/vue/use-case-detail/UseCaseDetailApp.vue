<script setup lang="ts">
import { inject, ref, watch } from "vue";
import { USE_CASE_DETAIL_DEPS, USE_CASE_DETAIL_ID } from "./use-case-detail-deps";
import { OBSIDIAN_APP } from "../obsidian-app";
import { useEventBus } from "../use-event-bus";
import Imperative from "../Imperative.vue";
import ChecklistRows from "../ChecklistRows.vue";
import FeatureRow from "./FeatureRow.vue";
import { checklistRow, type ChecklistRow } from "../../views/checklist";
import { renderEmptyState, renderLoadError, openOrNotice } from "../../views/modal-helpers";
import {
  projectLoopRail,
  renderLoopRail,
  type LoopRail,
  type LoopRailAction,
} from "../../views/loop-rail-rows";
import {
  generateStepDefinitionsOutcome,
  prdBreadcrumbLabel,
  projectFeatureRows,
  projectUseCaseHeader,
  storyMapBacklinks,
  type FeatureRow as FeatureRowModel,
  type StoryMapBacklink,
  type UseCaseHeaderRow,
} from "../../views/use-case-detail-rows";
import { EditUseCaseModal } from "../../views/edit-use-case-modal";
import { USE_CASE_VIEW_TYPE } from "../../views/use-case-dashboard-view";
import { artifactTarget } from "../../navigation/navigation-target";
import type { UseCase } from "../../../domain/entities/use-case";
import type { DomainEventType } from "../../../domain/events/domain-event";
import type { VaultPath } from "../../../domain/value-objects/identifiers";

const deps = inject(USE_CASE_DETAIL_DEPS)!;
const useCaseId = inject(USE_CASE_DETAIL_ID)!;
const app = inject(OBSIDIAN_APP)!;

// The same refresh set the hand-rolled view subscribed to (Wave D): feature/
// step/use-case lifecycle + terminal run + history + settings + story-map events.
const REFRESH_ON: DomainEventType[] = [
  "specification.created",
  "specification.updated",
  "stepdefinition.generated",
  "usecase.updated",
  "usecase.status.changed",
  "usecase.deleted",
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
  "scenario.history.recorded",
  "settings.updated",
  "storymap.created",
  "storymap.updated",
  "storymap.deleted",
];

interface LoadedModel {
  useCase: UseCase;
  header: UseCaseHeaderRow;
  prdLinkLabel: string;
  prdBreadcrumb: string;
  backlinks: StoryMapBacklink[];
  railPaths: VaultPath[];
  loopRail: LoopRail;
  featureRows: FeatureRowModel[] | null;
  featuresError: string | null;
}

type DetailState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "not-found"; id: string }
  | { kind: "loaded"; model: LoadedModel };

const state = ref<DetailState>({ kind: "empty" });
const loopResult = ref<ChecklistRow[] | null>(null);

// Mirrors the hand-rolled render() orchestration exactly; all decisions stay in
// the pure projections (projectUseCaseHeader/projectLoopRail/projectFeatureRows/
// storyMapBacklinks), so this only sequences the awaited reads into a model. The
// residual branching is the load's three early-return guards (no UC / load error
// / not-found) plus the result ternaries — the same shape the original render()
// carried, and not meaningfully reducible without obscuring the sequence.
// fallow-ignore-next-line complexity
async function reload(): Promise<void> {
  // Any refresh/re-target clears the rail's inline generate-steps result — the
  // pre-Vue full re-render rebuilt a fresh (empty) result element each time, so a
  // prior result never lingered under a now-different rail.
  loopResult.value = null;
  const id = useCaseId.value;
  if (id === null) {
    state.value = { kind: "empty" };
    return;
  }
  // Re-target to a DIFFERENT Use Case: drop the stale loaded view BEFORE awaiting
  // the new reads — otherwise the old Use Case's Open/Edit/Run buttons stay
  // clickable against the wrong target during a slow load (the pre-Vue render
  // emptied the container before its first await). A same-Use-Case refresh keeps
  // the current view rendered (no flicker) since its actions are still valid.
  if (state.value.kind === "loaded" && state.value.model.useCase.id !== id) {
    state.value = { kind: "loading" };
  }
  const found = await deps.traceability.deriveById(id);
  if (!found.ok) {
    state.value = { kind: "error", message: found.error.message };
    return;
  }
  if (found.value === null) {
    state.value = { kind: "not-found", id };
    return;
  }
  const useCase = found.value;

  const prdTitleById = await loadPrdTitleById(useCase);
  const maps = await deps.storyMapService.findAll();
  const backlinks = maps.ok ? storyMapBacklinks(useCase.id, maps.value) : [];

  const railPaths = useCase.featureFiles;
  const stepsDefined = await deps.specificationService.allStepsDefined(railPaths);
  const listed = await deps.specificationService.listFeatures();

  state.value = {
    kind: "loaded",
    model: {
      useCase,
      header: projectUseCaseHeader(useCase),
      prdLinkLabel: prdLinkLabelFor(useCase, prdTitleById),
      prdBreadcrumb: prdBreadcrumbLabel(useCase, prdTitleById),
      backlinks,
      railPaths,
      loopRail: projectLoopRail(useCase, { featureCount: railPaths.length, stepsDefined }),
      featureRows: listed.ok ? projectFeatureRows(useCase.id, listed.value) : null,
      featuresError: listed.ok ? null : listed.error.message,
    },
  };
}

// Resolves the parent PRD's title (if any) for the header breadcrumb. Split out
// of reload() so the orchestration stays a flat sequence (keeps reload's
// branching under the complexity budget).
async function loadPrdTitleById(useCase: UseCase): Promise<Map<string, string>> {
  const prdTitleById = new Map<string, string>();
  if (useCase.prdId) {
    const prd = await deps.prdService.findById(useCase.prdId);
    if (prd.ok && prd.value) prdTitleById.set(useCase.prdId, prd.value.title);
  }
  return prdTitleById;
}

const prdLinkLabelFor = (useCase: UseCase, prdTitleById: Map<string, string>): string => {
  if (!useCase.prdId) return "";
  const title = prdTitleById.get(useCase.prdId);
  return title ? `${useCase.prdId}: ${title}` : useCase.prdId;
};

const { refresh } = useEventBus(deps.eventBus, REFRESH_ON, reload);
// Re-target (leaf reused for another Use Case) reloads through the same
// serialized scheduler; the ref already held the new id before onOpen on restore.
watch(useCaseId, () => void refresh());

// Loop-rail next-step action → the SAME services/flows the per-row buttons use.
// A flat 4-arm dispatch (the action MODEL is tested in loop-rail-rows.test.ts);
// each arm just wires an existing flow, so the cyclomatic count is structural.
// fallow-ignore-next-line complexity
function runLoopAction(action: Exclude<LoopRailAction, null>, model: LoadedModel): void {
  switch (action) {
    case "generate-feature":
      deps.openGenerateFeature(model.useCase, () => void refresh());
      return;
    case "generate-steps":
      void generateStepsForAll(model.railPaths);
      return;
    case "create-suite":
      deps.openCreateSuite();
      return;
    case "run":
      void deps.runLauncher.launch({ scope: "use-case", target: model.useCase.id });
      return;
  }
}

// Generate step definitions for EVERY Feature the Use Case owns (the rail's Steps
// action), labelling each when there is more than one — mirrors the view.
async function generateStepsForAll(featurePaths: VaultPath[]): Promise<void> {
  // Capture the target Use Case: if the leaf is re-targeted while this awaits, the
  // result belongs to the PREVIOUS Use Case and must not be written under the new
  // rail (the pre-Vue path guarded the same race with a captured-element
  // isConnected check). reload() also clears loopResult on the re-target.
  const target = useCaseId.value;
  loopResult.value = [{ status: "pending", icon: "…", text: "Generating step definitions…" }];
  const rows = await collectStepGenerationRows(featurePaths);
  if (useCaseId.value === target) loopResult.value = rows;
}

// One Feature reads exactly like the per-row generate; multiple Features label
// each before its outcome so the aggregated report stays legible (mirrors the
// view). Pure aggregation — the stale-target guard stays in the caller.
async function collectStepGenerationRows(featurePaths: VaultPath[]): Promise<ChecklistRow[]> {
  if (featurePaths.length === 1) {
    return generateStepDefinitionsOutcome(
      deps.specificationService,
      deps.stepDefinitionService,
      featurePaths[0],
    );
  }
  const rows: ChecklistRow[] = [];
  for (const featurePath of featurePaths) {
    rows.push(checklistRow("info", featurePath));
    rows.push(
      ...(await generateStepDefinitionsOutcome(
        deps.specificationService,
        deps.stepDefinitionService,
        featurePath,
      )),
    );
  }
  return rows;
}

const openExplorer = (): void => void deps.workspace.openView(USE_CASE_VIEW_TYPE);
const openNote = (model: LoadedModel): void => void openOrNotice(deps.workspace, model.header.path);
const runUseCase = (model: LoadedModel): void =>
  void deps.runLauncher.launch({ scope: "use-case", target: model.header.id });
const generateFeature = (model: LoadedModel): void =>
  deps.openGenerateFeature(model.useCase, () => void refresh());
const edit = (model: LoadedModel): void => {
  new EditUseCaseModal(app, {
    useCaseService: deps.useCaseService,
    prdService: deps.prdService,
    useCase: model.useCase,
  }).open();
};
const navigateArtifact = (id: string): void => deps.navigate(artifactTarget(id));

// Paint factories for the reused DOM writers. Returning the closure from a script
// function (rather than an inline arrow in the template) keeps the `state` union
// narrowing intact: the template passes the already-narrowed value in, so the
// closure never re-widens it (vue-tsc).
const errorPaint =
  (message: string) =>
  (el: HTMLElement): void =>
    renderLoadError(
      el,
      `Could not load Use Case: ${message}`,
      "Retry loading the Use Case",
      () => void refresh(),
    );
const loopRailPaint =
  (model: LoadedModel) =>
  (el: HTMLElement): void =>
    renderLoopRail(el, model.loopRail, (action) => runLoopAction(action, model));
const featuresErrorPaint =
  (message: string) =>
  (el: HTMLElement): void =>
    renderLoadError(
      el,
      `Could not load Feature Specifications: ${message}`,
      "Retry loading the Feature Specifications",
      () => void refresh(),
    );
const emptyFeaturesPaint =
  () =>
  (el: HTMLElement): void =>
    renderEmptyState(
      el,
      "No Feature Specifications yet. Generate one to make this Use Case executable.",
    );
</script>

<template>
  <div class="e2e-test-hub-uc-detail">
    <p v-if="state.kind === 'empty'">Open a Use Case to see its Feature Specifications.</p>

    <p v-else-if="state.kind === 'loading'" class="spec-empty">Loading…</p>

    <Imperative v-else-if="state.kind === 'error'" :paint="errorPaint(state.message)" />

    <template v-else-if="state.kind === 'not-found'">
      <p>Use Case {{ state.id }} was not found. It may have been renamed or deleted.</p>
      <button class="mod-cta" aria-label="Open the Use Cases explorer" @click="openExplorer">
        Open Use Cases
      </button>
    </template>

    <template v-else-if="state.kind === 'loaded'">
      <div>
        <Imperative :paint="loopRailPaint(state.model)" />
        <div class="e2e-test-hub-uc-detail-feature-result" aria-live="polite">
          <ChecklistRows v-if="loopResult" :rows="loopResult" />
        </div>
      </div>

      <div class="e2e-test-hub-uc-detail-header">
        <button
          class="e2e-test-hub-link-button"
          aria-label="Open the Use Cases explorer"
          @click="openExplorer"
        >
          All Use Cases
        </button>

        <div
          v-if="state.model.useCase.domain || state.model.useCase.prdId"
          class="e2e-test-hub-uc-prd-breadcrumb"
          :aria-label="state.model.prdBreadcrumb"
        >
          <span v-if="state.model.useCase.domain">Domain: {{ state.model.useCase.domain }}</span>
          <span v-if="state.model.useCase.domain && state.model.useCase.prdId">{{ "  ›  " }}</span>
          <button
            v-if="state.model.useCase.prdId"
            class="e2e-test-hub-link-button"
            :aria-label="`Open PRD ${state.model.useCase.prdId}`"
            @click="navigateArtifact(state.model.useCase.prdId)"
          >
            {{ state.model.prdLinkLabel }}
          </button>
        </div>

        <h2>{{ state.model.header.id }} — {{ state.model.header.title }}</h2>

        <div v-if="state.model.backlinks.length" class="e2e-test-hub-uc-story-map-backlinks">
          <span>Referenced by Story Maps: </span>
          <template v-for="(map, i) in state.model.backlinks" :key="map.id">
            <span v-if="i > 0">, </span>
            <button
              class="e2e-test-hub-link-button"
              :aria-label="`Open Story Map ${map.id} ${map.title}`"
              @click="navigateArtifact(map.id)"
            >
              {{ map.id }}: {{ map.title }}
            </button>
          </template>
        </div>

        <div class="e2e-test-hub-uc-detail-meta">
          <span class="spec-pill" :data-status="state.model.header.status">
            Status: {{ state.model.header.status }}
          </span>
          <span class="spec-pill" :data-status="state.model.header.automationStatus">
            Automation: {{ state.model.header.automationStatus }}
          </span>
        </div>

        <div class="e2e-test-hub-uc-detail-actions">
          <button
            :aria-label="`Open the ${state.model.header.id} note`"
            @click="openNote(state.model)"
          >
            Open note
          </button>
          <button
            :aria-label="`Edit the title or status of ${state.model.header.id}`"
            @click="edit(state.model)"
          >
            Edit
          </button>
          <button
            class="mod-cta"
            :aria-label="`Run Use Case ${state.model.header.id}`"
            @click="runUseCase(state.model)"
          >
            Run Use Case
          </button>
          <button
            :aria-label="`Generate a Feature Specification for ${state.model.header.id}`"
            @click="generateFeature(state.model)"
          >
            Generate feature
          </button>
        </div>
      </div>

      <div class="e2e-test-hub-uc-detail-features">
        <h3>Feature Specifications</h3>
        <Imperative
          v-if="state.model.featuresError"
          :paint="featuresErrorPaint(state.model.featuresError)"
        />
        <Imperative
          v-else-if="state.model.featureRows && state.model.featureRows.length === 0"
          :paint="emptyFeaturesPaint()"
        />
        <FeatureRow v-else v-for="row in state.model.featureRows" :key="row.path" :row="row" />
      </div>
    </template>
  </div>
</template>

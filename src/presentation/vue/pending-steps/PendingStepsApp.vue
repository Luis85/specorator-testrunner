<script setup lang="ts">
/**
 * The Pending Steps companion app (WS1/C2, spec §3.2): resolves the target to a
 * Feature list, projects each through the STATIC tier, and runs bddgen only on
 * explicit actions (a feature-targeted open counts as one — spec D8). Owns all
 * async work; PendingFeatureCard is a dumb renderer.
 */
import { inject, shallowRef, watch } from "vue";
import { PENDING_STEPS_DEPS, PENDING_STEPS_TARGET } from "./pending-steps-deps";
import PendingFeatureCard, { type StubViewerState } from "./PendingFeatureCard.vue";
import { useEventBus } from "../use-event-bus";
import { checklistRow, type ChecklistRow } from "../../views/checklist";
import {
  projectPendingFeature,
  type PendingFeatureGroup,
  type PendingStepsTarget,
} from "../../views/pending-steps-rows";
import { collectStepTexts } from "../../../application/content/gherkin";
import { readFeatureFile } from "../../../application/services/feature-loading";
import type { StepDefinitionPattern } from "../../../application/content/step-definitions";
import type { GenerateStepDefinitionsResult } from "../../../application/services/step-definition-service";
import type { VaultPath } from "../../../domain/value-objects/identifiers";

const deps = inject(PENDING_STEPS_DEPS)!;
const target = inject(PENDING_STEPS_TARGET)!;

interface GroupState {
  group: PendingFeatureGroup;
  busy: boolean;
  result: ChecklistRow[] | null;
  viewer: StubViewerState | null;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; title: string; groups: GroupState[] };

const state = shallowRef<PanelState>({ kind: "loading" });

// Stale-load guard (the FeatureRow generation-counter idiom): any await that
// resolves after a newer load/re-target drops its write.
let generation = 0;

const targetTitle = (value: PendingStepsTarget): string =>
  value.kind === "use-case"
    ? `Pending steps — ${value.useCaseId}`
    : value.kind === "feature"
      ? `Pending steps — ${value.featurePath.split("/").pop() ?? value.featurePath}`
      : "Pending steps — vault";

/** The Feature paths the current target spans (empty list is a valid answer). */
async function resolvePaths(value: PendingStepsTarget): Promise<VaultPath[]> {
  if (value.kind === "feature") return [value.featurePath];
  if (value.kind === "use-case") {
    const useCase = await deps.useCaseService.findById(value.useCaseId);
    return useCase.ok && useCase.value !== null ? useCase.value.featureFiles : [];
  }
  const listed = await deps.specificationService.listFeatures();
  return listed.ok ? listed.value.map((entry) => entry.path) : [];
}

/** Static-tier group for one Feature (no process spawn — spec D8). */
async function staticGroup(
  path: VaultPath,
  definitions: StepDefinitionPattern[],
): Promise<PendingFeatureGroup | null> {
  const feature = await readFeatureFile(deps.fs, path);
  if (!feature.ok) return null;
  return projectPendingFeature(path, collectStepTexts(feature.value), definitions, null);
}

async function load(): Promise<void> {
  const gen = ++generation;
  const value = target.value;
  state.value = { kind: "loading" };
  const paths = await resolvePaths(value);
  // Load the step-definition patterns ONCE per render, not once per Feature —
  // listStepPatterns re-scans `.testrunner/src/steps` on every call, so a
  // per-group load would repeat that scan N times on a vault target (Codex P2
  // on PR #102).
  const definitions = await deps.specificationService.listStepPatterns();
  const groups: GroupState[] = [];
  for (const path of paths) {
    const group = await staticGroup(path, definitions);
    if (group === null) continue;
    // The vault-wide listing shows only incomplete Features (spec §3.2).
    if (value.kind === "vault" && group.complete) continue;
    groups.push({ group, busy: false, result: null, viewer: null });
  }
  if (gen !== generation) return;
  state.value = { kind: "loaded", title: targetTitle(value), groups };
  // A feature-targeted open is an explicit user action: run ONE authoritative
  // verify automatically (spec D8); use-case / vault targets stay static until
  // a per-feature action.
  if (value.kind === "feature" && groups.length === 1) void verify(groups[0]);
}

watch(target, () => void load());

// Panel actions (Verify/Generate) publish the very events this panel
// subscribes to, and InMemoryEventBus.publish AWAITS handlers straight through
// RenderScheduler's returned chain — so an inline event reload would bump
// `generation` MID-action and drop the action's own success path (re-detect,
// success rows, stub viewer) every single time (Codex P1 on PR #102). While a
// panel action is in flight, self-caused events are deliberately SWALLOWED,
// not deferred: the action leaves its group MORE accurate (authoritative
// bddgen tier) than the static reload would, and a trailing reload would wipe
// the just-rendered viewer. An external edit landing exactly inside that
// window self-heals on its next event.
let actionDepth = 0;
async function withAction(run: () => Promise<void>): Promise<void> {
  actionDepth += 1;
  try {
    await run();
  } finally {
    actionDepth -= 1;
  }
}

// specification.created covers a newly generated Feature in the vault listing;
// specification.linkedToUseCase covers the USE-CASE target — createFromUseCase
// publishes `created` BEFORE writing the Use Case's featureFiles link, so a
// panel refreshing on `created` alone reads the pre-link list and would never
// see the new Feature until an unrelated event (Codex P2s on PR #102).
useEventBus(
  deps.eventBus,
  [
    "specification.created",
    "specification.linkedToUseCase",
    "specification.updated",
    "stepdefinition.generated",
  ],
  () => (actionDepth > 0 ? undefined : load()),
);

/** Public actions: wrapped so self-caused events are swallowed (Codex P1). */
const verify = (entry: GroupState): Promise<void> => withAction(() => verifyInner(entry));
const generate = (entry: GroupState): Promise<void> => withAction(() => generateInner(entry));

/**
 * Re-reads the Feature + step patterns and re-projects one group at the given
 * tier (`bddgenMissing` = the authoritative list, or null for the static tier).
 * Shared by verify and generate (both re-project after a detect). Returns false
 * when a newer load/re-target superseded this run — the caller then bails
 * without writing, the same stale-guard the inline blocks used.
 */
async function reprojectGroup(
  entry: GroupState,
  gen: number,
  bddgenMissing: readonly string[] | null,
): Promise<boolean> {
  const feature = await readFeatureFile(deps.fs, entry.group.path);
  const definitions = await deps.specificationService.listStepPatterns();
  if (gen !== generation) return false;
  if (feature.ok) {
    entry.group = projectPendingFeature(
      entry.group.path,
      collectStepTexts(feature.value),
      definitions,
      bddgenMissing,
    );
  }
  return true;
}

/** The success row for a completed generate (empty vs. singular/plural count). */
const generatedResultRow = (result: GenerateStepDefinitionsResult): ChecklistRow => {
  const count = result.generatedSteps.length;
  if (count === 0) return checklistRow("ok", "No missing steps — nothing to generate.");
  return checklistRow(
    "ok",
    `Generated ${count} step ${count === 1 ? "stub" : "stubs"} in ${result.stepFile}.`,
  );
};

/** Re-projects one group after a bddgen detect (authoritative tier). */
async function verifyInner(entry: GroupState): Promise<void> {
  const gen = generation;
  entry.busy = true;
  entry.result = [checklistRow("pending", "Verifying with bddgen…")];
  patch(entry);
  const detected = await deps.specificationService.detectMissingSteps(entry.group.path);
  if (gen !== generation) return;
  entry.busy = false;
  if (!detected.ok) {
    entry.result = [checklistRow("error", `Verify failed: ${detected.error.message}`)];
    patch(entry);
    return;
  }
  if (!(await reprojectGroup(entry, gen, detected.value.missingSteps))) return;
  entry.result = null;
  patch(entry);
}

/** Detect → generate → re-detect → show the written stubs (spec §3.2). */
async function generateInner(entry: GroupState): Promise<void> {
  const gen = generation;
  entry.busy = true;
  entry.result = [checklistRow("pending", "Generating step stubs…")];
  patch(entry);
  const detected = await deps.specificationService.detectMissingSteps(entry.group.path);
  if (gen !== generation) return;
  if (!detected.ok) {
    entry.busy = false;
    entry.result = [checklistRow("error", `Detection failed: ${detected.error.message}`)];
    patch(entry);
    return;
  }
  const generated = await deps.stepDefinitionService.generate(
    entry.group.path,
    detected.value.missingSteps,
    detected.value.detectionEventId,
  );
  if (gen !== generation) return;
  if (!generated.ok) {
    entry.busy = false;
    entry.result = [checklistRow("error", `Could not generate: ${generated.error.message}`)];
    patch(entry);
    return;
  }
  // Re-project from the STATIC tier — deliberately NO bddgen re-detect here.
  // The just-written stubs are already in `src/steps`, so the static matcher
  // sees them defined (and the loop rail, subscribed to stepdefinition.generated,
  // advances off Steps the same way). A re-detect would instead publish a
  // zero-missing `specification.missingSteps.detected` that completes the Guided
  // Tour's implement-steps step straight from the generated `throw new
  // Error("Pending")` stubs — before the user implements anything (bddgen counts
  // a pending stub as defined). The user implements, then clicks Verify (a REAL
  // detect) to record the #77 covered verdict and complete the tour (tour-safe,
  // Codex P2 on PR #102 — the same reason the old inline generate never
  // re-detected).
  if (!(await reprojectGroup(entry, gen, null))) return;
  entry.busy = false;
  entry.result = [generatedResultRow(generated.value)];
  // The read-only stub viewer: the written file, highlighted at the returned
  // insertion ranges (spec D2).
  if (generated.value.generatedSteps.length > 0) {
    const content = await deps.fs.readFile(generated.value.stepFile);
    if (gen !== generation) return;
    if (content.ok) {
      entry.viewer = {
        stepFile: generated.value.stepFile,
        lines: content.value.split("\n"),
        insertions: generated.value.insertions,
      };
    }
  }
  patch(entry);
}

function openFile(entry: GroupState): void {
  const stepFile = entry.viewer?.stepFile;
  if (stepFile !== undefined) {
    void deps.workspace.openInSystemEditor(stepFile);
    return;
  }
  // The step-file path is minted by the generator (service-owned convention),
  // so before a generate there is nothing reliable to open — say so inline.
  entry.result = [
    checklistRow("info", "Generate stubs first — Generate creates/locates the step file."),
  ];
  patch(entry);
}

/** shallowRef state: re-set the loaded object so Vue re-renders the group. */
function patch(entry: GroupState): void {
  if (state.value.kind !== "loaded") return;
  state.value = {
    ...state.value,
    groups: state.value.groups.map((candidate) =>
      candidate.group.path === entry.group.path ? { ...entry } : candidate,
    ),
  };
}
</script>

<template>
  <div class="spec-pending-steps">
    <p v-if="state.kind === 'loading'" class="spec-empty">Loading…</p>
    <p v-else-if="state.kind === 'error'">{{ state.message }}</p>
    <template v-else>
      <h4 class="spec-pending-steps-title">{{ state.title }}</h4>
      <p v-if="state.groups.length === 0" class="spec-empty">
        No Features with pending steps — everything the static check can see is defined.
      </p>
      <PendingFeatureCard
        v-for="entry in state.groups"
        :key="entry.group.path"
        :group="entry.group"
        :busy="entry.busy"
        :result="entry.result"
        :viewer="entry.viewer"
        @verify="verify(entry)"
        @generate="generate(entry)"
        @open-file="openFile(entry)"
      />
    </template>
  </div>
</template>

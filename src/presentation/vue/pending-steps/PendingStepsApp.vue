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
import { err, ok, type Result } from "../../../shared/result/result";
import { appError } from "../../../shared/errors/errors";

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

/**
 * The Feature paths the current target spans (an empty list is a valid answer).
 * A lookup/listing FAILURE (a bad `featureFilesPath`, an adapter I/O fault, a
 * failed Use-Case load) returns `err` so `load` surfaces it in the error state
 * rather than collapsing to `[]` — which would render "everything defined" and
 * hide an actionable config/I-O failure (Codex P2 on PR #102).
 */
async function resolvePaths(value: PendingStepsTarget): Promise<Result<VaultPath[]>> {
  if (value.kind === "feature") return ok([value.featurePath]);
  if (value.kind === "use-case") {
    const useCase = await deps.useCaseService.findById(value.useCaseId);
    if (!useCase.ok) return err(useCase.error);
    // A not-FOUND Use Case (null) — the leaf was restored or re-targeted to a
    // Use Case since deleted or renamed — is an error, not "everything covered"
    // (Codex P2 on PR #102). A FOUND Use Case with zero Features stays empty.
    if (useCase.value === null) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `Use Case ${value.useCaseId} not found — it may have been deleted or renamed.`,
        ),
      );
    }
    return ok(useCase.value.featureFiles);
  }
  const listed = await deps.specificationService.listFeatures();
  return listed.ok ? ok(listed.value.map((entry) => entry.path)) : err(listed.error);
}

/** Static-tier group for one Feature (no process spawn — spec D8). An
 * unreadable/unparseable Feature returns `err` so `load` can surface it for a
 * feature-targeted panel (Codex P2 on PR #102). */
async function staticGroup(
  path: VaultPath,
  definitions: StepDefinitionPattern[],
): Promise<Result<PendingFeatureGroup>> {
  const feature = await readFeatureFile(deps.fs, path);
  if (!feature.ok) return err(feature.error);
  return ok(projectPendingFeature(path, collectStepTexts(feature.value), definitions, null));
}

/**
 * Project each resolved Feature path to a static-tier group. A feature-TARGETED
 * panel is entirely about its one file, so a read/parse failure returns `err`
 * for `load` to surface (Codex P2 on PR #102); a vault/use-case target spans
 * many files, so an unreadable one is skipped and the rest still show. The
 * vault listing additionally drops already-complete Features (spec §3.2).
 */
async function buildGroups(
  value: PendingStepsTarget,
  paths: readonly VaultPath[],
): Promise<Result<GroupState[]>> {
  // Load the step-definition patterns ONCE per render, not once per Feature —
  // listStepPatterns re-scans `.testrunner/src/steps` on every call, so a
  // per-group load would repeat that scan N times on a vault target (Codex P2).
  const definitions = await deps.specificationService.listStepPatterns();
  const groups: GroupState[] = [];
  for (const path of paths) {
    const group = await staticGroup(path, definitions);
    if (!group.ok) {
      if (value.kind === "feature") return err(group.error);
      continue;
    }
    if (value.kind === "vault" && group.value.complete) continue;
    groups.push({ group: group.value, busy: false, result: null, viewer: null });
  }
  return ok(groups);
}

async function load(): Promise<void> {
  const gen = ++generation;
  const value = target.value;
  state.value = { kind: "loading" };
  const resolved = await resolvePaths(value);
  if (gen !== generation) return;
  if (!resolved.ok) {
    state.value = {
      kind: "error",
      message: `Couldn't load Pending Steps: ${resolved.error.message}`,
    };
    return;
  }
  const built = await buildGroups(value, resolved.value);
  if (gen !== generation) return;
  if (!built.ok) {
    const what = value.kind === "feature" ? value.featurePath : "Pending Steps";
    state.value = { kind: "error", message: `Couldn't load ${what}: ${built.error.message}` };
    return;
  }
  state.value = { kind: "loaded", title: targetTitle(value), groups: built.value };
  // A feature-targeted open is an explicit user action: run ONE authoritative
  // verify automatically (spec D8); use-case / vault targets stay static until
  // a per-feature action.
  if (value.kind === "feature" && built.value.length === 1) void verify(built.value[0]);
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
    // The panel's inputs also come from settings (listFeatures/listStepPatterns
    // read featureFilesPath/testRunnerPath) and, for a use-case target, from the
    // Use Case itself (findById) — so a feature-folder/runner-path change or an
    // edit/delete of the targeted Use Case must re-resolve, not keep stale rows
    // that a later Verify/Generate would act on with fresh settings (Codex P2).
    "settings.updated",
    "usecase.updated",
    "usecase.deleted",
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

/**
 * After a generate WROTE stubs, a step it defined may also be listed as pending
 * by a SIBLING group (a shared step). Re-project every OTHER loaded group from
 * the static tier so they pick up the new definition — the action swallowed the
 * `stepdefinition.generated` event that would otherwise refresh them, and doing
 * it here (not a full reload) keeps the clicked entry's result/viewer intact
 * (Codex P2 on PR #102).
 */
async function reprojectSiblings(clicked: GroupState, gen: number): Promise<void> {
  if (state.value.kind !== "loaded") return;
  const definitions = await deps.specificationService.listStepPatterns();
  if (gen !== generation || state.value.kind !== "loaded") return;
  const refreshed = await Promise.all(
    state.value.groups.map(async (candidate) => {
      if (candidate.group.path === clicked.group.path) return candidate;
      const feature = await readFeatureFile(deps.fs, candidate.group.path);
      if (!feature.ok) return candidate;
      const group = projectPendingFeature(
        candidate.group.path,
        collectStepTexts(feature.value),
        definitions,
        null,
      );
      return { ...candidate, group };
    }),
  );
  if (gen !== generation || state.value.kind !== "loaded") return;
  state.value = { ...state.value, groups: refreshed };
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
  // Re-project after generate — deliberately NO bddgen re-detect here (it would
  // publish a zero-missing specification.missingSteps.detected that prematurely
  // completes the Guided Tour's implement-steps step from the generated
  // `throw new Error("Pending")` stubs). Pick the tier by what bddgen ORIGINALLY
  // detected, not by whether a write happened:
  // - detect was EMPTY: bddgen already resolved every step — a custom parameter
  //   type / optional syntax the static matcher CAN'T model — so trust that
  //   verdict (covered). Falling to static would wrongly re-flag the resolved
  //   step as pending and re-enable Generate right after "nothing to generate".
  // - detect was NON-empty: reproject from STATIC. It sees the just-written stubs
  //   (normal case) OR the now-implemented steps when generate re-diffed to a
  //   no-op because the misses were implemented between detect and write (a race)
  //   — reusing the stale detected list there would keep them shown pending. This
  //   is also the tour-safe path. (Codex P2s on PR #102.)
  const bddgenResolvedAll = detected.value.missingSteps.length === 0;
  if (!(await reprojectGroup(entry, gen, bddgenResolvedAll ? detected.value.missingSteps : null)))
    return;
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
  // A written stub may define a step a SIBLING group also lists as pending (a
  // shared step); refresh the other loaded groups so they pick it up, since the
  // action swallowed the stepdefinition.generated event that would (Codex P2).
  if (generated.value.generatedSteps.length > 0) await reprojectSiblings(entry, gen);
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

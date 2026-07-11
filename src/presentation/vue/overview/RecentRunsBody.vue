<script setup lang="ts">
/**
 * The Overview "Recent runs" body (ADR-0033 Phase 3): the heading, the "View all
 * runs" link into the Evidence Explorer, and the actionable run table — or a
 * retryable load-error. Self-loads and stays live via useEventBus, reusing the
 * pure projectDashboard projection. The Vue twin of `renderRecentRunsBody` +
 * `renderRecentRuns`.
 *
 * Pre-init (and while loading) the body renders NOTHING: the root `v-if` collapses
 * to a comment, so the enclosing `.spec-hub-section-body` is `:empty` and hides
 * (the pre-Vue behaviour on a fresh vault — the hero owns the Initialize CTA, so
 * this stays out of the way rather than showing an empty Recent Runs under it).
 */
import { computed } from "vue";
import { useOverviewSnapshot } from "./use-overview-snapshot";
import {
  NO_EVIDENCE_TOOLTIP,
  projectDashboard,
  type RecentRunRow,
} from "../../views/dashboard-rows";
import type { VaultPath } from "../../../domain/value-objects/identifiers";
import type { RecentRunsBodyDeps } from "./overview-body-deps";

const props = defineProps<{ deps: RecentRunsBodyDeps }>();

// The shared Overview snapshot loader; `hidden` (an un-scaffolded vault) renders
// nothing here so the slot collapses (see the template's root v-if).
const { state, refresh } = useOverviewSnapshot(
  props.deps,
  (snapshot) => projectDashboard(snapshot).recentRuns,
);

// Non-loading, non-hidden: the only states that render a box (so the slot's
// :empty collapse applies during load / pre-init).
const visible = computed(() => state.value.kind === "error" || state.value.kind === "loaded");

// A row links to evidence only when navigable AND it has a path.
const hasEvidence = (run: RecentRunRow): run is RecentRunRow & { evidencePath: VaultPath } =>
  run.navigable && run.evidencePath !== undefined;
// Whole-row + id-link open: no-op on an inert (no-evidence) row.
const openRow = (run: RecentRunRow): void => {
  if (hasEvidence(run)) void props.deps.openEvidence(run.evidencePath);
};
</script>

<template>
  <div v-if="visible">
    <template v-if="state.kind === 'error'">
      <p>Could not load recent runs: {{ state.message }}</p>
      <button class="mod-cta" aria-label="Retry loading recent runs" @click="refresh">Retry</button>
    </template>

    <template v-else-if="state.kind === 'loaded'">
      <h3>Recent runs</h3>
      <p v-if="state.data.length === 0">No Test Runs yet. Run a Test Suite to see results here.</p>
      <template v-else>
        <button
          class="e2e-test-hub-doc-button"
          aria-label="Open the Evidence Explorer with the full run history"
          @click="deps.openEvidenceExplorer()"
        >
          View all runs
        </button>
        <table class="e2e-test-hub-runs-table">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Status</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="run in state.data"
              :key="run.runId"
              :class="
                hasEvidence(run) ? 'e2e-test-hub-run-row is-navigable' : 'e2e-test-hub-run-row'
              "
              :title="hasEvidence(run) ? undefined : NO_EVIDENCE_TOOLTIP"
              @click="openRow(run)"
            >
              <td v-if="hasEvidence(run)">
                <button
                  class="e2e-test-hub-link-button"
                  :aria-label="run.ariaLabel"
                  @click.stop="openRow(run)"
                >
                  {{ run.runId }}
                </button>
              </td>
              <td v-else>{{ run.runId }}</td>
              <td class="e2e-test-hub-run-status" :data-status="run.status">{{ run.status }}</td>
              <td>{{ run.date }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </div>
</template>

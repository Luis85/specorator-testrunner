<script setup lang="ts">
/**
 * The "Use Cases" body (ADR-0033 Phase 3): the per-Use-Case table
 * (id/title/status/automation/features/note/run), with an optional KPI funnel
 * filter chip, or the empty/error state. Self-loads and stays live via
 * useEventBus, reusing the pure projections (projectUseCaseRows /
 * filterUseCaseRows / featureCountCell). The Vue twin of
 * `renderUseCaseDashboardBody`.
 *
 * The `filter` is a reactive prop (the hub passes its Pinia store getter; the
 * standalone leaf leaves it `"all"`). Filtering is a PURE client-side scope, so a
 * filter change re-computes the visible rows WITHOUT a reload — unlike the old
 * imperative body, which re-fetched on every repaint.
 */
import { computed, ref } from "vue";
import { useEventBus } from "../use-event-bus";
import ListHeader from "../ListHeader.vue";
import { openOrNotice } from "../../views/modal-helpers";
import { useCaseFilterLabel, type UseCaseKpiFilter } from "../../views/dashboard-rows";
import {
  featureCountCell,
  filterUseCaseRows,
  projectUseCaseRows,
  type FeatureCountCell,
  type UseCaseRow,
} from "../../views/use-case-rows";
import type { DomainEventType } from "../../../domain/events/domain-event";
import type { VaultPath } from "../../../domain/value-objects/identifiers";
import type { UseCaseBodyDeps } from "./use-case-body-deps";

const props = withDefaults(
  defineProps<{
    deps: UseCaseBodyDeps;
    /** The active KPI funnel filter (hub-owned); `"all"` shows every row (no chip). */
    filter?: UseCaseKpiFilter;
    /** Clears the filter back to `"all"` (the chip's ✕); no-op on the standalone leaf. */
    clearFilter?: () => void;
  }>(),
  { filter: "all", clearFilter: () => undefined },
);

// The Automation column is DERIVED (deriveAll over Features + per-scenario
// history), so it changes on Feature edits, recorded runs, and an Evidence-root
// settings change with no Use Case event — hence the broad set. This is exactly
// what HUB_REFRESH_ON would have repainted this body on for its data, so a direct
// Vue body loses nothing.
const REFRESH_ON: DomainEventType[] = [
  "usecase.created",
  "usecase.updated",
  "usecase.deleted",
  "usecase.status.changed",
  "specification.created",
  "specification.updated",
  "scenario.history.recorded",
  "settings.updated",
];

interface UseCaseRowVM extends UseCaseRow {
  cell: FeatureCountCell;
  featuresAriaLabel: string;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; rows: UseCaseRow[] };

const state = ref<ViewState>({ kind: "loading" });

// Clear stale rows synchronously before the await so an event-driven refresh in
// a slow vault never leaves the old table's Open/Run actions live (the shared
// Phase 3 guard).
async function load(): Promise<void> {
  state.value = { kind: "loading" };
  const [result, listed] = await Promise.all([
    props.deps.traceability.deriveAll(),
    props.deps.specificationService.listFeatures(),
  ]);
  if (!result.ok) {
    state.value = { kind: "error", message: result.error.message };
    return;
  }
  // A failed Feature listing degrades the "Features" column to "—" (unknown)
  // rather than hiding the explorer — the listing is insight, not data.
  const rows = projectUseCaseRows(result.value, listed.ok ? listed.value : null);
  state.value = { kind: "loaded", rows };
}

const { refresh } = useEventBus(props.deps.eventBus, REFRESH_ON, load);

const allRows = computed(() => (state.value.kind === "loaded" ? state.value.rows : []));

const toVm = (row: UseCaseRow): UseCaseRowVM => ({
  ...row,
  cell: featureCountCell(row.featureCount),
  featuresAriaLabel:
    row.featureCount === null
      ? `Feature Specifications for ${row.id} could not be listed`
      : `${row.featureCount} Feature Specification${row.featureCount === 1 ? "" : "s"}`,
});

// Reactive re-filter: changing `filter` re-derives the visible rows from the
// already-loaded set, no reload.
const visibleRows = computed<UseCaseRowVM[]>(() =>
  filterUseCaseRows(allRows.value, props.filter).map(toVm),
);

// The active-filter chip label (E1 PR3); null in the `"all"` no-filter state.
const filterChipLabel = computed(() =>
  props.filter === "all" ? null : useCaseFilterLabel(props.filter),
);

const openNote = (path: VaultPath): void => void openOrNotice(props.deps.workspace, path);
const run = (id: string): void =>
  void props.deps.runLauncher.launch({ scope: "use-case", target: id });
</script>

<template>
  <div>
    <ListHeader
      header-cls="e2e-test-hub-uc-header"
      title="Use Cases"
      action-label="New Use Case"
      @action="deps.onCreate()"
    />

    <template v-if="state.kind === 'error'">
      <p>Could not load Use Cases: {{ state.message }}</p>
      <button class="mod-cta" aria-label="Retry loading the Use Cases" @click="refresh">
        Retry
      </button>
    </template>

    <template v-else-if="state.kind === 'loaded'">
      <p v-if="allRows.length === 0">No Use Cases yet. Create one to get started.</p>

      <template v-else>
        <div v-if="filterChipLabel !== null" class="e2e-test-hub-uc-filter">
          <div class="e2e-test-hub-uc-filter-chip">
            <span class="e2e-test-hub-uc-filter-label">{{ filterChipLabel }} Use Cases</span>
            <button
              class="e2e-test-hub-uc-filter-clear"
              type="button"
              :aria-label="`Clear the ${filter} filter`"
              @click="clearFilter()"
            >
              ✕
            </button>
          </div>
        </div>

        <p v-if="visibleRows.length === 0">
          No Use Cases match the {{ filter }} filter. Clear the filter to see all Use Cases.
        </p>

        <table v-else class="e2e-test-hub-uc-table">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Automation</th>
              <th scope="col">Features</th>
              <th scope="col">Note</th>
              <th scope="col">Run</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visibleRows" :key="row.id">
              <td>
                <button
                  class="e2e-test-hub-link-button"
                  :aria-label="`Open Use Case ${row.id} detail`"
                  @click="deps.onOpenDetail(row.id)"
                >
                  {{ row.id }}
                </button>
              </td>
              <td>{{ row.title }}</td>
              <td>{{ row.status }}</td>
              <td>{{ row.automationStatus }}</td>
              <td
                class="e2e-test-hub-uc-features"
                :aria-label="row.featuresAriaLabel"
                :title="row.cell.tooltip ?? undefined"
                :data-status="row.cell.status ?? undefined"
              >
                {{ row.cell.text }}
              </td>
              <td>
                <button
                  class="e2e-test-hub-link-button"
                  :aria-label="`Open the ${row.id} note`"
                  @click="openNote(row.path)"
                >
                  Note
                </button>
              </td>
              <td>
                <button
                  class="e2e-test-hub-run-button"
                  :aria-label="`Run Use Case ${row.id}`"
                  @click="run(row.id)"
                >
                  Run
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </div>
</template>

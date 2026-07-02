<script setup lang="ts">
/**
 * The Evidence Explorer body (ADR-0033 Phase 3): the `<h2>`, a status filter, the
 * month-grouped run tables, and a "Load older" affordance, or the empty/error
 * state. Self-loads and stays live via useEventBus, reusing the pure projections
 * (projectEvidenceGroups / statusFilterLabel). The Vue twin of
 * `renderEvidenceExplorerBody`.
 *
 * Controlled/uncontrolled filter + limit (ADR-0033): the hub passes store-backed
 * `filter`/`visibleLimit` + their mutators as props (persisting across section
 * switches); the standalone leaf omits them and the component owns local refs.
 * `filter` is a PURE client-side scope (re-groups without a reload); a
 * `visibleLimit` change is a paging LOAD parameter, so it reloads.
 */
import { computed, ref, watch } from "vue";
import { useEventBus } from "../use-event-bus";
import { runTarget } from "../../navigation/navigation-target";
import {
  EVIDENCE_PAGE_SIZE,
  EVIDENCE_STATUS_FILTERS,
  projectEvidenceGroups,
  statusFilterLabel,
  type EvidenceStatusFilter,
} from "../../views/evidence-explorer-rows";
import type { RunHistoryEntry } from "../../../application/services/run-history-service";
import type { DomainEventType } from "../../../domain/events/domain-event";
import type { EvidenceBodyDeps } from "./evidence-body-deps";

const props = defineProps<{
  deps: EvidenceBodyDeps;
  filter?: EvidenceStatusFilter;
  visibleLimit?: number;
  onFilterChange?: (filter: EvidenceStatusFilter) => void;
  onLoadOlder?: () => void;
}>();

// The run history is a scan of the written run summaries, which land (with the
// summary note) when evidence is generated — so `evidence.generated` is the sole
// data-change signal (the same the standalone leaf used, and the only relevant
// slice of HUB_REFRESH_ON: a run's summary is not listed until then).
const REFRESH_ON: DomainEventType[] = ["evidence.generated"];

// Uncontrolled fallback state for the standalone leaf; the hub overrides via the
// controlled props (store-backed) so the state survives a section switch.
const localFilter = ref<EvidenceStatusFilter>("all");
const localLimit = ref(EVIDENCE_PAGE_SIZE);

const filter = computed<EvidenceStatusFilter>(() => props.filter ?? localFilter.value);
const visibleLimit = computed(() => props.visibleLimit ?? localLimit.value);

const setFilter = (next: EvidenceStatusFilter): void => {
  if (props.onFilterChange) props.onFilterChange(next);
  else localFilter.value = next;
};
const loadOlder = (): void => {
  if (props.onLoadOlder) props.onLoadOlder();
  else localLimit.value += EVIDENCE_PAGE_SIZE;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; entries: RunHistoryEntry[]; hasMore: boolean };

const state = ref<ViewState>({ kind: "loading" });

// Clear stale content synchronously before the await (the imperative body's
// el.empty()) so an event-driven refresh in a slow vault never leaves old run
// rows clickable — only the `<h2>` shows during the load, as before.
async function load(): Promise<void> {
  state.value = { kind: "loading" };
  const result = await props.deps.runHistory.list({ offset: 0, limit: visibleLimit.value });
  if (!result.ok) {
    state.value = { kind: "error", message: result.error.message };
    return;
  }
  state.value = { kind: "loaded", entries: result.value.entries, hasMore: result.value.hasMore };
}

const { refresh } = useEventBus(props.deps.eventBus, REFRESH_ON, load);

// A paging change re-fetches (a larger page); the filter does NOT (client-side).
watch(visibleLimit, () => void refresh());

const entries = computed(() => (state.value.kind === "loaded" ? state.value.entries : []));
// Re-group reactively on a filter change — no reload.
const groups = computed(() => projectEvidenceGroups(entries.value, filter.value));

const openRun = (runId: string): void => props.deps.navigate(runTarget(runId));
const onSelect = (event: Event): void =>
  setFilter((event.target as HTMLSelectElement).value as EvidenceStatusFilter);
</script>

<template>
  <div>
    <h2>Evidence Explorer</h2>

    <template v-if="state.kind === 'error'">
      <p>Could not load run history: {{ state.message }}</p>
      <button class="mod-cta" aria-label="Retry loading the run history" @click="refresh">
        Retry
      </button>
    </template>

    <template v-else-if="state.kind === 'loaded'">
      <p v-if="entries.length === 0">No Test Runs yet. Run a Test Suite to see results here.</p>

      <template v-else>
        <div class="e2e-test-hub-evidence-toolbar">
          <label>
            Status:
            <select aria-label="Filter runs by status" :value="filter" @change="onSelect">
              <option v-for="option in EVIDENCE_STATUS_FILTERS" :key="option" :value="option">
                {{ statusFilterLabel(option) }}
              </option>
            </select>
          </label>
        </div>

        <p v-if="groups.length === 0">
          No loaded runs with status "{{ filter }}". Load older runs or change the filter.
        </p>

        <template v-for="group in groups" :key="group.heading">
          <h3>{{ group.heading }}</h3>
          <table class="e2e-test-hub-runs-table">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Status</th>
                <th scope="col">Passed</th>
                <th scope="col">Failed</th>
                <th scope="col">Total</th>
                <th scope="col">Scope</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in group.rows"
                :key="row.runId"
                class="e2e-test-hub-run-row is-navigable"
                @click="openRun(row.runId)"
              >
                <td>
                  <button
                    class="e2e-test-hub-link-button"
                    :aria-label="row.ariaLabel"
                    @click.stop="openRun(row.runId)"
                  >
                    {{ row.runId }}
                  </button>
                </td>
                <td class="e2e-test-hub-run-status" :data-status="row.status">{{ row.status }}</td>
                <td>{{ row.passed }}</td>
                <td>{{ row.failed }}</td>
                <td>{{ row.total }}</td>
                <td>{{ row.scope }}</td>
                <td>{{ row.date }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <button
          v-if="state.hasMore"
          class="e2e-test-hub-load-older"
          aria-label="Load older runs"
          @click="loadOlder"
        >
          Load older runs
        </button>
      </template>
    </template>
  </div>
</template>

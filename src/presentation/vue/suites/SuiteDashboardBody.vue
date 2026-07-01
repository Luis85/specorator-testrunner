<script setup lang="ts">
import { ref } from "vue";
import { useEventBus } from "../use-event-bus";
import ListHeader from "../ListHeader.vue";
import {
  projectSuiteRows,
  scenarioCountCell,
  type ScenarioCountCell,
} from "../../views/suite-rows";
import { suiteTarget } from "../../navigation/navigation-target";
import type { DomainEventType } from "../../../domain/events/domain-event";
import type { VaultPath } from "../../../domain/value-objects/identifiers";
import type { SuiteBodyDeps } from "./suite-body-deps";

const props = defineProps<{ deps: SuiteBodyDeps }>();

// Suite events refresh the list (US-024/025); Feature lifecycle events re-count
// the "Scenarios" column (a created/edited Feature changes what a Tag Expression
// matches). The same set the standalone leaf subscribed to.
const REFRESH_ON: DomainEventType[] = [
  "suite.created",
  "suite.updated",
  "suite.deleted",
  "specification.created",
  "specification.updated",
];

interface SuiteRowVM {
  id: string;
  name: string;
  tagExpression: string;
  path: VaultPath;
  cell: ScenarioCountCell;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; rows: SuiteRowVM[] };

const state = ref<ViewState>({ kind: "loading" });

// Loaded through useEventBus, whose RenderScheduler SERIALIZES loads — a burst of
// events collapses into one trailing load and no two loads overlap, so there is
// no stale-write race to guard here (unlike the user-triggered async actions).
async function load(): Promise<void> {
  const result = await props.deps.suiteService.findAll();
  if (!result.ok) {
    state.value = { kind: "error", message: result.error.message };
    return;
  }
  // Wave F: load + parse the Feature corpus ONCE, then count per suite
  // synchronously (the per-row variant was O(suites × features) I/O per render).
  const counter = await props.deps.featureInsight.scenarioCounter();
  const rows = projectSuiteRows(result.value).map((row) => ({
    ...row,
    cell: scenarioCountCell(counter.ok ? counter.value(row.tagExpression) : counter),
  }));
  state.value = { kind: "loaded", rows };
}

const { refresh } = useEventBus(props.deps.eventBus, REFRESH_ON, load);

const openSuite = (path: VaultPath): void => props.deps.navigate(suiteTarget(path));
const run = (id: string): void =>
  void props.deps.runLauncher.launch({ scope: "suite", target: id });
</script>

<template>
  <div>
    <ListHeader
      header-cls="e2e-test-hub-suite-header"
      title="Test Suites"
      action-label="New Test Suite"
      @action="deps.onCreate()"
    />

    <template v-if="state.kind === 'error'">
      <p>Could not load Test Suites: {{ state.message }}</p>
      <button class="mod-cta" aria-label="Retry loading the Test Suites" @click="refresh">
        Retry
      </button>
    </template>

    <p v-else-if="state.kind === 'loaded' && state.rows.length === 0">
      No Test Suites yet. Create one to get started.
    </p>

    <table v-else-if="state.kind === 'loaded'" class="e2e-test-hub-suite-table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">ID</th>
          <th scope="col">Tag Expression</th>
          <th scope="col">Scenarios</th>
          <th scope="col">Run</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in state.rows" :key="row.id">
          <td>
            <button
              class="e2e-test-hub-link-button"
              :aria-label="`Open Test Suite ${row.name}`"
              @click="openSuite(row.path)"
            >
              {{ row.name }}
            </button>
          </td>
          <td>{{ row.id }}</td>
          <td>{{ row.tagExpression }}</td>
          <td
            class="e2e-test-hub-suite-scenarios"
            :aria-label="row.cell.ariaLabel"
            :title="row.cell.tooltip ?? undefined"
            :data-status="row.cell.status ?? undefined"
          >
            {{ row.cell.text }}
          </td>
          <td>
            <button
              class="e2e-test-hub-run-button"
              :aria-label="`Run Test Suite ${row.name}`"
              @click="run(row.id)"
            >
              Run
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

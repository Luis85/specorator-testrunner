import { shallowRef, type Ref } from "vue";
import { useEventBus } from "../use-event-bus";
import { HUB_REFRESH_ON } from "../hub/hub-deps";
import type {
  DashboardSnapshot,
  TraceabilityService,
} from "../../../application/services/traceability-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";

/**
 * The shared state of a snapshot-derived Overview body (ADR-0033 Phase 3):
 * loading, `hidden` (the vault is not scaffolded), a retryable `error`, or the
 * `loaded` projection. Both the hero and the recent-runs body render the same
 * four kinds — differing only in what they draw for `hidden` (the hero's
 * Initialize CTA vs. recent-runs' nothing) and what they project into `value`.
 */
export type SnapshotState<T> =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; data: T };

/** The deps slice {@link useOverviewSnapshot} needs — a subset of both body deps. */
interface SnapshotDeps {
  isInitialized: () => Promise<boolean>;
  traceabilityService: Pick<TraceabilityService, "snapshot">;
  eventBus: EventBus;
}

/**
 * Loads the traceability snapshot behind the shared Overview gate + error
 * handling, projecting it via `project`, and stays live on the full hub refresh
 * set (the Overview bodies derive from the whole snapshot). The load clears to
 * `loading` synchronously before the awaits — the shared Phase 3 stale-clear
 * guard, so an event-driven refresh never leaves stale actions live.
 */
export function useOverviewSnapshot<T>(
  deps: SnapshotDeps,
  project: (snapshot: DashboardSnapshot) => Promise<T> | T,
): { state: Ref<SnapshotState<T>>; refresh: () => Promise<void> } {
  // shallowRef (not ref): the state is replaced wholesale each transition and
  // never nested-mutated, and it avoids ref's deep UnwrapRef of the generic T.
  const state = shallowRef<SnapshotState<T>>({ kind: "loading" });

  async function load(): Promise<void> {
    state.value = { kind: "loading" };
    if (!(await deps.isInitialized())) {
      state.value = { kind: "hidden" };
      return;
    }
    const result = await deps.traceabilityService.snapshot();
    if (!result.ok) {
      state.value = { kind: "error", message: result.error.message };
      return;
    }
    state.value = { kind: "loaded", data: await project(result.value) };
  }

  const binding = useEventBus(deps.eventBus, HUB_REFRESH_ON, load);
  return { state, refresh: () => binding.refresh() };
}

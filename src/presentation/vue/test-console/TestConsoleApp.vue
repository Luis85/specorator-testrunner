<script setup lang="ts">
/**
 * Live "Test Console" panel (US-030, UC-015), Vue rewrite (ADR-0033 Phase 4).
 * Subscribes to the `testrun.*` lifecycle and streams output as it arrives, then
 * shows the terminal status banner; a header toolbar lets a user cancel, re-run,
 * open evidence, and clear without leaving the panel.
 *
 * The reactive chrome (toolbar, banner, metadata line, live timer) lives here;
 * the high-frequency output stream is delegated to {@link ConsoleOutputStream},
 * which appends imperatively so a run of tens of thousands of lines never
 * re-renders a reactive list (the ADR gate). Bus subscription is MANUAL (not
 * `useEventBus`) because this view consumes a stream, not a reload — the generic
 * latest-only invalidation fits none of the Phase-4 interactive views.
 */
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { TEST_CONSOLE_DEPS } from "./test-console-deps";
import ConsoleOutputStream from "./ConsoleOutputStream.vue";
import Icon from "../Icon.vue";
import { vaultPath } from "../../../domain/value-objects/vault-path";
import type { TestRun, TestRunStatus } from "../../../domain/entities/test-run";
import type { DomainEvent } from "../../../domain/events/domain-event";
import type { VaultPath } from "../../../domain/value-objects/identifiers";
import type { Unsubscribe } from "../../../shared/event-bus/event-bus";
import { scopeLabel } from "../../run/run-launcher";
import {
  extractRunSummary,
  formatElapsed,
  formatStatusBanner,
  summaryHint,
} from "../../views/test-console-format";
import { pendingStepsTargetForRun } from "../../views/pending-steps-rows";

/** Subset of the `testrun.requested` payload — carries the scope/target label. */
interface RequestedPayload {
  scope: "use-case" | "feature" | "suite" | "all" | "demo";
  target: string;
}
/** Subset of the `testrun.started` payload the console needs (Event Catalog). */
interface StartedPayload {
  runId: string;
  command: string;
  workingDirectory: string;
}
/** Subset of the `testrun.output.received` payload (Event Catalog). */
interface OutputPayload {
  runId: string;
  stream: "stdout" | "stderr";
  line: string;
}
/** Subset of the `testrun.completed` payload (Event Catalog). */
interface CompletedPayload {
  runId: string;
  status: "passed" | "failed";
  durationMs: number;
}
/** Subset of the `evidence.generated` payload (Event Catalog §9). */
interface EvidenceGeneratedPayload {
  runId: string;
  evidencePath: string;
}

interface BannerVm {
  status: TestRunStatus;
  text: string;
  hint: string | null;
}

/** Live elapsed-timer tick interval (ms). */
const TIMER_TICK_MS = 1000;

const deps = inject(TEST_CONSOLE_DEPS)!;
const output = ref<InstanceType<typeof ConsoleOutputStream> | null>(null);

// Active-run state powering the toolbar + live metadata line. `runStartMs` drives
// the elapsed timer; `activeScopeLabel` is captured from `testrun.requested`
// (which carries scope/target, unlike `testrun.started`). `isActive` is set
// explicitly at the same points the hand-rolled view called refreshControls(),
// because the execution-service probes aren't reactive.
const isActive = ref(false);
const runStartMs = ref<number | null>(null);
const nowMs = ref(Date.now());
const activeScopeLabel = ref<string | null>(null);
const banner = ref<BannerVm | null>(null);
// Reactive snapshot of lastRun() — re-read whenever the toolbar/meta must
// recompute (open / start / terminal), mirroring refreshControls' probe reads.
const lastRunSnap = ref<TestRun | null>(null);
// Evidence note for the LAST run (Wave G §1): null until `evidence.generated`
// arrives for lastRun() (or the probe reports it on open), cleared when a new
// run starts. Drives the "Open evidence" toolbar button.
const evidencePath = ref<VaultPath | null>(null);
// Runner summary lines (Playwright counts, playwright-bdd's "Missing step
// definitions: N"), captured from the stream so the terminal banner shows the
// OUTCOME at the top instead of only "Run failed".
let summaryLines: string[] = [];

const subscriptions: Unsubscribe[] = [];
let timerHandle: number | null = null;

// ── derived toolbar / meta view-models ───────────────────────────────────────

const cancelReason = computed(() =>
  isActive.value ? "Cancel the active Test Run" : "No Test Run is in progress to cancel",
);
const rerunReason = computed(() => {
  if (isActive.value) return "A Test Run is in progress; re-run is available once it finishes";
  const last = lastRunSnap.value;
  return last === null
    ? "No Test Run to re-run yet"
    : `Re-run ${scopeLabel(last.scope, last.target)}`;
});
const evidenceReason = computed(() =>
  evidencePath.value !== null
    ? "Open the evidence note for the last Test Run"
    : "No evidence for the last run yet",
);
const rerunDisabled = computed(() => isActive.value || lastRunSnap.value === null);

// The metadata line: running (scope + live elapsed) / idle (last outcome) /
// empty. Reads `nowMs`, bumped each second by the timer, so elapsed ticks.
const meta = computed<{ text: string; status: string | null }>(() => {
  if (isActive.value) {
    const label = activeScopeLabel.value ?? "Test Run";
    const elapsed = formatElapsed(nowMs.value - (runStartMs.value ?? nowMs.value));
    return { text: `Running ${label} · ${elapsed}`, status: "running" };
  }
  const last = lastRunSnap.value;
  if (last !== null) {
    const when = last.finishedAt ?? last.startedAt;
    return {
      text: `Last run: ${scopeLabel(last.scope, last.target)} — ${last.status} (${formatWhen(when)})`,
      status: last.status,
    };
  }
  return {
    text: "No Test Run yet. Start one from a Test Suite, Use Case, or the run commands.",
    status: null,
  };
});

// ── banner ───────────────────────────────────────────────────────────────────

const setBanner = (status: TestRunStatus, durationMs?: number): void => {
  const headline = formatStatusBanner(status, durationMs);
  // On a terminal state, append the runner's own counts so the WHY is readable
  // at the top ("Run failed (0.3s) — 1 failed, Missing step definitions: 2"),
  // plus an actionable hint when steps are missing.
  const isTerminal = status !== "running" && status !== "queued";
  const summary = isTerminal && summaryLines.length > 0 ? summaryLines : [];
  banner.value = {
    status,
    text: summary.length > 0 ? `${headline} — ${summary.join(", ")}` : headline,
    hint: isTerminal ? summaryHint(summary) : null,
  };
};

// ── bus handlers ─────────────────────────────────────────────────────────────

const onRequested = (event: DomainEvent<RequestedPayload>): void => {
  // `testrun.requested` fires just before `testrun.started` and is the only run
  // event carrying scope/target, so capture the label for the metadata line.
  activeScopeLabel.value = scopeLabel(event.payload.scope, event.payload.target);
};

const onStarted = (event: DomainEvent<StartedPayload>): void => {
  output.value?.clear();
  // A new run owns the console now — the previous run's evidence is stale for
  // the "Open evidence" affordance (it is about the LAST run).
  evidencePath.value = null;
  summaryLines = [];
  runStartMs.value = Date.now();
  nowMs.value = Date.now();
  isActive.value = true;
  setBanner("running");
  output.value?.appendCommand(event.payload.command);
  startTimer();
  lastRunSnap.value = deps.lastRun();
};

const onOutputReceived = (event: DomainEvent<OutputPayload>): void => {
  const summary = extractRunSummary(event.payload.line);
  if (summary !== null) summaryLines.push(summary);
  output.value?.appendLine(event.payload.stream, event.payload.line);
};

const onTerminal = (status: TestRunStatus, durationMs?: number): void => {
  stopTimer();
  runStartMs.value = null;
  activeScopeLabel.value = null;
  // The terminal event IS the "run is over" signal: force idle even though the
  // in-process bus is still synchronously publishing (execute()'s finally hasn't
  // cleared the run slot yet, so activeRunId() would still report this run and
  // wrongly leave the toolbar stuck "running").
  isActive.value = false;
  setBanner(status, durationMs);
  lastRunSnap.value = deps.lastRun();
};

/**
 * Wave G §1: `evidence.generated` for the LAST run enables the "Open evidence"
 * button. The payload's runId is matched against `lastRun()` so an on-demand
 * re-import of an older run can't be attributed to the latest one.
 */
const onEvidenceGenerated = (event: DomainEvent<EvidenceGeneratedPayload>): void => {
  if (event.payload.runId !== deps.lastRun()?.id) return;
  // The payload travels as a plain string; re-validate through the ADR-0008
  // vaultPath() chokepoint before it can reach the workspace opener.
  const safe = vaultPath(event.payload.evidencePath);
  if (safe.ok) evidencePath.value = safe.value;
};

// ── toolbar actions ──────────────────────────────────────────────────────────

const onCancel = (): void => void deps.runLauncher.cancel();
const onRerun = (): void => {
  const last = deps.lastRun();
  if (last === null) return;
  void deps.runLauncher.launch({ scope: last.scope, target: last.target });
};
const onOpenEvidence = (): void => {
  const path = evidencePath.value;
  if (path !== null) void deps.openEvidence(path);
};
const onClear = (): void => output.value?.clear();

// WS1/C2: the missing-steps hint's action — open the Pending Steps companion
// targeted at the finished run's scope (a use-case / feature run points the
// panel at that scope; suite/all/demo runs span features, so they open the
// vault-wide listing), falling back to vault-wide when no run has finished yet.
const openPendingSteps = (): void => {
  const last = lastRunSnap.value;
  deps.openPendingSteps(
    last === null ? { kind: "vault" } : pendingStepsTargetForRun(last.scope, last.target),
  );
};

// ── timer ────────────────────────────────────────────────────────────────────

const startTimer = (): void => {
  if (timerHandle !== null) return;
  timerHandle = window.setInterval(() => {
    if (runStartMs.value !== null) nowMs.value = Date.now();
  }, TIMER_TICK_MS);
};
const stopTimer = (): void => {
  if (timerHandle === null) return;
  window.clearInterval(timerHandle);
  timerHandle = null;
};

// ── lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  subscriptions.push(
    deps.eventBus.subscribe<RequestedPayload>("testrun.requested", onRequested),
    deps.eventBus.subscribe<StartedPayload>("testrun.started", onStarted),
    deps.eventBus.subscribe<OutputPayload>("testrun.output.received", onOutputReceived),
    deps.eventBus.subscribe<CompletedPayload>("testrun.completed", (event) =>
      onTerminal(event.payload.status, event.payload.durationMs),
    ),
    deps.eventBus.subscribe("testrun.failed", () => onTerminal("errored")),
    deps.eventBus.subscribe("testrun.cancelled", () => onTerminal("cancelled")),
    deps.eventBus.subscribe<EvidenceGeneratedPayload>("evidence.generated", onEvidenceGenerated),
  );

  lastRunSnap.value = deps.lastRun();
  const activeRunId = deps.activeRunId();
  // The console may open after the last run's evidence was already generated (the
  // bus does not replay `evidence.generated`): seed the button from the probe.
  // Skipped while a run is active — its evidence doesn't exist yet, and the probe
  // would report a PREVIOUS run's note.
  if (activeRunId === null) syncEvidenceFromProbe();

  // A run may already be in flight when the console opens mid-run: reflect it
  // now (the events already fired and the bus does not replay). The elapsed timer
  // seeds from the run's REAL start time.
  if (activeRunId !== null) {
    const startedAt = deps.activeRunStartedAt();
    const startedMs = startedAt !== null ? new Date(startedAt).getTime() : NaN;
    runStartMs.value = Number.isNaN(startedMs) ? Date.now() : startedMs;
    nowMs.value = Date.now();
    isActive.value = true;
    setBanner("running");
    startTimer();
  }
});

onUnmounted(() => {
  for (const unsubscribe of subscriptions) unsubscribe();
  subscriptions.length = 0;
  stopTimer();
});

/**
 * Seeds {@link evidencePath} from the synchronous lastEvidence() probe — for a
 * console opened AFTER the last run's `evidence.generated` already fired. The
 * recorded runId must match the last run, so a previous run's note is never
 * offered for the latest run.
 */
function syncEvidenceFromProbe(): void {
  const last = deps.lastRun();
  const evidence = deps.lastEvidence();
  evidencePath.value =
    last !== null && evidence !== null && evidence.runId === last.id ? evidence.evidencePath : null;
}

/** Localized timestamp for the idle metadata line. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
</script>

<template>
  <div class="e2e-test-hub-console">
    <h2>Test Console</h2>

    <div class="e2e-test-hub-console-toolbar">
      <button
        class="e2e-test-hub-console-action mod-warning"
        :disabled="!isActive"
        :aria-label="cancelReason"
        :title="cancelReason"
        @click="onCancel"
      >
        <Icon name="square" class="e2e-test-hub-console-action-icon" />
        <span>Cancel run</span>
      </button>
      <button
        class="e2e-test-hub-console-action"
        :disabled="rerunDisabled"
        :aria-label="rerunReason"
        :title="rerunReason"
        @click="onRerun"
      >
        <Icon name="rotate-ccw" class="e2e-test-hub-console-action-icon" />
        <span>Re-run</span>
      </button>
      <button
        class="e2e-test-hub-console-action"
        :disabled="evidencePath === null"
        :aria-label="evidenceReason"
        :title="evidenceReason"
        @click="onOpenEvidence"
      >
        <Icon name="file-text" class="e2e-test-hub-console-action-icon" />
        <span>Open evidence</span>
      </button>
      <button
        class="e2e-test-hub-console-action"
        aria-label="Clear the Test Console output"
        title="Clear the Test Console output"
        @click="onClear"
      >
        <Icon name="eraser" class="e2e-test-hub-console-action-icon" />
        <span>Clear</span>
      </button>
    </div>

    <div
      class="e2e-test-hub-console-meta"
      aria-live="polite"
      :data-status="meta.status ?? undefined"
    >
      {{ meta.text }}
    </div>

    <div class="spec-banner" aria-live="polite" :data-status="banner?.status">
      <template v-if="banner">
        <div>{{ banner.text }}</div>
        <div v-if="banner.hint" class="e2e-test-hub-console-banner-hint">
          {{ banner.hint }}
          <button aria-label="Open pending steps" @click="openPendingSteps">
            Open pending steps
          </button>
        </div>
      </template>
    </div>

    <ConsoleOutputStream ref="output" />
  </div>
</template>

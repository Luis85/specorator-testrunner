// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import RecentRunsBody from "../../src/presentation/vue/overview/RecentRunsBody.vue";
import type { RecentRunsBodyDeps } from "../../src/presentation/vue/overview/overview-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { hangingReload } from "./hanging-reload";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { DashboardSnapshot } from "../../src/application/services/traceability-service";
import type { TestRunSummary } from "../../src/domain/entities/test-run";
import type { VaultPath } from "../../src/domain/value-objects/identifiers";

const run = (over: Partial<TestRunSummary> = {}): TestRunSummary => ({
  runId: "run-1",
  status: "passed",
  date: "2026-05-31",
  evidencePath: "Evidence/2026/05/run-1/summary.md" as VaultPath,
  ...over,
});

const snapshot = (recentRuns: TestRunSummary[]): DashboardSnapshot => ({
  totalUseCases: 1,
  specifiedUseCases: 1,
  automatedUseCases: 1,
  passingUseCases: 1,
  failingUseCases: 0,
  recentRuns,
});

const ok = (recentRuns: TestRunSummary[]) => ({ ok: true, value: snapshot(recentRuns) });

function makeDeps(
  over: Partial<Record<keyof RecentRunsBodyDeps, unknown>> = {},
): RecentRunsBodyDeps {
  return {
    traceabilityService: { snapshot: vi.fn().mockResolvedValue(ok([run()])) },
    isInitialized: vi.fn().mockResolvedValue(true),
    openEvidence: vi.fn(),
    openEvidenceExplorer: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as RecentRunsBodyDeps;
}

const mountBody = (deps: RecentRunsBodyDeps) => mount(RecentRunsBody, { props: { deps } });

describe("RecentRunsBody", () => {
  it("renders nothing on an un-scaffolded vault (the slot collapses)", async () => {
    const deps = makeDeps({ isInitialized: vi.fn().mockResolvedValue(false) });
    const w = mountBody(deps);
    await flushPromises();
    // The root v-if is false → only a comment renders, so the enclosing slot is
    // :empty and hides.
    expect(w.find("h3").exists()).toBe(false);
    expect(w.find("table").exists()).toBe(false);
  });

  it("renders the run table and View-all link when there are runs", async () => {
    const w = mountBody(makeDeps());
    await flushPromises();
    expect(w.get("h3").text()).toBe("Recent runs");
    expect(w.findAll("tbody tr")).toHaveLength(1);
    expect(
      w.find('button[aria-label="Open the Evidence Explorer with the full run history"]').exists(),
    ).toBe(true);
  });

  it("shows the empty-runs message when initialized but no runs", async () => {
    const deps = makeDeps({ traceabilityService: { snapshot: vi.fn().mockResolvedValue(ok([])) } });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.get("h3").text()).toBe("Recent runs");
    expect(w.text()).toContain("No Test Runs yet");
    expect(w.find("table").exists()).toBe(false);
  });

  it("renders a retryable error when the snapshot load fails", async () => {
    const snap = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } })
      .mockResolvedValue(ok([run()]));
    const w = mountBody(makeDeps({ traceabilityService: { snapshot: snap } }));
    await flushPromises();
    expect(w.text()).toContain("Could not load recent runs: boom");
    await w.get('button[aria-label="Retry loading recent runs"]').trigger("click");
    await flushPromises();
    expect(w.find("table").exists()).toBe(true);
  });

  it("opens evidence from a navigable row and its id link", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get("tbody tr .e2e-test-hub-link-button").trigger("click");
    expect(deps.openEvidence).toHaveBeenCalledWith("Evidence/2026/05/run-1/summary.md");
  });

  it("renders an inert row (no link, tooltip) for a run without evidence", async () => {
    const deps = makeDeps({
      traceabilityService: {
        snapshot: vi.fn().mockResolvedValue(ok([run({ runId: "run-x", evidencePath: undefined })])),
      },
    });
    const w = mountBody(deps);
    await flushPromises();
    const row = w.get("tbody tr");
    expect(row.classes()).not.toContain("is-navigable");
    expect(row.find(".e2e-test-hub-link-button").exists()).toBe(false);
    expect(row.attributes("title")).toContain("No evidence note");
  });

  it("opens the full history explorer from View all runs", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w
      .get('button[aria-label="Open the Evidence Explorer with the full run history"]')
      .trigger("click");
    expect(deps.openEvidenceExplorer).toHaveBeenCalledOnce();
  });

  it("reloads on a hub refresh event via useEventBus", async () => {
    const bus = new InMemoryEventBus();
    const snap = vi.fn().mockResolvedValue(ok([run()]));
    mountBody(makeDeps({ eventBus: bus, traceabilityService: { snapshot: snap } }));
    await flushPromises();
    expect(snap).toHaveBeenCalledOnce();
    void bus.publish({ type: "evidence.generated" } as unknown as DomainEvent);
    await flushPromises();
    expect(snap).toHaveBeenCalledTimes(2);
  });

  it("clears stale rows before a slow refresh finishes", async () => {
    const bus = new InMemoryEventBus();
    const { fn: snap, release } = hangingReload(ok([run()]), ok([]));
    const w = mountBody(makeDeps({ eventBus: bus, traceabilityService: { snapshot: snap } }));
    await flushPromises();
    expect(w.findAll("tbody tr")).toHaveLength(1);

    void bus.publish({ type: "evidence.generated" } as unknown as DomainEvent);
    await flushPromises();
    // The whole body collapses (root v-if false) during the reload.
    expect(w.find("h3").exists()).toBe(false);

    release();
    await flushPromises();
    expect(w.text()).toContain("No Test Runs yet");
  });
});

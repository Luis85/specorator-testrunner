// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import EvidenceExplorerBody from "../../src/presentation/vue/evidence/EvidenceExplorerBody.vue";
import type { EvidenceBodyDeps } from "../../src/presentation/vue/evidence/evidence-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { hangingReload } from "./hanging-reload";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { RunHistoryEntry } from "../../src/application/services/run-history-service";

const entry = (over: Partial<RunHistoryEntry> = {}): RunHistoryEntry =>
  ({
    runId: "run-1",
    evidencePath: "Evidence/2026/05/run-1/summary.md",
    year: "2026",
    month: "05",
    status: "passed",
    passed: 3,
    failed: 0,
    total: 3,
    createdAt: "2026-05-31T10:05:00.000Z",
    scope: "suite",
    target: "smoke",
    ...over,
  }) as RunHistoryEntry;

const pass = entry();
const fail = entry({ runId: "run-2", status: "failed", passed: 1, failed: 2, total: 3 });

const page = (entries: RunHistoryEntry[], hasMore = false) => ({
  ok: true,
  value: { entries, hasMore },
});

function makeDeps(over: Partial<Record<keyof EvidenceBodyDeps, unknown>> = {}): EvidenceBodyDeps {
  return {
    runHistory: {
      list: vi.fn().mockResolvedValue(page([pass, fail])),
      findByRunId: vi.fn(),
    },
    navigate: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as EvidenceBodyDeps;
}

const mountBody = (deps: EvidenceBodyDeps, props: Record<string, unknown> = {}) =>
  mount(EvidenceExplorerBody, { props: { deps, ...props } });

describe("EvidenceExplorerBody", () => {
  it("loads and renders the month-grouped run rows", async () => {
    const w = mountBody(makeDeps());
    await flushPromises();
    expect(w.get("h2").text()).toBe("Evidence Explorer");
    expect(w.get("h3").text()).toBe("2026 / 05");
    expect(w.findAll("tbody tr")).toHaveLength(2);
    expect(w.find(".e2e-test-hub-evidence-toolbar").exists()).toBe(true);
  });

  it("renders the empty state when there is no history", async () => {
    const deps = makeDeps({
      runHistory: { list: vi.fn().mockResolvedValue(page([])), findByRunId: vi.fn() },
    });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.text()).toContain("No Test Runs yet");
    expect(w.find(".e2e-test-hub-evidence-toolbar").exists()).toBe(false);
  });

  it("renders a retryable error when the load fails", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } })
      .mockResolvedValue(page([pass]));
    const w = mountBody(makeDeps({ runHistory: { list, findByRunId: vi.fn() } }));
    await flushPromises();
    expect(w.text()).toContain("Could not load run history: boom");
    await w.get('button[aria-label="Retry loading the run history"]').trigger("click");
    await flushPromises();
    expect(w.find("tbody tr").exists()).toBe(true);
  });

  it("filters client-side on a select change WITHOUT reloading (uncontrolled)", async () => {
    const list = vi.fn().mockResolvedValue(page([pass, fail]));
    const w = mountBody(makeDeps({ runHistory: { list, findByRunId: vi.fn() } }));
    await flushPromises();
    expect(w.findAll("tbody tr")).toHaveLength(2);
    expect(list).toHaveBeenCalledOnce();

    await w.get("select").setValue("failed");
    // Re-groups from the loaded entries — no reload.
    expect(list).toHaveBeenCalledOnce();
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("run-2");
  });

  it("shows the filtered-empty message when a filter matches nothing", async () => {
    // A single passing run, filtered to "failed" → no groups, but the toolbar
    // stays so the user can clear the filter.
    const deps = makeDeps({
      runHistory: { list: vi.fn().mockResolvedValue(page([pass])), findByRunId: vi.fn() },
    });
    const w = mountBody(deps, { filter: "failed" });
    await flushPromises();
    expect(w.text()).toContain('No loaded runs with status "failed"');
    expect(w.find("tbody tr").exists()).toBe(false);
    expect(w.find(".e2e-test-hub-evidence-toolbar").exists()).toBe(true);
  });

  it("reloads with a larger page on Load older (uncontrolled)", async () => {
    const list = vi.fn().mockResolvedValue(page([pass, fail], true));
    const w = mountBody(makeDeps({ runHistory: { list, findByRunId: vi.fn() } }));
    await flushPromises();
    expect(list).toHaveBeenCalledWith({ offset: 0, limit: 50 });

    await w.get('button[aria-label="Load older runs"]').trigger("click");
    await flushPromises();
    // A paging change re-fetches with the extended limit.
    expect(list).toHaveBeenCalledWith({ offset: 0, limit: 100 });
  });

  it("uses the controlled filter/limit props and callbacks (hub)", async () => {
    const onFilterChange = vi.fn();
    const onLoadOlder = vi.fn();
    const w = mountBody(
      makeDeps({
        runHistory: {
          list: vi.fn().mockResolvedValue(page([pass, fail], true)),
          findByRunId: vi.fn(),
        },
      }),
      {
        filter: "failed",
        visibleLimit: 50,
        onFilterChange,
        onLoadOlder,
      },
    );
    await flushPromises();
    // Controlled filter scopes to the failed row.
    expect(w.findAll("tbody tr")).toHaveLength(1);

    await w.get("select").setValue("passed");
    expect(onFilterChange).toHaveBeenCalledWith("passed");
    await w.get('button[aria-label="Load older runs"]').trigger("click");
    expect(onLoadOlder).toHaveBeenCalledOnce();
  });

  it("reloads when the controlled visibleLimit prop changes", async () => {
    const list = vi.fn().mockResolvedValue(page([pass], true));
    const w = mountBody(makeDeps({ runHistory: { list, findByRunId: vi.fn() } }), {
      visibleLimit: 50,
    });
    await flushPromises();
    expect(list).toHaveBeenCalledWith({ offset: 0, limit: 50 });
    await w.setProps({ visibleLimit: 100 });
    await flushPromises();
    expect(list).toHaveBeenCalledWith({ offset: 0, limit: 100 });
  });

  it("navigates to a run from the row and its id link", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get("tbody tr .e2e-test-hub-link-button").trigger("click");
    expect(deps.navigate).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }));
  });

  it("reloads on evidence.generated via useEventBus", async () => {
    const bus = new InMemoryEventBus();
    const list = vi.fn().mockResolvedValue(page([pass]));
    mountBody(makeDeps({ eventBus: bus, runHistory: { list, findByRunId: vi.fn() } }));
    await flushPromises();
    expect(list).toHaveBeenCalledOnce();
    void bus.publish({ type: "evidence.generated" } as unknown as DomainEvent);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("clears stale rows before a slow refresh finishes", async () => {
    const bus = new InMemoryEventBus();
    const { fn: list, release } = hangingReload(page([pass, fail]), page([]));
    const w = mountBody(makeDeps({ eventBus: bus, runHistory: { list, findByRunId: vi.fn() } }));
    await flushPromises();
    expect(w.findAll("tbody tr")).toHaveLength(2);

    void bus.publish({ type: "evidence.generated" } as unknown as DomainEvent);
    await flushPromises();
    expect(w.find("tbody tr").exists()).toBe(false);
    // The header stays through the load.
    expect(w.get("h2").text()).toBe("Evidence Explorer");

    release();
    await flushPromises();
    expect(w.text()).toContain("No Test Runs yet");
  });
});

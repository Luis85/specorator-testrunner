// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import UseCaseDashboardBody from "../../src/presentation/vue/use-cases/UseCaseDashboardBody.vue";
import type { UseCaseBodyDeps } from "../../src/presentation/vue/use-cases/use-case-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { hangingReload } from "./hanging-reload";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { UseCase } from "../../src/domain/entities/use-case";

const uc = (over: Partial<UseCase> = {}): UseCase =>
  ({
    id: "UC-001",
    title: "Login",
    status: "active",
    automationStatus: "passing",
    featureFiles: [],
    suites: [],
    evidence: [],
    path: "UseCases/UC-001/UC-001.md",
    ...over,
  }) as UseCase;

const passing = uc();
const failing = uc({ id: "UC-002", title: "Logout", automationStatus: "failing" });

function makeDeps(over: Partial<Record<keyof UseCaseBodyDeps, unknown>> = {}): UseCaseBodyDeps {
  return {
    traceability: { deriveAll: vi.fn().mockResolvedValue({ ok: true, value: [passing, failing] }) },
    specificationService: { listFeatures: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    workspace: { openFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }) },
    runLauncher: { launch: vi.fn().mockResolvedValue(undefined) },
    onCreate: vi.fn(),
    onOpenDetail: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as UseCaseBodyDeps;
}

const mountBody = (deps: UseCaseBodyDeps, props: Record<string, unknown> = {}) =>
  mount(UseCaseDashboardBody, { props: { deps, ...props } });

describe("UseCaseDashboardBody", () => {
  it("loads and renders every row with no filter (no chip)", async () => {
    const w = mountBody(makeDeps());
    await flushPromises();
    expect(w.findAll("tbody tr")).toHaveLength(2);
    expect(w.find(".e2e-test-hub-uc-filter").exists()).toBe(false);
  });

  it("renders the empty state when there are no Use Cases", async () => {
    const deps = makeDeps({
      traceability: { deriveAll: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.text()).toContain("No Use Cases yet");
  });

  it("renders a retryable error when the load fails", async () => {
    const deriveAll = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } })
      .mockResolvedValue({ ok: true, value: [passing] });
    const w = mountBody(makeDeps({ traceability: { deriveAll } }));
    await flushPromises();
    expect(w.text()).toContain("Could not load Use Cases: boom");
    await w.get('button[aria-label="Retry loading the Use Cases"]').trigger("click");
    await flushPromises();
    expect(w.find("tbody tr").exists()).toBe(true);
  });

  it("scopes rows to the KPI filter and shows a clear-able chip", async () => {
    const clearFilter = vi.fn();
    const w = mountBody(makeDeps(), { filter: "passing", clearFilter });
    await flushPromises();
    // Only the passing UC-001 survives the filter.
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("UC-001");
    expect(w.get(".e2e-test-hub-uc-filter-label").text()).toBe("Passing Use Cases");
    await w.get(".e2e-test-hub-uc-filter-clear").trigger("click");
    expect(clearFilter).toHaveBeenCalledOnce();
  });

  it("re-filters reactively on a filter prop change WITHOUT reloading", async () => {
    const deriveAll = vi.fn().mockResolvedValue({ ok: true, value: [passing, failing] });
    const w = mountBody(makeDeps({ traceability: { deriveAll } }), { filter: "all" });
    await flushPromises();
    expect(w.findAll("tbody tr")).toHaveLength(2);
    expect(deriveAll).toHaveBeenCalledOnce();

    await w.setProps({ filter: "failing" });
    // No reload — the visible rows re-derive from the already-loaded set.
    expect(deriveAll).toHaveBeenCalledOnce();
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("UC-002");
  });

  it("shows the filtered-empty message when a filter matches nothing", async () => {
    const deriveAll = vi.fn().mockResolvedValue({ ok: true, value: [failing] });
    const w = mountBody(makeDeps({ traceability: { deriveAll } }), { filter: "passing" });
    await flushPromises();
    expect(w.text()).toContain("No Use Cases match the passing filter");
    expect(w.find("tbody tr").exists()).toBe(false);
    // The chip is still shown so the user can clear it.
    expect(w.find(".e2e-test-hub-uc-filter").exists()).toBe(true);
  });

  it("opens detail, note, and launches a run from the row controls", async () => {
    const openFile = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const deps = makeDeps({
      traceability: { deriveAll: vi.fn().mockResolvedValue({ ok: true, value: [passing] }) },
      workspace: { openFile },
    });
    const w = mountBody(deps);
    await flushPromises();
    await w.get('button[aria-label="Open Use Case UC-001 detail"]').trigger("click");
    expect(deps.onOpenDetail).toHaveBeenCalledWith("UC-001");
    await w.get('button[aria-label="Open the UC-001 note"]').trigger("click");
    expect(openFile).toHaveBeenCalledWith("UseCases/UC-001/UC-001.md");
    await w.get('button[aria-label="Run Use Case UC-001"]').trigger("click");
    expect(deps.runLauncher.launch).toHaveBeenCalledWith({ scope: "use-case", target: "UC-001" });
  });

  it("reloads on a use-case event via useEventBus", async () => {
    const bus = new InMemoryEventBus();
    const deriveAll = vi.fn().mockResolvedValue({ ok: true, value: [passing] });
    mountBody(
      makeDeps({
        eventBus: bus,
        traceability: { deriveAll },
      }),
    );
    await flushPromises();
    expect(deriveAll).toHaveBeenCalledOnce();
    void bus.publish({ type: "scenario.history.recorded" } as unknown as DomainEvent);
    await flushPromises();
    expect(deriveAll).toHaveBeenCalledTimes(2);
  });

  it("clears stale rows before a slow refresh finishes", async () => {
    const bus = new InMemoryEventBus();
    const { fn: deriveAll, release } = hangingReload(
      { ok: true, value: [passing, failing] },
      { ok: true, value: [] },
    );
    const w = mountBody(makeDeps({ eventBus: bus, traceability: { deriveAll } }));
    await flushPromises();
    expect(w.findAll("tbody tr")).toHaveLength(2);

    void bus.publish({ type: "usecase.deleted" } as unknown as DomainEvent);
    await flushPromises();
    expect(w.find("tbody tr").exists()).toBe(false);

    release();
    await flushPromises();
    expect(w.text()).toContain("No Use Cases yet");
  });
});

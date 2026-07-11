// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import SuiteDashboardBody from "../../src/presentation/vue/suites/SuiteDashboardBody.vue";
import type { SuiteBodyDeps } from "../../src/presentation/vue/suites/suite-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { hangingReload } from "./hanging-reload";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { VaultPath } from "../../src/domain/value-objects/identifiers";

const suite = (over: Partial<{ id: string; name: string; tagExpression: string }> = {}) => ({
  id: "SUITE-001",
  name: "Smoke",
  tagExpression: "@smoke",
  path: "Suites/smoke.md" as VaultPath,
  ...over,
});

// scenarioCounter() resolves to a Result whose `value` is a per-expression
// counter function, so map a fixed count regardless of the expression.
const counter = (count: number) => ({
  ok: true as const,
  value: () => ({ ok: true, value: count }),
});

function makeDeps(over: Partial<Record<keyof SuiteBodyDeps, unknown>> = {}): SuiteBodyDeps {
  return {
    suiteService: { findAll: vi.fn().mockResolvedValue({ ok: true, value: [suite()] }) },
    featureInsight: { scenarioCounter: vi.fn().mockResolvedValue(counter(4)) },
    runLauncher: { launch: vi.fn().mockResolvedValue(undefined) },
    onCreate: vi.fn(),
    navigate: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as SuiteBodyDeps;
}

const mountBody = (deps: SuiteBodyDeps) => mount(SuiteDashboardBody, { props: { deps } });

// A mounted body wired to a caller-held bus + a fresh findAll spy, so the
// subscribe/unsubscribe tests can assert on reload counts and drive events.
function mountWithBus() {
  const bus = new InMemoryEventBus();
  const findAll = vi.fn().mockResolvedValue({ ok: true, value: [suite()] });
  const w = mountBody(makeDeps({ eventBus: bus, suiteService: { findAll } }));
  return { bus, findAll, w };
}

describe("SuiteDashboardBody", () => {
  it("loads and renders a suite row with its scenario count", async () => {
    const findAll = vi.fn().mockResolvedValue({ ok: true, value: [suite()] });
    const deps = makeDeps({ suiteService: { findAll } });
    const w = mountBody(deps);
    await flushPromises();

    expect(findAll).toHaveBeenCalledOnce();
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("Smoke");
    expect(rows[0].text()).toContain("@smoke");
    expect(w.get(".e2e-test-hub-suite-scenarios").text()).toBe("4");
  });

  it("renders the empty state when there are no suites", async () => {
    const deps = makeDeps({
      suiteService: { findAll: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.text()).toContain("No Test Suites yet");
    expect(w.find("tbody tr").exists()).toBe(false);
  });

  it("renders a retryable error when the load fails", async () => {
    const deps = makeDeps({
      suiteService: {
        findAll: vi.fn().mockResolvedValue({ ok: false, error: { message: "boom" } }),
      },
    });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.text()).toContain("Could not load Test Suites: boom");

    // Retry re-runs the load; a now-successful findAll surfaces the row.
    (deps.suiteService.findAll as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: [suite()],
    });
    await w.get('button[aria-label="Retry loading the Test Suites"]').trigger("click");
    await flushPromises();
    expect(w.find("tbody tr").exists()).toBe(true);
  });

  it("fires the header create action", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get(".e2e-test-hub-suite-header button").trigger("click");
    expect(deps.onCreate).toHaveBeenCalledOnce();
  });

  it("navigates to a suite by its path when its name is clicked", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get(".e2e-test-hub-link-button").trigger("click");
    expect(deps.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "Suites/smoke.md" }),
    );
  });

  it("launches a suite-scoped run from the row Run button", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get(".e2e-test-hub-run-button").trigger("click");
    expect(deps.runLauncher.launch).toHaveBeenCalledWith({ scope: "suite", target: "SUITE-001" });
  });

  it("reloads on a suite event via useEventBus", async () => {
    const { bus, findAll, w } = mountWithBus();
    await flushPromises();
    expect(findAll).toHaveBeenCalledOnce();

    void bus.publish({ type: "suite.created" } as unknown as DomainEvent);
    await flushPromises();
    expect(findAll).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  it("clears stale rows before a slow refresh finishes (no acting on a deleted suite)", async () => {
    const bus = new InMemoryEventBus();
    // First load resolves immediately; the refresh load hangs so we can inspect
    // the interim state while findAll() is still pending.
    const { fn: findAll, release: releaseReload } = hangingReload(
      { ok: true, value: [suite()] },
      { ok: true, value: [] },
    );
    const w = mountBody(makeDeps({ eventBus: bus, suiteService: { findAll } }));
    await flushPromises();
    expect(w.findAll("tbody tr")).toHaveLength(1); // loaded

    // A refresh event kicks off the (hanging) reload. The stale row and its
    // Open/Run buttons must be gone BEFORE the reads finish.
    void bus.publish({ type: "suite.deleted" } as unknown as DomainEvent);
    // flushPromises runs the scheduled load up to its hanging findAll() — far
    // enough to set the loading state, not far enough to complete the reload.
    await flushPromises();
    await nextTick();
    expect(w.find("tbody tr").exists()).toBe(false);
    expect(w.find(".e2e-test-hub-run-button").exists()).toBe(false);
    // The header stays (identical to the imperative renderer's pre-await gap).
    expect(w.find(".e2e-test-hub-suite-header").exists()).toBe(true);

    releaseReload();
    await flushPromises();
    expect(w.text()).toContain("No Test Suites yet");
    w.unmount();
  });

  it("stops reloading after unmount (subscription dropped)", async () => {
    const { bus, findAll, w } = mountWithBus();
    await flushPromises();
    w.unmount();

    void bus.publish({ type: "suite.created" } as unknown as DomainEvent);
    await flushPromises();
    expect(findAll).toHaveBeenCalledOnce();
  });
});

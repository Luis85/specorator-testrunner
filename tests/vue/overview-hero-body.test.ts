// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import OverviewHeroBody from "../../src/presentation/vue/overview/OverviewHeroBody.vue";
import type { HeroBodyDeps } from "../../src/presentation/vue/overview/overview-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { DashboardSnapshot } from "../../src/application/services/traceability-service";

const snapshot = (over: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  totalUseCases: 4,
  specifiedUseCases: 3,
  automatedUseCases: 2,
  passingUseCases: 1,
  failingUseCases: 1,
  recentRuns: [],
  ...over,
});

function makeDeps(over: Partial<Record<keyof HeroBodyDeps, unknown>> = {}): HeroBodyDeps {
  return {
    traceabilityService: { snapshot: vi.fn().mockResolvedValue({ ok: true, value: snapshot() }) },
    executionLogService: { latest: vi.fn().mockResolvedValue(null) },
    isInitialized: vi.fn().mockResolvedValue(true),
    openWizard: vi.fn(),
    openCreateUseCase: vi.fn(),
    runAll: vi.fn(),
    navigate: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as HeroBodyDeps;
}

const mountBody = (deps: HeroBodyDeps) => mount(OverviewHeroBody, { props: { deps } });

describe("OverviewHeroBody", () => {
  it("shows the Initialize CTA on an un-scaffolded vault", async () => {
    const deps = makeDeps({ isInitialized: vi.fn().mockResolvedValue(false) });
    const w = mountBody(deps);
    await flushPromises();
    await w.get('button[aria-label="Initialize the Test Hub"]').trigger("click");
    expect(deps.openWizard).toHaveBeenCalledOnce();
    expect(w.find(".spec-hub-hero").exists()).toBe(false);
  });

  it("renders the pass-rate ring, verdict, and funnel tiles when initialized", async () => {
    const w = mountBody(makeDeps());
    await flushPromises();
    // passing 1 / automated 2 = 50%.
    expect(w.get(".spec-hub-hero-percent").text()).toBe("50%");
    expect(w.get(".spec-hub-hero-ring").attributes("style")).toContain("--spec-hero-rate: 50");
    expect(w.findAll(".spec-hub-funnel-tile")).toHaveLength(5);
  });

  it("hides the ring on the no-rate empty state", async () => {
    const w = mountBody(
      makeDeps({
        traceabilityService: {
          snapshot: vi
            .fn()
            .mockResolvedValue({ ok: true, value: snapshot({ automatedUseCases: 0 }) }),
        },
      }),
    );
    await flushPromises();
    expect(w.find(".spec-hub-hero-ring").exists()).toBe(false);
    expect(w.find(".spec-hub-hero-empty").exists()).toBe(true);
  });

  it("renders a retryable error when the snapshot load fails", async () => {
    const snap = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } })
      .mockResolvedValue({ ok: true, value: snapshot() });
    const w = mountBody(makeDeps({ traceabilityService: { snapshot: snap } }));
    await flushPromises();
    expect(w.text()).toContain("Could not load the health summary: boom");
    await w.get('button[aria-label="Retry loading the health summary"]').trigger("click");
    await flushPromises();
    expect(w.find(".spec-hub-hero").exists()).toBe(true);
  });

  it("shows the last-run line when the execution log has an entry", async () => {
    const w = mountBody(
      makeDeps({
        executionLogService: {
          latest: vi
            .fn()
            .mockResolvedValue({ status: "passed", finishedAt: "2026-05-31T10:05:00.000Z" }),
        },
      }),
    );
    await flushPromises();
    const line = w.get(".spec-hub-hero-last-run");
    expect(line.text()).toContain("Last run:");
    expect(line.attributes("data-tone")).toBe("pass");
  });

  it("fires the primary actions and a funnel drill-down", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get('button[aria-label="Create a new Use Case"]').trigger("click");
    expect(deps.openCreateUseCase).toHaveBeenCalledOnce();
    await w.get('button[aria-label="Run all tests"]').trigger("click");
    expect(deps.runAll).toHaveBeenCalledOnce();
    await w.get(".spec-hub-funnel-tile").trigger("click");
    expect(deps.navigate).toHaveBeenCalledWith({ kind: "use-cases", filter: "all" });
  });

  it("reloads on a hub refresh event via useEventBus", async () => {
    const bus = new InMemoryEventBus();
    const snap = vi.fn().mockResolvedValue({ ok: true, value: snapshot() });
    mountBody(makeDeps({ eventBus: bus, traceabilityService: { snapshot: snap } }));
    await flushPromises();
    expect(snap).toHaveBeenCalledOnce();
    void bus.publish({ type: "usecase.updated" } as unknown as DomainEvent);
    await flushPromises();
    expect(snap).toHaveBeenCalledTimes(2);
  });
});

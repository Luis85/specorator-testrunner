// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PrdExplorerBody from "../../src/presentation/vue/prds/PrdExplorerBody.vue";
import type { PrdBodyDeps } from "../../src/presentation/vue/prds/prd-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { Prd } from "../../src/domain/entities/prd";

const prd = (over: Partial<Prd> = {}): Prd =>
  ({
    id: "PRD-000",
    title: "Vision",
    status: "active",
    domains: [],
    vision: "",
    scopeIn: [],
    scopeOut: [],
    displayOrder: 0,
    path: "PRDs/PRD-000/PRD-000.md",
    ...over,
  }) as Prd;

// A root PRD-000 with one sub-PRD PRD-001; PRD-001 has one linked Use Case.
const root = prd();
const child = prd({
  id: "PRD-001",
  title: "Auth",
  parentPrdId: "PRD-000",
  displayOrder: 1,
});

function makeDeps(over: Partial<Record<keyof PrdBodyDeps, unknown>> = {}): PrdBodyDeps {
  return {
    prdService: {
      findAll: vi.fn().mockResolvedValue({ ok: true, value: [root, child] }),
      deletePrd: vi.fn().mockResolvedValue({ ok: true, value: { preservedFiles: 0 } }),
    },
    useCaseService: {
      countUseCasesByPrd: vi.fn().mockResolvedValue({ ok: true, value: new Map([["PRD-001", 1]]) }),
      findAll: vi.fn().mockResolvedValue({ ok: true, value: [{ id: "UC-001", prdId: "PRD-001" }] }),
    },
    openPrdBuilder: vi.fn(),
    navigate: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as PrdBodyDeps;
}

const mountBody = (deps: PrdBodyDeps) => mount(PrdExplorerBody, { props: { deps } });

describe("PrdExplorerBody", () => {
  it("loads and renders the PRD tree with per-PRD Use Case counts", async () => {
    const w = mountBody(makeDeps());
    await flushPromises();
    const nodes = w.findAll(".e2e-test-hub-prd-node");
    expect(nodes).toHaveLength(2); // root + nested child
    expect(w.get('button[aria-label="Open PRD PRD-000 Vision"]').text()).toBe(
      "PRD-000: Vision (0 UCs)",
    );
    expect(w.get('button[aria-label="Open PRD PRD-001 Auth"]').text()).toBe("PRD-001: Auth (1 UC)");
  });

  it("renders the empty state when there are no PRDs", async () => {
    const deps = makeDeps({
      prdService: {
        findAll: vi.fn().mockResolvedValue({ ok: true, value: [] }),
        deletePrd: vi.fn(),
      },
    });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.get(".spec-empty").text()).toContain("No PRDs yet");
  });

  it("renders a retryable error when the load fails", async () => {
    const findAll = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } })
      .mockResolvedValue({ ok: true, value: [root] });
    const w = mountBody(makeDeps({ prdService: { findAll, deletePrd: vi.fn() } }));
    await flushPromises();
    expect(w.text()).toContain("Could not load PRDs: boom");

    await w.get('button[aria-label="Retry loading the PRDs"]').trigger("click");
    await flushPromises();
    expect(w.find(".e2e-test-hub-prd-node").exists()).toBe(true);
  });

  it("opens the PRD Builder from the header and from a node's sub-PRD button", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get(".e2e-test-hub-prd-header button").trigger("click");
    expect(deps.openPrdBuilder).toHaveBeenLastCalledWith();

    await w.get('button[aria-label="Add a sub-PRD under PRD-000"]').trigger("click");
    expect(deps.openPrdBuilder).toHaveBeenLastCalledWith("PRD-000");
  });

  it("navigates to a PRD and into its Use Cases via the deep-links", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get('button[aria-label="Open PRD PRD-000 Vision"]').trigger("click");
    expect(deps.navigate).toHaveBeenLastCalledWith({ kind: "artifact", id: "PRD-000" });

    // "Open Use Cases" only exists for PRD-001 (it has a linked UC).
    expect(w.find('button[aria-label="Open the Use Cases of PRD PRD-000"]').exists()).toBe(false);
    await w.get('button[aria-label="Open the Use Cases of PRD PRD-001"]').trigger("click");
    expect(deps.navigate).toHaveBeenLastCalledWith({ kind: "artifact", id: "UC-001" });
  });

  it("offers Delete only on sub-PRDs and deletes on a two-click confirm", async () => {
    const deletePrd = vi.fn().mockResolvedValue({ ok: true, value: { preservedFiles: 0 } });
    const w = mountBody(
      makeDeps({
        prdService: {
          findAll: vi.fn().mockResolvedValue({ ok: true, value: [root, child] }),
          deletePrd,
        },
      }),
    );
    await flushPromises();
    // Root PRD is never deletable.
    expect(w.find('button[aria-label="Delete PRD PRD-000"]').exists()).toBe(false);

    await w.get('button[aria-label="Delete PRD PRD-001"]').trigger("click"); // arm
    expect(deletePrd).not.toHaveBeenCalled();
    await w.get('button[aria-label^="Delete PRD PRD-001 — click again"]').trigger("click"); // confirm
    expect(deletePrd).toHaveBeenCalledWith("PRD-001");
  });

  // usecase.deleted matters because the per-PRD counts (countUseCasesByPrd) and
  // the "Open Use Cases" deep-link (firstUseCaseIdOfPrd) both depend on the UC
  // set — a deletion must reload the tree (the hub used to cover this via its
  // broad repaint tick; a direct Vue body must self-subscribe).
  it.each(["prd.created", "usecase.deleted"] as const)(
    "reloads on %s via useEventBus",
    async (type) => {
      const bus = new InMemoryEventBus();
      const findAll = vi.fn().mockResolvedValue({ ok: true, value: [root, child] });
      const deps = makeDeps({ eventBus: bus, prdService: { findAll, deletePrd: vi.fn() } });
      mountBody(deps);
      await flushPromises();
      expect(findAll).toHaveBeenCalledOnce();

      void bus.publish({ type } as unknown as DomainEvent);
      await flushPromises();
      expect(findAll).toHaveBeenCalledTimes(2);
    },
  );

  it("clears stale nodes before a slow refresh finishes", async () => {
    const bus = new InMemoryEventBus();
    let releaseReload!: () => void;
    const findAll = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [root, child] })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseReload = () => resolve({ ok: true, value: [root] });
        }),
      );
    const deps = makeDeps({ eventBus: bus, prdService: { findAll, deletePrd: vi.fn() } });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.findAll(".e2e-test-hub-prd-node")).toHaveLength(2);

    void bus.publish({ type: "prd.deleted" } as unknown as DomainEvent);
    await flushPromises();
    // Stale nodes and their Open/Delete buttons are gone while the read is pending.
    expect(w.find(".e2e-test-hub-prd-node").exists()).toBe(false);

    releaseReload();
    await flushPromises();
    expect(w.findAll(".e2e-test-hub-prd-node")).toHaveLength(1);
  });
});

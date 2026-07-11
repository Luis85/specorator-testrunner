// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import StoryMapExplorerBody from "../../src/presentation/vue/story-maps/StoryMapExplorerBody.vue";
import type { StoryMapBodyDeps } from "../../src/presentation/vue/story-maps/story-map-body-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";
import { hangingReload } from "./hanging-reload";
import type { DomainEvent } from "../../src/domain/events/domain-event";
import type { StoryMap } from "../../src/domain/entities/story-map";

const map = (over: Partial<StoryMap> = {}): StoryMap =>
  ({
    id: "SM-001",
    title: "Checkout journey",
    status: "active",
    product: "PRD-000",
    users: ["shopper"],
    activities: ["browse", "pay"],
    steps: [{ activity: "pay", step: "enter card" }],
    slices: ["mvp"],
    cards: [{ title: "c1", activity: "pay", slice: "mvp", tags: [] }],
    path: "StoryMaps/SM-001/SM-001.md",
    ...over,
  }) as StoryMap;

function makeDeps(over: Partial<Record<keyof StoryMapBodyDeps, unknown>> = {}): StoryMapBodyDeps {
  return {
    storyMapService: {
      findAll: vi.fn().mockResolvedValue({ ok: true, value: [map()] }),
      deleteStoryMap: vi.fn().mockResolvedValue({ ok: true, value: { preservedFiles: 0 } }),
      rebuildGrid: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
    workspace: { openFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }) },
    openStoryMapBuilder: vi.fn(),
    openMapSettings: vi.fn(),
    openStoryMapBoard: vi.fn(),
    eventBus: new InMemoryEventBus(),
    ...over,
  } as unknown as StoryMapBodyDeps;
}

const mountBody = (deps: StoryMapBodyDeps) => mount(StoryMapExplorerBody, { props: { deps } });

describe("StoryMapExplorerBody", () => {
  it("loads and renders a card with its count chips", async () => {
    const w = mountBody(makeDeps());
    await flushPromises();
    expect(w.findAll(".e2e-test-hub-story-map-node")).toHaveLength(1);
    expect(w.get(".e2e-test-hub-story-map-card-title").text()).toBe("Checkout journey");
    const chips = w.findAll(".e2e-test-hub-story-map-chip").map((c) => c.text());
    expect(chips).toEqual(["1 user", "2 activities", "1 step", "1 slice", "1 card"]);
  });

  it("renders the empty state when there are no Story Maps", async () => {
    const deps = makeDeps({
      storyMapService: {
        findAll: vi.fn().mockResolvedValue({ ok: true, value: [] }),
        deleteStoryMap: vi.fn(),
        rebuildGrid: vi.fn(),
      },
    });
    const w = mountBody(deps);
    await flushPromises();
    expect(w.get(".spec-empty").text()).toContain("No Story Maps yet");
  });

  it("renders a retryable error when the load fails", async () => {
    const findAll = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } })
      .mockResolvedValue({ ok: true, value: [map()] });
    const w = mountBody(
      makeDeps({ storyMapService: { findAll, deleteStoryMap: vi.fn(), rebuildGrid: vi.fn() } }),
    );
    await flushPromises();
    expect(w.text()).toContain("Could not load Story Maps: boom");
    await w.get('button[aria-label="Retry loading the Story Maps"]').trigger("click");
    await flushPromises();
    expect(w.find(".e2e-test-hub-story-map-node").exists()).toBe(true);
  });

  it("opens the builder, board, and settings from their controls", async () => {
    const deps = makeDeps();
    const w = mountBody(deps);
    await flushPromises();
    await w.get(".e2e-test-hub-story-map-header button").trigger("click");
    expect(deps.openStoryMapBuilder).toHaveBeenCalledOnce();

    await w.get(".e2e-test-hub-story-map-card-title").trigger("click");
    expect(deps.openStoryMapBoard).toHaveBeenCalledWith("SM-001");

    await w.get('button[aria-label="Edit settings for SM-001"]').trigger("click");
    expect(deps.openMapSettings).toHaveBeenCalledWith(expect.objectContaining({ id: "SM-001" }));
  });

  it("deletes a Story Map and reloads", async () => {
    const deleteStoryMap = vi.fn().mockResolvedValue({ ok: true, value: { preservedFiles: 0 } });
    const findAll = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [map()] })
      .mockResolvedValue({ ok: true, value: [] });
    const w = mountBody(
      makeDeps({ storyMapService: { findAll, deleteStoryMap, rebuildGrid: vi.fn() } }),
    );
    await flushPromises();
    await w.get('button[aria-label="Delete Story Map SM-001"]').trigger("click");
    await flushPromises();
    expect(deleteStoryMap).toHaveBeenCalledWith("SM-001");
    // The post-delete refresh reloaded (now empty).
    expect(w.find(".spec-empty").exists()).toBe(true);
  });

  it("reloads on a storymap event via useEventBus", async () => {
    const bus = new InMemoryEventBus();
    const findAll = vi.fn().mockResolvedValue({ ok: true, value: [map()] });
    mountBody(
      makeDeps({
        eventBus: bus,
        storyMapService: { findAll, deleteStoryMap: vi.fn(), rebuildGrid: vi.fn() },
      }),
    );
    await flushPromises();
    expect(findAll).toHaveBeenCalledOnce();
    void bus.publish({ type: "storymap.updated" } as unknown as DomainEvent);
    await flushPromises();
    expect(findAll).toHaveBeenCalledTimes(2);
  });

  it("clears stale cards before a slow refresh finishes", async () => {
    const bus = new InMemoryEventBus();
    const { fn: findAll, release } = hangingReload(
      { ok: true, value: [map()] },
      { ok: true, value: [] },
    );
    const w = mountBody(
      makeDeps({
        eventBus: bus,
        storyMapService: { findAll, deleteStoryMap: vi.fn(), rebuildGrid: vi.fn() },
      }),
    );
    await flushPromises();
    expect(w.findAll(".e2e-test-hub-story-map-node")).toHaveLength(1);

    void bus.publish({ type: "storymap.deleted" } as unknown as DomainEvent);
    await flushPromises();
    expect(w.find(".e2e-test-hub-story-map-node").exists()).toBe(false);

    release();
    await flushPromises();
    expect(w.find(".spec-empty").exists()).toBe(true);
  });
});

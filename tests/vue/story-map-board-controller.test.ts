// @vitest-environment happy-dom
import "./obsidian-dom";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { StoryMapBoardController } from "../../src/presentation/vue/story-map-board/story-map-board-controller";
import type { StoryMapBoardDeps } from "../../src/presentation/vue/story-map-board/story-map-board-deps";
import { InMemoryEventBus } from "../../src/shared/event-bus/event-bus";

/**
 * A deferred Result promise so the test controls exactly when `findById` (the
 * board's only pre-paint async gap) resolves — the window in which a close() can
 * race the initial render.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeDeps(findById: StoryMapBoardDeps["storyMapService"]["findById"]): StoryMapBoardDeps {
  return {
    storyMapService: {
      findById,
      saveMap: vi.fn(),
      addCard: vi.fn(),
      updateCard: vi.fn(),
    },
    useCaseService: { create: vi.fn(), assignToPrd: vi.fn(), findAll: vi.fn() },
    eventBus: new InMemoryEventBus(),
    navigate: vi.fn(),
  };
}

describe("StoryMapBoardController", () => {
  it("does not paint after close() when the initial load resolves post-teardown", async () => {
    // findById hangs so the initial render is parked at its only async gap while
    // we close the board (the open→close-before-load race Codex flagged).
    const load = deferred<{ ok: true; value: unknown }>();
    const host = document.createElement("div");
    const controller = new StoryMapBoardController(
      host,
      {} as App,
      makeDeps(vi.fn().mockReturnValue(load.promise)),
      "SM-1",
    );

    const opening = controller.open(); // fire-and-forget in production; awaited here
    await controller.close(); // tears down + disposes while the load is still pending

    // The load lands after teardown — render() must bail at its post-await guard.
    load.resolve({ ok: true, value: { title: "Late", cards: [] } });
    await opening;

    // Never reached paint(): no SVG scene was built onto the torn-down host.
    expect(host.querySelector("svg")).toBeNull();
  });
});

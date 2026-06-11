import { describe, expect, it, vi } from "vitest";
import { RenderScheduler } from "../src/presentation/views/render-scheduler";

/**
 * Unit tests for the pure render-coalescing logic (PRES-M2): a burst of events
 * collapses into a single trailing render, renders never interleave, and a
 * disposed scheduler never STARTS a queued render (an in-flight one may still
 * complete). No Obsidian involved — the scheduler only owns promise chaining.
 */

/** A render whose completion the test controls explicitly. */
const deferredRender = () => {
  const resolvers: (() => void)[] = [];
  const render = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return { render, finish: (i: number) => resolvers[i]() };
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("RenderScheduler", () => {
  it("runs the render once for a single schedule() and resolves after it completes", async () => {
    const render = vi.fn(async () => {});
    const scheduler = new RenderScheduler(render);

    await scheduler.schedule();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("coalesces a synchronous burst of schedule() calls into ONE render sharing the same promise", async () => {
    const render = vi.fn(async () => {});
    const scheduler = new RenderScheduler(render);

    const first = scheduler.schedule();
    const second = scheduler.schedule();
    const third = scheduler.schedule();
    // Callers folded into the pending render share its chain, so an
    // event bus awaiting handlers preserves ordering.
    expect(second).toBe(first);
    expect(third).toBe(first);

    await first;
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("serializes: a schedule() during an in-flight render queues ONE trailing render that starts only after the first finishes", async () => {
    const { render, finish } = deferredRender();
    const scheduler = new RenderScheduler(render);

    const first = scheduler.schedule();
    await tick(); // first render is now in flight (and pending flag cleared)
    expect(render).toHaveBeenCalledTimes(1);

    // A burst while the first render is still running coalesces into a single
    // trailing render…
    const trailing = scheduler.schedule();
    // A second call in the same burst folds into the trailing render.
    void scheduler.schedule();
    await tick();
    // …which must NOT start while the first render is still in flight.
    expect(render).toHaveBeenCalledTimes(1);

    finish(0);
    await first;
    await tick();
    expect(render).toHaveBeenCalledTimes(2);

    finish(1);
    await trailing;
  });

  it("keeps scheduling after a render rejects (the chain swallows the failure)", async () => {
    const render = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const scheduler = new RenderScheduler(render);

    await scheduler.schedule().catch(() => undefined);
    // The failed chain is caught internally, so the next schedule still renders.
    await scheduler.schedule();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("schedule() after dispose() never invokes the render", async () => {
    const render = vi.fn(async () => {});
    const scheduler = new RenderScheduler(render);

    scheduler.dispose();
    await scheduler.schedule();
    expect(render).not.toHaveBeenCalled();
  });

  it("dispose() while a render is in flight lets it COMPLETE but never starts the queued one", async () => {
    const { render, finish } = deferredRender();
    const scheduler = new RenderScheduler(render);

    const first = scheduler.schedule();
    await tick(); // first render in flight
    const queued = scheduler.schedule(); // trailing render queued behind it

    scheduler.dispose();
    finish(0);
    await first;
    await queued;
    await tick();

    // The in-flight render finished normally; the queued one was never started.
    expect(render).toHaveBeenCalledTimes(1);
  });
});

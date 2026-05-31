/**
 * Render coalescing for the live dashboard views (PRES-M2).
 *
 * Renders are async (they await a service `findAll` / `refreshDashboard`).
 * Firing them concurrently lets a slower render holding STALE data `empty()` +
 * rebuild the container last, clobbering fresher output. This serializes renders
 * so they run one at a time, and coalesces a burst of events into a single
 * trailing render — the queued render already picks up the latest state.
 *
 * Behaviour mirrors the original inline guard in {@link DashboardView}: the
 * first call schedules a render; further calls while one is pending fold into
 * the same trailing render and share its promise (so an event bus that awaits
 * handlers preserves ordering).
 */
export class RenderScheduler {
  private chain: Promise<void> = Promise.resolve();
  private pending = false;
  private disposed = false;

  constructor(private readonly render: () => Promise<void>) {}

  /**
   * Serializes renders so concurrent events can't interleave their async
   * refresh + rebuild. Returns the chain so the (handler-awaiting) event bus
   * preserves ordering; a burst collapses into one trailing render since the
   * queued render already picks up the latest state.
   */
  schedule(): Promise<void> {
    if (this.disposed || this.pending) return this.chain;
    this.pending = true;
    this.chain = this.chain
      .catch(() => undefined)
      .then(() => {
        this.pending = false;
        // A render already in flight when dispose() lands still completes, but
        // we never START a queued one after the view closed (presentation M1).
        if (this.disposed) return;
        return this.render();
      });
    return this.chain;
  }

  /** Stops scheduling further renders once the owning view closes. */
  dispose(): void {
    this.disposed = true;
  }
}

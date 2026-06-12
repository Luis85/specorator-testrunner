/**
 * Serializes async tasks into one promise chain: each task starts only after
 * every previously queued task has settled; the chain survives failures (a
 * failure still reaches that task's own caller).
 *
 * Extracted (2026-06-11 review §4) from `SettingsService.serialize()` and
 * `PostRunCoordinator.enqueue()` when the per-path Use Case note mutex became
 * the third user. Documented constraint carried over from both originals: a
 * bus subscriber that AWAITS a queued operation from inside a handler whose
 * publish the queued operation itself awaits would deadlock the chain — keep
 * queued tasks free of such re-entrant awaits (none exists today).
 */
export class SerialQueue {
  private chain: Promise<unknown> = Promise.resolve();

  /** Queues `task` behind every previously queued task. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    // Track only settlement (never the value, never the rejection) so the
    // chain survives a failed task; the failure still reaches `result`'s
    // caller.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Resolves once every task queued SO FAR has settled (success or failure). */
  whenSettled(): Promise<void> {
    return this.chain.then(() => undefined);
  }
}

/** One lazily created SerialQueue per key (per-path / per-run serialization). */
export class KeyedSerialQueue {
  private readonly queues = new Map<string, SerialQueue>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(key, queue);
    }
    return queue.run(task);
  }

  /** Resolves once every task queued so far under `key` has settled. */
  whenSettled(key: string): Promise<void> {
    return this.queues.get(key)?.whenSettled() ?? Promise.resolve();
  }

  /** Drops the queue for `key` (call when the keyed lifecycle ends). */
  delete(key: string): void {
    this.queues.delete(key);
  }
}

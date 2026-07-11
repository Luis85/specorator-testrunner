import { vi } from "vitest";

/**
 * A `findAll`-style mock whose FIRST call resolves immediately and whose SECOND
 * call hangs until `release()` is invoked. Shared by the Phase 3 body tests to
 * assert the stale-clear guard: an event-driven reload must drop the old rows
 * synchronously (before the pending read settles), so the interim render can be
 * inspected while `release()` is still un-called.
 */
export function hangingReload<T>(
  first: T,
  second: T,
): {
  fn: ReturnType<typeof vi.fn>;
  release: () => void;
} {
  let release!: () => void;
  const fn = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(second);
      }),
    );
  return { fn, release: () => release() };
}

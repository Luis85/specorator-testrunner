/**
 * Test-only runtime stub for the `obsidian` package. The published `obsidian`
 * dependency ships TYPES ONLY (no runtime entry), so any module under test that
 * imports a *value* from "obsidian" (e.g. `Notice`, `setIcon`) cannot be loaded
 * by Vitest without a runtime stand-in. Vitest aliases "obsidian" to this file
 * (see vitest.config.ts). Only the values the presentation modules under test
 * actually import need to exist here; behaviour is irrelevant because the
 * launcher injects its own `notify` spy.
 */

export class Notice {
  constructor(
    public readonly message: string,
    public readonly timeout?: number,
  ) {}
}

export const setIcon = (_el: unknown, _icon: string): void => {
  // No-op: icon rendering is not exercised in unit tests.
};

import { Notice } from "obsidian";

import type { Result } from "../../shared/result/result";

/** The two Notice strings the guard surfaces before `onItems` can run. */
export interface ListLoadNotices {
  /** Prefix for a load failure: shown as `${loadError}: ${error.message}`. */
  loadError: string;
  /** Full Notice text when the list loaded but is empty. */
  empty: string;
}

/**
 * Shared prelude for the "load a list, then open a picker" commands — Generate
 * feature (UC-006) and Run Test Suite / Use Case / feature (UC-011/012/013).
 * Awaits a `Result<T[]>`, surfaces a load failure or the empty case as a Notice
 * and stops, and otherwise hands the non-empty list to `onItems`. Extracted so
 * the four command bodies stop repeating the same ok/empty guard (dedup G5).
 */
export const withNonEmptyList = async <T>(
  load: Promise<Result<T[]>>,
  notices: ListLoadNotices,
  onItems: (items: T[]) => void,
): Promise<void> => {
  const result = await load;
  if (!result.ok) {
    new Notice(`${notices.loadError}: ${result.error.message}`, 10000);
    return;
  }
  if (result.value.length === 0) {
    new Notice(notices.empty);
    return;
  }
  onItems(result.value);
};

/**
 * Focus capture/restore across a full editor re-render (TD-004). Editor
 * controls carry a stable, positional `data-focus-key`
 * (e.g. `scenario:1/step:2:text`); commit() captures the focused key (and
 * text selection) before rebuilding the DOM and re-focuses the match
 * afterwards. Keys use only `[a-z0-9:/-]`, so no CSS escaping is needed.
 * Duck-typed (no DOM lib types) so the logic is unit-testable in the node
 * test environment.
 */
export interface FocusSnapshot {
  key: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

interface FocusableLike {
  getAttribute(name: string): string | null;
  focus(): void;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  setSelectionRange?(start: number, end: number): void;
}

interface FocusRootLike {
  contains(node: unknown): boolean;
  querySelector(selector: string): unknown;
}

export const captureFocus = (root: FocusRootLike, active: unknown): FocusSnapshot | null => {
  if (active === null || typeof active !== "object" || !root.contains(active)) return null;
  const element = active as FocusableLike;
  if (typeof element.getAttribute !== "function") return null;
  const key = element.getAttribute("data-focus-key");
  if (key === null) return null;
  return {
    key,
    selectionStart: typeof element.selectionStart === "number" ? element.selectionStart : null,
    selectionEnd: typeof element.selectionEnd === "number" ? element.selectionEnd : null,
  };
};

export const restoreFocus = (root: FocusRootLike, snapshot: FocusSnapshot | null): void => {
  if (!snapshot) return;
  const element = root.querySelector(`[data-focus-key="${snapshot.key}"]`) as FocusableLike | null;
  if (!element) return;
  element.focus();
  if (snapshot.selectionStart !== null && typeof element.setSelectionRange === "function") {
    try {
      element.setSelectionRange(
        snapshot.selectionStart,
        snapshot.selectionEnd ?? snapshot.selectionStart,
      );
    } catch {
      // Some input types refuse selection ranges — keeping focus is enough.
    }
  }
};

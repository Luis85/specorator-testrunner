/**
 * Enter/Space keyboard activation for the run tables' link-buttons, extracted
 * from the duplicated keydown blocks in the dashboard and Evidence Explorer
 * (entry-point review). The rows themselves are NOT focusable (no role/tabindex
 * — that would destroy their table semantics for screen readers); the
 * link-button in the Run ID cell is the accessible target, and this handles
 * its activation directly.
 *
 * `preventDefault()` suppresses the browser's own synthesized click (and Space
 * scrolling), so activation fires exactly once even though the row also
 * carries a whole-row convenience click listener the synthesized click would
 * bubble into.
 */
export const activateOnEnterOrSpace = (el: HTMLElement, activate: () => void): void => {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
};

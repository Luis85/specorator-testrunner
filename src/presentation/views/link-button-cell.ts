/**
 * Appends a leading `<td>` holding the table's id/name link-button — the same
 * `e2e-test-hub-link-button` affordance the Use Cases and Test Suites tables
 * both open their detail/note from. Factored once so the demoted bodies share
 * the row preamble instead of repeating it (fallow flags the copy). Returns the
 * button so a caller can wire extra behaviour if it needs to.
 */
export const appendLinkButtonCell = (
  tr: HTMLElement,
  options: { text: string; ariaLabel: string; onClick: () => void },
): HTMLElement => {
  const button = tr.createEl("td").createEl("button", {
    text: options.text,
    cls: "e2e-test-hub-link-button",
    attr: { "aria-label": options.ariaLabel },
  });
  button.addEventListener("click", () => options.onClick());
  return button;
};

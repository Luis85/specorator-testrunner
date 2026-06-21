/**
 * The list-explorer preamble shared by the PRDs / Use Cases / Test Suites /
 * Story Maps panels: clear the target element, then a header bar of an `<h2>`
 * title and a primary "New …" action button. `headerCls` namespaces the bar
 * per explorer. The element is passed IN (not read from a view's `contentEl`)
 * so the same writer fills a standalone leaf and the (later) Test Hub body
 * identically — the demoted bodies build entirely into the element they are
 * handed (ADR-0031). `LiveDashboardView.renderListHeader` is the thin wrapper
 * that passes its own `contentEl` here.
 */
export const renderListHeader = (
  el: HTMLElement,
  options: {
    headerCls: string;
    title: string;
    actionLabel: string;
    onAction: () => void;
  },
): void => {
  el.empty();
  const header = el.createDiv({ cls: options.headerCls });
  header.createEl("h2", { text: options.title });
  header
    .createEl("button", { text: options.actionLabel, cls: "mod-cta" })
    .addEventListener("click", () => options.onAction());
};

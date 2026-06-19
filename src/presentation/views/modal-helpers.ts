import { Notice, Setting } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * Shared micro-helpers for the presentation layer's modals and views, kept as
 * a small focused module like {@link RenderScheduler} so the prompt modals and
 * explorers stop re-implementing the same wiring.
 */

/**
 * Submits on Enter in a single-line text input so the keyboard flow doesn't
 * force a mouse trip. Description textareas keep Enter for newlines and are
 * deliberately NOT wired this way. Shared by every prompt modal (create/edit
 * Use Case, create Test Suite, add environment, Feature slug).
 */
export const submitOnEnter = (input: HTMLInputElement, submit: () => void): void => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
};

/**
 * The optional-Description textarea field shared by the create modals. Its
 * Enter key keeps inserting newlines (unlike the single-line inputs), so it is
 * deliberately never wired to submit. `onChange` receives the raw value.
 */
export const descriptionField = (
  contentEl: HTMLElement,
  onChange: (value: string) => void,
): void => {
  new Setting(contentEl)
    .setName("Description")
    .addTextArea((area) => area.setPlaceholder("Optional summary").onChange(onChange));
};

/**
 * Recoverable load-error state for the live views: the failure message plus a
 * Retry button driving the view's RenderScheduler. Extracted because every
 * explorer/dashboard repeated this block (a bare "Could not load …" used to be
 * a dead end until an unrelated event re-rendered the view).
 */
export const renderLoadError = (
  container: HTMLElement,
  message: string,
  retryAriaLabel: string,
  retry: () => void,
): void => {
  container.createEl("p", { text: message });
  container
    .createEl("button", {
      text: "Retry",
      cls: "mod-cta",
      attr: { "aria-label": retryAriaLabel },
    })
    .addEventListener("click", retry);
};

/**
 * Formats an unknown thrown value into a `"<prefix>: <message>"` Notice string,
 * narrowing `Error` for its message and falling back otherwise. Shared by the
 * creation modals' catch blocks so each one stays a single branch (thin views).
 */
export const errorText = (prefix: string, err: unknown): string =>
  `${prefix}: ${err instanceof Error ? err.message : "Unknown error"}`;

/**
 * Renders a vertical list of labelled checkboxes — each `<input>` tied to its
 * `<label>` through a unique id — and reports every toggle. Shared by the PRD
 * wizard's Domains and assign-Use-Cases steps; `idPrefix` namespaces the
 * generated ids so two lists rendered together can't collide.
 */
export const renderCheckboxList = (
  parent: HTMLElement,
  idPrefix: string,
  rows: { id: string; label: string }[],
  isChecked: (id: string) => boolean,
  onToggle: (id: string, checked: boolean) => void,
): void => {
  for (const row of rows) {
    const container = parent.createEl("div");
    const checkbox = container.createEl("input", { attr: { type: "checkbox" } });
    checkbox.id = `${idPrefix}-${row.id}`;
    checkbox.checked = isChecked(row.id);
    checkbox.addEventListener("change", () => onToggle(row.id, checkbox.checked));
    const label = container.createEl("label", { text: row.label });
    label.htmlFor = checkbox.id;
  }
};

/**
 * Opens a file through the workspace port and surfaces a FAILED open as a
 * Notice instead of dropping the Result silently — a button that does nothing
 * (e.g. the note was moved or deleted underneath the view) must say why.
 * Callers with a more specific story pass their own `message`/`timeout`.
 */
export const openOrNotice = async (
  workspace: Pick<WorkspacePort, "openFile">,
  path: VaultPath,
  options: { message?: string; timeout?: number } = {},
): Promise<void> => {
  const result = await workspace.openFile(path);
  if (!result.ok) {
    new Notice(
      options.message ?? `Could not open ${path}: ${result.error.message}`,
      options.timeout,
    );
  }
};

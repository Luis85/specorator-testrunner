import { Notice } from "obsidian";
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
 * Opens a file through the workspace port and surfaces a FAILED open as a
 * Notice instead of dropping the Result silently — a button that does nothing
 * (e.g. the note was moved or deleted underneath the view) must say why.
 */
export const openOrNotice = async (
  workspace: Pick<WorkspacePort, "openFile">,
  path: VaultPath,
): Promise<void> => {
  const result = await workspace.openFile(path);
  if (!result.ok) new Notice(`Could not open ${path}: ${result.error.message}`);
};

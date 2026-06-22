import { Notice } from "obsidian";
import type { TourActionId, TourStepId } from "../../domain/onboarding/tour-steps";
import type { TourStepRow } from "./guided-tour-rows";

/**
 * The wiring a rendered tour step calls back into. Extracted with the DOM so the
 * sidebar GuidedTourView and the hub's onboarding rail (WS-B2 PR3) render every
 * step IDENTICALLY: each surface keeps its own dispatch table and tour service,
 * but the per-step DOM lives here once.
 */
export interface TourStepHandlers {
  /** Run the step's action (the action-id → flow routing stays in the caller). */
  dispatch: (id: TourActionId) => void;
  /** Mark the step done (manual-completion steps). */
  markDone: (id: TourStepId) => void;
  /** Skip the step. */
  skip: (id: TourStepId) => void;
}

/** Renders ONE tour step's DOM into `container`. Done/skipped/pending rows
 * collapse to a single title line; the active step expands with its teach line,
 * snippets, hint, and the action/mark-done/skip affordances. */
export const renderTourStep = (
  container: HTMLElement,
  row: TourStepRow,
  handlers: TourStepHandlers,
): void => {
  const step = container.createDiv({ cls: "e2e-test-hub-tour-step" });
  step.dataset.status = row.status;
  step.setAttr("aria-label", row.ariaLabel);
  step.createDiv({
    cls: "e2e-test-hub-tour-step-title",
    text: `${row.statusIcon} ${row.index}. ${row.title}`,
  });
  if (!row.expanded) return;

  step.createDiv({ cls: "e2e-test-hub-tour-teach", text: row.teach });
  for (const snippet of row.snippets) {
    const block = step.createDiv({ cls: "e2e-test-hub-tour-snippet" });
    block.createDiv({ cls: "e2e-test-hub-tour-step-title", text: snippet.title });
    block.createEl("pre").createEl("code", { text: snippet.code });
    const copy = block.createEl("button", {
      text: "Copy",
      attr: { "aria-label": `Copy the ${snippet.title} snippet` },
    });
    copy.addEventListener("click", () => {
      // Promise.resolve().then keeps a synchronously-missing clipboard API
      // (no navigator.clipboard) on the SAME failure path as a rejected
      // write, so the user always gets the manual-selection fallback notice.
      void Promise.resolve()
        .then(() => navigator.clipboard.writeText(snippet.code))
        .then(() => new Notice("Copied to clipboard."))
        .catch(() => new Notice("Could not copy — select the snippet text manually.", 10000));
    });
  }
  if (row.hint) step.createDiv({ cls: "e2e-test-hub-tour-hint", text: row.hint });

  const actions = step.createDiv({ cls: "e2e-test-hub-tour-actions" });
  if (row.action) {
    const button = actions.createEl("button", {
      text: row.action.label,
      cls: "mod-cta",
      attr: { "aria-label": row.action.ariaLabel },
    });
    const actionId = row.action.id;
    button.addEventListener("click", () => handlers.dispatch(actionId));
  }
  if (row.showMarkDone) {
    const done = actions.createEl("button", {
      text: "Mark done",
      attr: { "aria-label": `Mark step ${row.index} done` },
    });
    done.addEventListener("click", () => handlers.markDone(row.id));
  }
  if (row.showSkip) {
    const skip = actions.createEl("button", {
      text: "Skip",
      attr: { "aria-label": `Skip step ${row.index}` },
    });
    skip.addEventListener("click", () => handlers.skip(row.id));
  }
};

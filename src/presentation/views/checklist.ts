/**
 * The canonical checklist / validation primitive: ONE `ChecklistRow` view-model,
 * ONE ✓/✗/!/–/… icon vocabulary, and ONE render helper, shared across every
 * inline validation surface (the settings tab's validate/repair/CI rows, the
 * Use Case detail view's validate/detect/generate rows, the initialization
 * wizard's progress rows) so the whole product speaks one validation language
 * (05-§3.5, WS-A3). Future surfaces (e.g. the PRD builder) reuse it instead of
 * re-deriving ad-hoc `error-text` paragraphs.
 *
 * The projection (status → row) is pure and unit-tested here; the render helper
 * is the single thin DOM writer. `settings-rows.ts` re-exports the type and
 * factory so its existing importers keep resolving.
 */

/** Visual status of one inline checklist row; styles.css colours by it. */
export type ChecklistStatus = "ok" | "error" | "warning" | "info" | "pending";

export interface ChecklistRow {
  icon: string;
  text: string;
  status: ChecklistStatus;
}

/**
 * The shared icon vocabulary — ✓ done / ✗ failed / ! warning / – skipped/info /
 * … running — matching the initialization wizard's progress rows so every
 * surface reads alike.
 */
export const CHECKLIST_STATUS_ICONS: Record<ChecklistStatus, string> = {
  ok: "✓",
  error: "✗",
  warning: "!",
  info: "–",
  pending: "…",
};

/** Pure projection of a status + message into a renderable checklist row. */
export const checklistRow = (status: ChecklistStatus, text: string): ChecklistRow => ({
  status,
  text,
  icon: CHECKLIST_STATUS_ICONS[status],
});

/** The DOM class every checklist row carries; shared so the look is identical. */
export const CHECKLIST_ROW_CLASS = "e2e-test-hub-settings-check-row";

/**
 * Replaces a result container's content with the given checklist rows — the one
 * DOM writer behind every inline validation surface. Each row renders its icon +
 * text and carries `data-status` for the colour-blind-safe styling contract.
 */
export const renderChecklist = (container: HTMLElement, rows: readonly ChecklistRow[]): void => {
  container.empty();
  for (const row of rows) {
    const el = container.createDiv({
      cls: CHECKLIST_ROW_CLASS,
      text: `${row.icon} ${row.text}`,
    });
    el.dataset.status = row.status;
  }
};

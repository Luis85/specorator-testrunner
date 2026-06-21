import { describe, expect, it, vi } from "vitest";

import {
  CHECKLIST_ROW_CLASS,
  CHECKLIST_STATUS_ICONS,
  type ChecklistRow,
  checklistRow,
  renderChecklist,
} from "../src/presentation/views/checklist";

describe("checklistRow()", () => {
  it("projects each status onto its shared ✓/✗/!/–/… icon", () => {
    expect(checklistRow("ok", "ready")).toEqual({ status: "ok", text: "ready", icon: "✓" });
    expect(checklistRow("error", "boom")).toEqual({ status: "error", text: "boom", icon: "✗" });
    expect(checklistRow("warning", "heads up")).toEqual({
      status: "warning",
      text: "heads up",
      icon: "!",
    });
    expect(checklistRow("info", "skipped")).toEqual({
      status: "info",
      text: "skipped",
      icon: "–",
    });
    expect(checklistRow("pending", "working")).toEqual({
      status: "pending",
      text: "working",
      icon: "…",
    });
  });

  it("exposes the icon vocabulary the wizard and settings share", () => {
    expect(CHECKLIST_STATUS_ICONS).toEqual({
      ok: "✓",
      error: "✗",
      warning: "!",
      info: "–",
      pending: "…",
    });
  });
});

/**
 * Minimal HTMLElement double covering the subset renderChecklist uses: empty()
 * clears, createDiv() records the rendered row and exposes a `dataset` that
 * captures the status assignment.
 */
interface RenderedRow {
  text: string;
  cls: string;
  status: string;
}
const makeFakeEl = (): { el: HTMLElement; rows: RenderedRow[] } => {
  const rows: RenderedRow[] = [];
  const el = {
    empty: vi.fn(() => {
      rows.length = 0;
    }),
    createDiv: vi.fn(({ text, cls }: { text: string; cls: string }) => {
      const row: RenderedRow = { text, cls, status: "" };
      rows.push(row);
      return {
        dataset: new Proxy(row, {
          set(target, key, value) {
            if (key === "status") target.status = value as string;
            return true;
          },
        }),
      };
    }),
  } as unknown as HTMLElement;
  return { el, rows };
};

describe("renderChecklist()", () => {
  const rows: ChecklistRow[] = [
    checklistRow("ok", "Environment is ready."),
    checklistRow("warning", "Outdated manifest."),
  ];

  it("clears the container before writing the rows", () => {
    const { el, rows: rendered } = makeFakeEl();
    renderChecklist(el, rows);
    expect((el as unknown as { empty: ReturnType<typeof vi.fn> }).empty).toHaveBeenCalledOnce();
    expect(rendered).toHaveLength(2);
  });

  it("writes icon + text and the shared row class for each row", () => {
    const { el, rows: rendered } = makeFakeEl();
    renderChecklist(el, rows);
    expect(rendered[0]).toMatchObject({
      text: "✓ Environment is ready.",
      cls: CHECKLIST_ROW_CLASS,
      status: "ok",
    });
    expect(rendered[1]).toMatchObject({
      text: "! Outdated manifest.",
      cls: CHECKLIST_ROW_CLASS,
      status: "warning",
    });
  });

  it("carries data-status for the colour-blind-safe styling contract", () => {
    const { el, rows: rendered } = makeFakeEl();
    renderChecklist(el, [checklistRow("error", "Not ready.")]);
    expect(rendered[0].status).toBe("error");
  });
});

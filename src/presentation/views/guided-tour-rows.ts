import type {
  TourState,
  TourStepState,
  TourStepStatus,
} from "../../application/services/guided-tour-service";
import type { TourActionId, TourSnippet, TourStepId } from "../../domain/onboarding/tour-steps";

/** One rendered tour step. Done/skipped/pending rows collapse to a single line. */
export interface TourStepRow {
  id: TourStepId;
  index: number; // 1-based display position
  title: string;
  teach: string;
  status: TourStepStatus;
  statusIcon: string;
  expanded: boolean;
  action?: { id: TourActionId; label: string; ariaLabel: string };
  snippets: readonly TourSnippet[];
  showSkip: boolean;
  showMarkDone: boolean;
  hint?: string;
  ariaLabel: string;
}

export interface TourViewModel {
  rows: TourStepRow[];
  progressLabel: string;
  completed: boolean;
  dismissed: boolean;
}

/** Shown instead of the checklist hint once every step is done or skipped. */
export const TOUR_DONE_MESSAGE =
  "You built and ran your own test end to end. The User Manual covers everything else.";

const STATUS_ICONS: Record<TourStepStatus, string> = {
  done: "✓",
  skipped: "–",
  active: "→",
  pending: "○",
};

/**
 * Pure projection of the tour state into renderable rows (the dashboard-rows
 * pattern): the active step renders expanded with its action, snippets, and
 * skip/mark-done affordances; everything else is a one-line status row. Keep
 * the view thin: all decisions live here.
 */
export const projectTour = (state: TourState): TourViewModel => {
  const total = state.steps.length;
  const rows = state.steps.map((step, i) => projectStep(step, i + 1, total));
  const done = state.steps.filter((step) => step.status === "done").length;
  return {
    rows,
    progressLabel: `${done} of ${total} steps done`,
    completed: state.completed,
    dismissed: state.dismissed,
  };
};

const projectStep = (step: TourStepState, index: number, total: number): TourStepRow => {
  const { definition } = step;
  const expanded = step.status === "active";
  return {
    id: definition.id,
    index,
    title: definition.title,
    teach: definition.teach,
    status: step.status,
    statusIcon: STATUS_ICONS[step.status],
    expanded,
    action:
      expanded && definition.action
        ? {
            ...definition.action,
            ariaLabel: `Step ${index}: ${definition.action.label}`,
          }
        : undefined,
    snippets: expanded ? (definition.snippets ?? []) : [],
    showSkip: expanded && definition.skippable,
    showMarkDone: expanded && definition.completion.kind === "manual",
    hint: expanded ? hintFor(step) : undefined,
    ariaLabel: `Step ${index} of ${total}: ${definition.title} (${step.status})`,
  };
};

/** The static hint, plus the armed nudge on the manual evidence step. */
const hintFor = (step: TourStepState): string | undefined => {
  if (step.definition.completion.kind === "manual" && step.armed) {
    return "Your latest run wrote an Evidence note — open it, then mark this step done.";
  }
  return step.definition.hint;
};

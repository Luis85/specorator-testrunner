import type { DashboardSnapshot } from "../../application/services/traceability-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * View types a KPI tile can drill into. V1 has no per-status filter, so every
 * tile opens the Use Cases explorer — the honest drill-down (Wave C §4). Kept as
 * a named union so the wiring in the view/main.ts stays type-checked rather than
 * passing a bare string around.
 */
export type DashboardNavTarget = "use-cases";

/** A KPI tile the dashboard renders (US-037). Clicking it navigates (Wave C §4). */
export interface KpiTile {
  label: string;
  value: number;
  /** Where clicking/activating the tile navigates (Wave C §4). */
  navigateTo: DashboardNavTarget;
  /** Spoken affordance for assistive tech (the visible value+label is a bare count). */
  ariaLabel: string;
}

/** A recent-run row the dashboard renders (US-038), made actionable in Wave C §3. */
export interface RecentRunRow {
  runId: string;
  status: string;
  date: string;
  /** Evidence note path the row links to, when the run produced one. */
  evidencePath?: VaultPath;
  /**
   * True when the row links to an Evidence note (clicking opens it). False for
   * runs with no evidence (e.g. errored runs) — the row is then inert with an
   * explanatory tooltip (Wave C §3).
   */
  navigable: boolean;
  /** Spoken affordance / tooltip text for the row (Wave C §3). */
  ariaLabel: string;
}

/** The dashboard's full view model (KPI tiles + recent-run rows). */
export interface DashboardView {
  kpis: KpiTile[];
  recentRuns: RecentRunRow[];
}

/** Tooltip shown on a recent-run row that has no Evidence note to open. */
export const NO_EVIDENCE_TOOLTIP = "No evidence note for this run.";

/**
 * Pure projection of a {@link DashboardSnapshot} into KPI tiles + recent-run
 * rows (US-037/US-038), kept separate from the ItemView so the shaping is
 * unit-testable. Tile order matches the US-037 acceptance criteria. Every tile
 * navigates to the Use Cases explorer (the honest V1 drill-down, Wave C §4) and
 * each recent-run row is marked navigable when it carries an Evidence path
 * (Wave C §3). Keep the view thin: all decisions live here.
 */
export const projectDashboard = (snapshot: DashboardSnapshot): DashboardView => ({
  kpis: [
    kpi("Total Use Cases", snapshot.totalUseCases),
    kpi("Specified", snapshot.specifiedUseCases),
    kpi("Automated", snapshot.automatedUseCases),
    kpi("Passing", snapshot.passingUseCases),
    kpi("Failing", snapshot.failingUseCases),
  ],
  recentRuns: snapshot.recentRuns.map((run) => {
    const navigable = run.evidencePath !== undefined;
    return {
      runId: run.runId,
      status: run.status,
      date: run.date,
      evidencePath: run.evidencePath,
      navigable,
      ariaLabel: navigable
        ? `Open evidence for run ${run.runId} (${run.status})`
        : `Run ${run.runId} (${run.status}) — ${NO_EVIDENCE_TOOLTIP}`,
    };
  }),
});

/** Builds a navigable KPI tile (all tiles open the Use Cases explorer in V1). */
const kpi = (label: string, value: number): KpiTile => ({
  label,
  value,
  navigateTo: "use-cases",
  ariaLabel: `${label}: ${value}. Open Use Cases.`,
});

/**
 * The quick-action buttons the dashboard hub exposes (Wave C §1). Each id maps
 * to a deps callback the view wires in {@link DashboardView} — the mapping is a
 * pure enum so the view stays a thin renderer and the wiring stays
 * type-checked. Grouped Create / Run / Open so the bar reads as three intents,
 * not twelve equal buttons.
 */
export type QuickActionId =
  | "new-use-case"
  | "new-suite"
  | "run-all"
  | "run-demo"
  | "generate-docs"
  | "open-use-cases"
  | "open-suites"
  | "open-console";

/** A single quick-action button descriptor (label + group + a11y label). */
export interface QuickAction {
  id: QuickActionId;
  label: string;
  /** Visual + semantic grouping in the bar (Wave C §1). */
  group: "create" | "run" | "open";
  /** True for the single primary CTA ("New Use Case") so the view tints it. */
  primary: boolean;
  ariaLabel: string;
}

/**
 * The quick-action bar model (Wave C §1). Pure + ordered so the grouping and the
 * single primary CTA are unit-tested without a DOM. The view renders one
 * `<button>` per entry and dispatches by {@link QuickActionId}.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "new-use-case",
    label: "New Use Case",
    group: "create",
    primary: true,
    ariaLabel: "Create a new Use Case",
  },
  {
    id: "new-suite",
    label: "New Test Suite",
    group: "create",
    primary: false,
    ariaLabel: "Create a new Test Suite",
  },
  {
    // Filed under Create: it produces artifacts, it doesn't run tests.
    id: "generate-docs",
    label: "Generate documentation",
    group: "create",
    primary: false,
    ariaLabel: "Generate Test Hub documentation",
  },
  {
    id: "run-all",
    label: "Run all tests",
    group: "run",
    primary: false,
    ariaLabel: "Run all tests",
  },
  {
    id: "run-demo",
    label: "Run demo",
    group: "run",
    primary: false,
    ariaLabel: "Run the demo test",
  },
  {
    id: "open-use-cases",
    label: "Use Cases",
    group: "open",
    primary: false,
    ariaLabel: "Open the Use Cases explorer",
  },
  {
    id: "open-suites",
    label: "Test Suites",
    group: "open",
    primary: false,
    ariaLabel: "Open the Test Suites explorer",
  },
  {
    id: "open-console",
    label: "Test Console",
    group: "open",
    primary: false,
    ariaLabel: "Open the Test Console",
  },
];

/** The dashboard hub's groups, in render order, with their visible headings. */
export const QUICK_ACTION_GROUPS: ReadonlyArray<{
  group: QuickAction["group"];
  heading: string;
}> = [
  { group: "create", heading: "Create" },
  { group: "run", heading: "Run" },
  { group: "open", heading: "Open" },
];

/**
 * Wave G §2: ids of the onboarding panel's step actions. Each maps to an
 * EXISTING deps callback in the view (openCreateUseCase / runDemo /
 * openDocumentation) so the panel introduces no new flows, only guidance.
 */
export type OnboardingActionId = "create-use-case" | "run-demo" | "open-getting-started";

/** One numbered "Get started" step (a real button + one-line explanation). */
export interface OnboardingStep {
  step: number;
  label: string;
  /** One-line explanation rendered under the button. */
  description: string;
  action: OnboardingActionId;
  ariaLabel: string;
}

/**
 * The "Get started" panel model (Wave G §2): the first-time path from an empty
 * (but initialized) hub to a first run. Pure + ordered so the steps are
 * unit-tested without a DOM; the view renders one numbered button per entry.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    step: 1,
    label: "Create a Use Case",
    description: "Describe the first capability your application must support.",
    action: "create-use-case",
    ariaLabel: "Step 1: Create a Use Case",
  },
  {
    step: 2,
    label: "Run the demo test",
    description: "Watch the shipped demo run end-to-end — no Use Case needed.",
    action: "run-demo",
    ariaLabel: "Step 2: Run the demo test",
  },
  {
    step: 3,
    label: "Open Getting Started",
    description: "The guide walks through specifying, automating, and running your Use Case.",
    action: "open-getting-started",
    ariaLabel: "Step 3: Open the Getting Started guide",
  },
];

/**
 * Whether the dashboard shows the "Get started" onboarding panel (Wave G §2):
 * only when the vault has no Use Cases yet. The view calls this strictly after
 * its isInitialized() gate — before initialization the Initialize CTA owns the
 * screen; once the first Use Case exists the panel disappears naturally (the
 * next render drops it).
 */
export const shouldShowOnboarding = (totalUseCases: number): boolean => totalUseCases === 0;

/** The badge model for the active environment top-bar control (Wave C §2). */
export interface EnvironmentBadge {
  /** The active environment name, shown as "Environment: <active>". */
  active: string;
  /**
   * True when more than one environment exists, so clicking the badge opens the
   * switcher. With a single environment the badge is rendered non-interactive
   * (Wave C §2).
   */
  switchable: boolean;
  /** All environment names, for the switcher picker (empty when not switchable). */
  options: string[];
  /** Spoken affordance for the badge / its trigger. */
  ariaLabel: string;
}

/**
 * Projects the active environment + the environment list into the top-bar badge
 * model (Wave C §2). Switchable only when 2+ environments exist (the glossary's
 * "switching environments is a single action"). Pure: no settings I/O — the view
 * persists a switch through a deps callback main.ts owns.
 */
export const projectEnvironmentBadge = (
  active: string,
  environments: readonly string[],
): EnvironmentBadge => {
  const options = [...environments];
  const switchable = options.length > 1;
  return {
    active,
    switchable,
    options,
    ariaLabel: switchable
      ? `Active environment: ${active}. Activate to switch environment.`
      : `Active environment: ${active}.`,
  };
};

import type { Crumb } from "./breadcrumb";

/**
 * The Test Hub home shell (WS-B1, 01-§3.6): a SINGLE leaf with a persistent
 * left-rail section switcher. This is the pure projection that turns a persisted
 * "which section is active" string into the ordered rail model and the content it
 * hosts, so the (later) hub view stays a thin render over a unit-tested logic core
 * (ADR-0029, ADR-0031). No I/O, no Obsidian imports — the direct analogue of
 * `loop-rail-rows.ts`.
 *
 * The brand `--spec-accent` highlights only the ACTIVE nav node (chrome), never a
 * run/automation status colour (01-§3.6 token discipline).
 */

/**
 * The five ordered rail sections, top to bottom. `overview` is the default
 * landing section — a health/status home that hosts the KPI funnel + recent runs.
 */
export const HUB_SECTIONS = ["overview", "plan", "build", "run", "review"] as const;

/** One rail section. */
export type HubSectionId = (typeof HUB_SECTIONS)[number];

/** The default landing section when nothing valid is persisted. */
export const DEFAULT_HUB_SECTION: HubSectionId = "overview";

/**
 * The in-hub body ids — the surfaces rendered INSIDE the hub leaf (demoted list
 * surfaces, ADR-0031). A discriminated content ref (below) routes a section to
 * these bodies, while board/console/detail surfaces route OUT as leaves.
 */
export type HubBodyId =
  | "kpi-overview"
  | "recent-runs"
  | "prd-roadmap"
  | "story-maps"
  | "use-cases"
  | "suites"
  | "evidence";

/**
 * The no-required-state leaf a section opens as a section-level action — only the
 * Test Console qualifies (a singleton sidebar companion opened with no target).
 * Plain string constant mirroring the view's own `*_VIEW_TYPE`, so this module
 * stays dependency-light and pure.
 *
 * The id-TARGETED leaves — a specific Story Map board, a specific Use Case detail —
 * are deliberately NOT section contents. They open PER ROW from the `story-maps` /
 * `use-cases` bodies via the B4 navigate port (`navigate({ kind: "artifact", id })`),
 * which resolves the id to a leaf carrying the required `{ storyMapId }` /
 * `{ useCaseId }` state. Listing them here as a bare `viewType` would open an
 * untargeted, empty board/detail (Codex review).
 */
const TEST_CONSOLE_LEAF = "e2e-test-hub-console";

/**
 * One piece of content a section hosts — a discriminated union the (later) view
 * maps to either an in-hub body render or a navigate-out leaf:
 * - `section-body` → render the named {@link HubBodyId} inside the hub leaf;
 * - `leaf` → open `viewType` as its own workspace leaf, for a NO-STATE surface
 *   (the Test Console). Id-targeted leaves (board/detail) are reached per-row via
 *   the B4 navigate port instead — see the {@link TEST_CONSOLE_LEAF} note.
 */
export type HubContentRef =
  | { kind: "section-body"; body: HubBodyId }
  | { kind: "leaf"; viewType: string };

/** A rail section's static descriptor: its label, Lucide icon, and hosted content. */
export interface HubSectionDescriptor {
  id: HubSectionId;
  /** The visible rail label (glossary-correct). */
  label: string;
  /** The Lucide icon name for the rail node (01-§3.6). */
  icon: string;
  /** The accessible name for the rail node's switch control. */
  ariaLabel: string;
  /** The ordered content this section hosts (in-hub bodies and/or navigate-out leaves). */
  contents: HubContentRef[];
}

/** Builds an in-hub body content ref. */
const body = (id: HubBodyId): HubContentRef => ({ kind: "section-body", body: id });

/** Builds a navigate-out leaf content ref. */
const leaf = (viewType: string): HubContentRef => ({ kind: "leaf", viewType });

/**
 * The static descriptor for every rail section. List surfaces are in-hub bodies;
 * the Test Console stays a no-state leaf opened as a section action. A specific
 * Story Map board / Use Case detail is NOT listed here — those open per-row from
 * their list body via the B4 navigate port (ADR-0031 demotion strategy).
 */
export const HUB_SECTION_DESCRIPTORS: Record<HubSectionId, HubSectionDescriptor> = {
  overview: {
    id: "overview",
    label: "Overview",
    icon: "layout-dashboard",
    ariaLabel: "Overview — health summary and recent runs",
    contents: [body("kpi-overview"), body("recent-runs")],
  },
  plan: {
    id: "plan",
    label: "Plan",
    icon: "git-fork",
    ariaLabel: "Plan — PRD roadmap and Story Maps",
    contents: [body("prd-roadmap"), body("story-maps")],
  },
  build: {
    id: "build",
    label: "Build",
    icon: "file-check",
    ariaLabel: "Build — Use Cases",
    contents: [body("use-cases")],
  },
  run: {
    id: "run",
    label: "Run",
    icon: "play",
    ariaLabel: "Run — Test Suites and the Test Console",
    contents: [body("suites"), leaf(TEST_CONSOLE_LEAF)],
  },
  review: {
    id: "review",
    label: "Review",
    icon: "gauge",
    ariaLabel: "Review — Evidence",
    contents: [body("evidence")],
  },
};

/** One node of the rendered rail: its descriptor plus whether it is the active section. */
export interface HubRailNode {
  descriptor: HubSectionDescriptor;
  active: boolean;
}

/** The whole rail: the ordered nodes plus the resolved active descriptor. */
export interface HubRail {
  nodes: HubRailNode[];
  /** The descriptor of the active section (the one node with `active: true`). */
  active: HubSectionDescriptor;
}

/**
 * Whether `value` is one of the known rail sections — the pure validation a
 * future `setState` uses to sanitize a persisted/incoming value.
 */
const isHubSection = (value: string): value is HubSectionId =>
  (HUB_SECTIONS as readonly string[]).includes(value);

/**
 * Validates a persisted/incoming active-section value against {@link HUB_SECTIONS}.
 * Unknown / undefined / empty all fall back to {@link DEFAULT_HUB_SECTION}, so a
 * stale or absent layout never strands the hub on a non-existent section. Pure —
 * the core a future `setState` calls before re-rendering.
 */
export const resolveActiveSection = (persisted: string | undefined): HubSectionId => {
  if (persisted === undefined || persisted === "") return DEFAULT_HUB_SECTION;
  return isHubSection(persisted) ? persisted : DEFAULT_HUB_SECTION;
};

/**
 * The rail for an active section: the ordered nodes with exactly one marked
 * `active`, plus the resolved active descriptor. The direct analogue of
 * `projectLoopRail`. Pure: a deterministic function of `activeSection`.
 */
export const projectHubRail = (activeSection: HubSectionId): HubRail => {
  const nodes: HubRailNode[] = HUB_SECTIONS.map((id) => ({
    descriptor: HUB_SECTION_DESCRIPTORS[id],
    active: id === activeSection,
  }));
  return { nodes, active: HUB_SECTION_DESCRIPTORS[activeSection] };
};

/**
 * The `Test Hub › <Section>` breadcrumb root for the active section — the static
 * home crumbs every trail starts with, now reflecting which rail section is open.
 * Consumed by `breadcrumbFor` (the additive generalization in `breadcrumb.ts`).
 * Both crumbs are static labels (no `id`): they navigate by their own rail/home
 * affordance, not through the deep-link port.
 */
export const hubCrumbRoot = (section: HubSectionId): Crumb[] => [
  { label: "Test Hub" },
  { label: HUB_SECTION_DESCRIPTORS[section].label },
];

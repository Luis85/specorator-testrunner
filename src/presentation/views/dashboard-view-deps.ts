import type { TraceabilityService } from "../../application/services/traceability-service";
import type { PrdService } from "../../application/services/prd-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { DashboardNavTarget } from "./dashboard-rows";

/** The documentation entry points reachable from the dashboard (AC-016). */
export type DashboardDocumentType = "getting-started" | "manual" | "troubleshooting";

/**
 * Callbacks the dashboard hub drives (Wave C). Every entry is a callback (never
 * a service) so the view stays decoupled from the composition root: main.ts
 * wires these to the EXISTING helpers and the Wave B {@link RunLauncher} rather
 * than the view reimplementing create/run/open/persist logic.
 */
export interface DashboardViewDeps {
  traceabilityService: TraceabilityService;
  // PRD & roadmap section (Task 15): the root vision card + sub-PRD list.
  prdService: Pick<PrdService, "findAll">;
  useCaseService: Pick<UseCaseService, "countUseCasesByPrd">;
  // Opens the PRD Builder and navigates to the PRD Explorer from the section.
  openPrdBuilder: () => void;
  navigateToPrds: () => void | Promise<void>;
  eventBus: EventBus;
  // AC-016: open the Getting Started guide / User Manual straight from the
  // dashboard.
  openDocumentation: (documentType: DashboardDocumentType) => void | Promise<void>;
  // Wave C §1: a REAL initialization signal (does the Test Hub vault structure
  // exist yet?), wired in main.ts to a vault folder-existence check. snapshot()
  // can't tell us — a fresh vault's missing Use Cases folder lists as ok([]), so
  // it succeeds with zero Use Cases and would hide the Initialize CTA from
  // first-time users.
  isInitialized: () => Promise<boolean>;
  // Wave C §1 quick actions. Create / run entry points reuse the openCreate*
  // helpers + the RunLauncher; open* navigates via the workspace adapter.
  openWizard: () => void;
  openCreateUseCase: () => void;
  openCreateSuite: () => void;
  runAll: () => void | Promise<void>;
  runDemo: () => void | Promise<void>;
  generateDocumentation: () => void | Promise<void>;
  // Wave C §4: KPI tiles + the Open quick-actions navigate the explorers.
  navigate: (target: DashboardNavTarget) => void | Promise<void>;
  openSuites: () => void | Promise<void>;
  openConsole: () => void | Promise<void>;
  // Wave C §3: open the Evidence note a recent-run row links to.
  openEvidence: (path: VaultPath) => void | Promise<void>;
  // EPIC-008: the Recent Runs header links into the full history explorer
  // (Recent Runs shows only the latest run per Use Case).
  openEvidenceExplorer: () => void | Promise<void>;
  // Wave C §2: the active environment + the full list, read fresh each render
  // so a switch (persisted via switchEnvironment) repaints with the new active.
  getEnvironments: () => { active: string; names: string[] };
  // Persists the chosen environment through the settings save path main.ts owns
  // (the view never writes settings directly). main.ts shows the Notice + the
  // settings.updated event drives the refresh; the resolved Result lets the view
  // skip a redundant local refresh on failure.
  switchEnvironment: (name: string) => Promise<void>;
  // Guided Tour CTA (spec 2026-06-11): shown while the tour is neither
  // completed nor dismissed; opens the sidebar tour view.
  tourVisible: () => boolean;
  openGuidedTour: () => void;
}

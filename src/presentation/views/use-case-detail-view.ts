import { ItemView, type WorkspaceLeaf } from "obsidian";
import { ref, type Ref } from "vue";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SpecificationService } from "../../application/services/specification-service";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { PrdService } from "../../application/services/prd-service";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { UseCase } from "../../domain/entities/use-case";
import type { UseCaseId } from "../../domain/value-objects/identifiers";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { RunLauncher } from "../run/run-launcher";
import type { NavigationTarget } from "../navigation/navigation-target";
import type { PendingStepsTarget } from "./pending-steps-rows";
import { OBSIDIAN_APP } from "../vue/obsidian-app";
import UseCaseDetailApp from "../vue/use-case-detail/UseCaseDetailApp.vue";
import {
  USE_CASE_DETAIL_DEPS,
  USE_CASE_DETAIL_ID,
} from "../vue/use-case-detail/use-case-detail-deps";
import { mountVueView, type MountedVueView } from "../vue/mount-vue-view";

export const USE_CASE_DETAIL_VIEW_TYPE = "e2e-test-hub-use-case-detail";

/** Persisted view state: which Use Case this detail leaf is showing. */
interface UseCaseDetailState {
  useCaseId?: string;
}

/**
 * The narrow slice of the composition root the Use Case detail view needs. Kept
 * minimal and named per the layer rules: the lookup + services the view
 * orchestrates, the workspace port for opening the raw note / Feature files, the
 * shared run launcher (Wave B), and the generate-Feature opener (which reuses
 * the command palette's slug-prompt flow rather than forking it).
 */
export interface UseCaseDetailDeps {
  // traceability.deriveById powers the render so the header's Automation status
  // reflects per-scenario history (US-057), not the never-updated frontmatter
  // value; updateMetadata/assignToPrd back the header's quick-edit modal (Wave
  // G §3) and PRD assignment.
  traceability: Pick<TraceabilityService, "deriveById">;
  useCaseService: Pick<UseCaseService, "updateMetadata" | "assignToPrd">;
  // Resolves the parent PRD's title for the header breadcrumb (Task 16b) and
  // lists PRDs for the Use Case editor's Parent PRD selector (Task 16c).
  prdService: Pick<PrdService, "findById" | "findAll">;
  // Computes the "Referenced by Story Maps" backlink (maps own the forward
  // card reference; nothing is stored on the Use Case).
  storyMapService: Pick<StoryMapService, "findAll">;
  specificationService: Pick<SpecificationService, "listFeatures" | "validate" | "allStepsDefined">;
  // Wave F insight: per-Feature health (scenario count, @wip work, the
  // feature-level @wip badge) rendered as a muted line on each Feature row.
  featureInsight: Pick<FeatureInsightService, "healthFor">;
  workspace: WorkspacePort;
  eventBus: EventBus;
  // Shared run-launch surface (Wave B): the "Run Use Case" / per-feature "Run"
  // buttons start a scoped run through the same launcher the command palette
  // and explorers use.
  runLauncher: Pick<RunLauncher, "launch">;
  // Opens the slug-prompt generate-Feature flow scoped to ONE Use Case, reusing
  // the command palette's logic (no generation logic is duplicated here). The
  // `onGenerated` callback lets the view refresh once the Feature lands.
  openGenerateFeature: (useCase: UseCase, onGenerated: () => void) => void;
  // WS-C1 loop rail: the "Create suite" next-step action opens the existing
  // create-Suite flow (the rail reuses the same modal the dashboard/explorer
  // open — no suite-creation logic is duplicated here).
  openCreateSuite: () => void;
  /** WS1/C2: opens the Pending Steps sidebar companion at a target. */
  openPendingSteps: (target: PendingStepsTarget) => void;
  // WS-A4/B4 deep-link port: the PRD breadcrumb opens the SPECIFIC parent PRD
  // (by id, 01-§3.2), a Feature row opens by its vault path, and a Story Map
  // backlink opens its board (by id) — all through the one unified navigator.
  navigate: (target: NavigationTarget) => void;
}

/**
 * Use Case detail view (Wave D): the UI-driven authoring & testing surface for
 * one Use Case — header (status + automation), the WS-C1 loop rail, and the
 * Feature Specifications that belong to the Use Case.
 *
 * Vue-migrated (ADR-0033 Phase 1): the view is now a thin Obsidian shell that
 * mounts {@link UseCaseDetailApp} into `contentEl`. It owns the persisted target
 * id as a Vue `ref` — `getState` reads it, `setState` writes it — which the
 * component watches to (re)load. Because the ref holds the value even before the
 * app mounts, the restore-before-`onOpen` gap is handled without a render guard:
 * the component's first load simply reads whatever `setState` already stored. The
 * pure projections (header / loop rail / feature rows / outcomes) and their tests
 * are unchanged; the bus-driven refresh moved into the component's `useEventBus`.
 */
export class UseCaseDetailView extends ItemView {
  private readonly useCaseId: Ref<UseCaseId | null> = ref(null);
  private mounted: MountedVueView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: UseCaseDetailDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return USE_CASE_DETAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.useCaseId.value ? `Use Case ${this.useCaseId.value}` : "Use Case";
  }

  getIcon(): string {
    return "file-check";
  }

  /** Persist the target Use Case id so the leaf survives a workspace reload. */
  getState(): Record<string, unknown> {
    return { useCaseId: this.useCaseId.value ?? undefined };
  }

  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const next = (state as UseCaseDetailState | null)?.useCaseId;
    // Writing the ref is all that's needed for BOTH paths: on a workspace restore
    // (setState before onOpen) the component's first load reads it; on a leaf
    // reuse (already mounted) the component's watch reloads. Setting the same
    // value is a no-op for Vue's reactivity, so an unrelated setState won't churn.
    if (typeof next === "string") this.useCaseId.value = next;
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.mounted = mountVueView(this.contentEl, UseCaseDetailApp, (app) => {
      app.provide(USE_CASE_DETAIL_DEPS, this.deps);
      app.provide(USE_CASE_DETAIL_ID, this.useCaseId);
      app.provide(OBSIDIAN_APP, this.app);
    });
  }

  async onClose(): Promise<void> {
    this.mounted?.unmount();
    this.mounted = null;
  }
}

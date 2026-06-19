import type { WorkspaceLeaf } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SpecificationService } from "../../application/services/specification-service";
import type { TraceabilityService } from "../../application/services/traceability-service";
import type { StepDefinitionService } from "../../application/services/step-definition-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { PrdService } from "../../application/services/prd-service";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { UseCase } from "../../domain/entities/use-case";
import type { DomainEventType } from "../../domain/events/domain-event";
import type { UseCaseId, VaultPath } from "../../domain/value-objects/identifiers";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { type ChecklistRow } from "../settings/settings-rows";
import type { RunLauncher } from "../run/run-launcher";
import { EditUseCaseModal } from "./edit-use-case-modal";
import { LiveDashboardView } from "./live-dashboard-view";
import { openOrNotice, renderLoadError } from "./modal-helpers";
import { USE_CASE_VIEW_TYPE } from "./use-case-dashboard-view";
import { PRD_VIEW_TYPE } from "./prd-explorer-view";
import {
  detectMissingStepsOutcome,
  featureHealthLine,
  generateStepDefinitionsOutcome,
  prdBreadcrumbLabel,
  projectFeatureRows,
  projectUseCaseHeader,
  storyMapBacklinks,
  validateFeatureOutcome,
  type FeatureRow,
  type StoryMapBacklink,
} from "./use-case-detail-rows";

export const USE_CASE_DETAIL_VIEW_TYPE = "e2e-test-hub-use-case-detail";

/** Persisted view state: which Use Case this detail leaf is showing. */
interface UseCaseDetailState {
  useCaseId?: string;
}

/**
 * Events that should refresh the detail view's Feature list and Use Case header
 * (Wave D). Feature-lifecycle + step-generation events keep the Feature list and
 * its per-feature affordances current; Use Case events keep the header status /
 * automation status live; the terminal run events refresh after a Test Run so
 * the latest automation status (and any new evidence) is reflected.
 */
const REFRESH_ON: DomainEventType[] = [
  "specification.created",
  "specification.updated",
  "stepdefinition.generated",
  "usecase.updated",
  "usecase.status.changed",
  "usecase.deleted",
  "testrun.completed",
  "testrun.failed",
  "testrun.cancelled",
  // US-057: the header's Automation status is derived from per-scenario history,
  // which is recorded AFTER testrun.completed — re-render when it lands so the
  // status isn't a render behind.
  "scenario.history.recorded",
  // deriveById() reads scenario history under the configured Evidence root, so an
  // evidencePath change (persisted via settings.updated) repoints the history
  // tree — re-render so the header isn't served from the old root, matching the
  // main dashboard.
  "settings.updated",
  // The "Referenced by Story Maps" backlink is computed from story maps, so it
  // re-renders when a map is created, has its cards changed, or is deleted.
  "storymap.created",
  "storymap.updated",
  "storymap.deleted",
];

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
  specificationService: Pick<
    SpecificationService,
    "listFeatures" | "validate" | "detectMissingSteps"
  >;
  stepDefinitionService: Pick<StepDefinitionService, "generate">;
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
}

/**
 * Use Case detail view (Wave D): the UI-driven authoring & testing surface for
 * one Use Case. It shows the Use Case header (status + automation status), an
 * "Open note" / "Run Use Case" affordance, and the Feature Specifications that
 * belong to the Use Case (by the ADR-0012 `<UC-id>-<slug>.feature` filename
 * back-reference). Each Feature row drives Open / Run / Validate /
 * Detect missing steps / Generate step definitions, rendering the validate /
 * detect / generate result INLINE with the wizard's ✓/✗/! checklist vocabulary
 * — so a user gets from a Use Case to executable, traceable Features without the
 * command palette.
 */
export class UseCaseDetailView extends LiveDashboardView {
  private useCaseId: UseCaseId | null = null;
  private isOpen = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: UseCaseDetailDeps,
  ) {
    super(leaf, deps.eventBus, REFRESH_ON);
  }

  getViewType(): string {
    return USE_CASE_DETAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.useCaseId ? `Use Case ${this.useCaseId}` : "Use Case";
  }

  getIcon(): string {
    return "file-check";
  }

  /** Persist the target Use Case id so the leaf survives a workspace reload. */
  getState(): Record<string, unknown> {
    return { useCaseId: this.useCaseId ?? undefined };
  }

  // Untested Obsidian-lifecycle override — its CRAP score is high only because
  // views are unit-test-exempt (AGENTS.md, 0 coverage), not from logic density.
  // fallow-ignore-next-line complexity
  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const next = (state as UseCaseDetailState | null)?.useCaseId;
    if (typeof next === "string" && next !== this.useCaseId) {
      this.useCaseId = next;
      // On a workspace RESTORE, Obsidian calls setState() BEFORE onOpen() — the
      // bus subscriptions don't exist yet, so a render here could show data an
      // event in that gap already invalidated. Let onOpen() do the first render
      // (after subscribing); only re-render here when the view is already open
      // (the leaf-reuse path in main.ts openUseCaseDetail).
      if (this.isOpen) await this.live.schedule();
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.isOpen = true;
    await this.live.open(this.refreshOn);
  }

  async onClose(): Promise<void> {
    this.isOpen = false;
    this.live.close();
  }

  // Untested view render method — its CRAP score is high only because views are
  // unit-test-exempt (AGENTS.md, 0 coverage), not from logic density.
  // fallow-ignore-next-line complexity
  protected async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("e2e-test-hub-uc-detail");

    if (this.useCaseId === null) {
      container.createEl("p", { text: "Open a Use Case to see its Feature Specifications." });
      return;
    }

    const found = await this.deps.traceability.deriveById(this.useCaseId);
    if (!found.ok) {
      // Recoverable dead-end: offer a retry instead of a bare terminal message.
      renderLoadError(
        container,
        `Could not load Use Case: ${found.error.message}`,
        "Retry loading the Use Case",
        () => void this.live.schedule(),
      );
      return;
    }
    if (found.value === null) {
      // Recoverable dead-end (entry-point review): the persisted leaf id can
      // outlive its Use Case (deleted note + workspace restore). Say what
      // happened and offer the explorer instead of a bare terminal message.
      container.createEl("p", {
        text: `Use Case ${this.useCaseId} was not found. It may have been renamed or deleted.`,
      });
      container
        .createEl("button", {
          text: "Open Use Cases",
          cls: "mod-cta",
          attr: { "aria-label": "Open the Use Cases explorer" },
        })
        .addEventListener("click", () => void this.deps.workspace.openView(USE_CASE_VIEW_TYPE));
      return;
    }
    const useCase = found.value;

    // Resolve the parent PRD's title (if any) for the header breadcrumb.
    const prdTitleById = new Map<string, string>();
    if (useCase.prdId) {
      const prd = await this.deps.prdService.findById(useCase.prdId);
      if (prd.ok && prd.value) prdTitleById.set(useCase.prdId, prd.value.title);
    }

    // Computed Story Map backlinks (best-effort: an index failure just hides them).
    const maps = await this.deps.storyMapService.findAll();
    const backlinks = maps.ok ? storyMapBacklinks(useCase.id, maps.value) : [];

    this.renderHeader(container, useCase, prdTitleById, backlinks);
    await this.renderFeatures(container, useCase);
  }

  private renderHeader(
    container: HTMLElement,
    useCase: UseCase,
    prdTitleById: Map<string, string>,
    backlinks: StoryMapBacklink[],
  ): void {
    const header = projectUseCaseHeader(useCase);

    const headerEl = container.createDiv({ cls: "e2e-test-hub-uc-detail-header" });
    // Breadcrumb back to the explorer (entry-point review): the healthy detail
    // view shouldn't be a dead-end either — same call as the not-found branch.
    headerEl
      .createEl("button", {
        text: "All Use Cases",
        cls: "e2e-test-hub-link-button",
        attr: { "aria-label": "Open the Use Cases explorer" },
      })
      .addEventListener("click", () => void this.deps.workspace.openView(USE_CASE_VIEW_TYPE));
    this.renderPrdBreadcrumb(headerEl, useCase, prdTitleById);
    headerEl.createEl("h2", { text: `${header.id} — ${header.title}` });
    this.renderStoryMapBacklinks(headerEl, backlinks);

    const meta = headerEl.createDiv({ cls: "e2e-test-hub-uc-detail-meta" });
    const status = meta.createSpan({
      cls: "e2e-test-hub-uc-detail-status",
      text: `Status: ${header.status}`,
    });
    status.dataset.status = header.status;
    const automation = meta.createSpan({
      cls: "e2e-test-hub-uc-detail-status",
      text: `Automation: ${header.automationStatus}`,
    });
    automation.dataset.status = header.automationStatus;

    const actions = headerEl.createDiv({ cls: "e2e-test-hub-uc-detail-actions" });
    actions
      .createEl("button", {
        text: "Open note",
        attr: { "aria-label": `Open the ${header.id} note` },
      })
      .addEventListener("click", () => void openOrNotice(this.deps.workspace, header.path));
    // Wave G §3: quick-edit title/status without hand-editing YAML frontmatter.
    // The view refreshes via its existing `usecase.updated` subscription once
    // the service publishes, so the modal needs no callback.
    actions
      .createEl("button", {
        text: "Edit",
        attr: { "aria-label": `Edit the title or status of ${header.id}` },
      })
      .addEventListener("click", () =>
        new EditUseCaseModal(this.app, {
          useCaseService: this.deps.useCaseService,
          prdService: this.deps.prdService,
          useCase,
        }).open(),
      );
    actions
      .createEl("button", {
        text: "Run Use Case",
        cls: "mod-cta",
        attr: { "aria-label": `Run Use Case ${header.id}` },
      })
      .addEventListener(
        "click",
        () => void this.deps.runLauncher.launch({ scope: "use-case", target: header.id }),
      );
    actions
      .createEl("button", {
        text: "Generate feature",
        attr: { "aria-label": `Generate a Feature Specification for ${header.id}` },
      })
      .addEventListener("click", () =>
        this.deps.openGenerateFeature(useCase, () => void this.live.schedule()),
      );
  }

  /**
   * Renders the Domain › PRD breadcrumb above the title. The PRD segment is a
   * link-button opening the PRD Explorer; nothing renders when the Use Case has
   * neither a domain nor a PRD link.
   */
  // Untested view render method — its CRAP score is high only because views are
  // unit-test-exempt (AGENTS.md, 0 coverage), not from logic density.
  // fallow-ignore-next-line complexity
  private renderPrdBreadcrumb(
    headerEl: HTMLElement,
    useCase: UseCase,
    prdTitleById: Map<string, string>,
  ): void {
    if (!useCase.domain && !useCase.prdId) return;
    const crumb = headerEl.createDiv({ cls: "e2e-test-hub-uc-prd-breadcrumb" });
    crumb.setAttr("aria-label", prdBreadcrumbLabel(useCase, prdTitleById));

    if (useCase.domain) crumb.createSpan({ text: `Domain: ${useCase.domain}` });
    if (useCase.prdId) {
      if (useCase.domain) crumb.createSpan({ text: "  ›  " });
      const title = prdTitleById.get(useCase.prdId);
      crumb
        .createEl("button", {
          text: title ? `${useCase.prdId}: ${title}` : useCase.prdId,
          cls: "e2e-test-hub-link-button",
          attr: { "aria-label": `Open PRD ${useCase.prdId} in the PRD explorer` },
        })
        .addEventListener("click", () => void this.deps.workspace.openView(PRD_VIEW_TYPE));
    }
  }

  /**
   * The "Referenced by Story Maps" backlink line: a button per map that places
   * this Use Case, opening the map's note. Renders nothing when no map does.
   */
  private renderStoryMapBacklinks(headerEl: HTMLElement, backlinks: StoryMapBacklink[]): void {
    if (backlinks.length === 0) return;
    const row = headerEl.createDiv({ cls: "e2e-test-hub-uc-story-map-backlinks" });
    row.createSpan({ text: "Referenced by Story Maps: " });
    backlinks.forEach((map, i) => {
      if (i > 0) row.createSpan({ text: ", " });
      row
        .createEl("button", {
          text: `${map.id}: ${map.title}`,
          cls: "e2e-test-hub-link-button",
          attr: { "aria-label": `Open Story Map ${map.id} ${map.title}` },
        })
        .addEventListener("click", () => void openOrNotice(this.deps.workspace, map.path));
    });
  }

  private async renderFeatures(container: HTMLElement, useCase: UseCase): Promise<void> {
    const section = container.createDiv({ cls: "e2e-test-hub-uc-detail-features" });
    section.createEl("h3", { text: "Feature Specifications" });

    const listed = await this.deps.specificationService.listFeatures();
    if (!listed.ok) {
      // Recoverable dead-end: offer a retry instead of a bare terminal message.
      renderLoadError(
        section,
        `Could not load Feature Specifications: ${listed.error.message}`,
        "Retry loading the Feature Specifications",
        () => void this.live.schedule(),
      );
      return;
    }

    const rows = projectFeatureRows(useCase.id, listed.value);
    if (rows.length === 0) {
      section.createEl("p", {
        cls: "e2e-test-hub-uc-detail-empty",
        text: "No Feature Specifications yet. Generate one to make this Use Case executable.",
      });
      return;
    }

    for (const row of rows) this.renderFeatureRow(section, row);
  }

  private renderFeatureRow(container: HTMLElement, row: FeatureRow): void {
    const featureEl = container.createDiv({ cls: "e2e-test-hub-uc-detail-feature" });

    const head = featureEl.createDiv({ cls: "e2e-test-hub-uc-detail-feature-head" });
    // `title` carries the full vault path so a label truncated by the CSS
    // ellipsis (long paths) is still recoverable on hover.
    head.createSpan({
      cls: "e2e-test-hub-uc-detail-feature-name",
      text: row.label,
      attr: { title: row.path },
    });

    const actions = head.createDiv({ cls: "e2e-test-hub-uc-detail-feature-actions" });
    // Wave F insight: a muted per-Feature health line ("N scenarios (M @wip)" +
    // the feature-level @wip badge). Filled asynchronously (fire-and-forget)
    // so the action buttons render immediately; :empty CSS hides it until then.
    const healthEl = featureEl.createDiv({ cls: "e2e-test-hub-uc-detail-feature-health" });
    void this.renderFeatureHealth(row.path, healthEl);
    // A per-feature result area below the action buttons: validate / detect /
    // generate render their outcome here INLINE (not just a Notice), reusing the
    // wizard's ✓/✗/! checklist vocabulary so every inline surface reads alike.
    const resultEl = featureEl.createDiv({
      cls: "e2e-test-hub-uc-detail-feature-result",
      attr: { "aria-live": "polite" },
    });

    const button = (text: string, ariaLabel: string, cls?: string): HTMLButtonElement => {
      const el = actions.createEl("button", {
        text,
        attr: { "aria-label": ariaLabel },
        ...(cls ? { cls } : {}),
      });
      return el;
    };

    button("Open", `Open ${row.label}`).addEventListener(
      "click",
      () => void openOrNotice(this.deps.workspace, row.path),
    );
    // Visible label matches the explorers' per-row "Run"; the aria-label keeps
    // the full "Run <feature label>" so assistive tech still hears the target.
    button("Run", `Run ${row.label}`).addEventListener(
      "click",
      () => void this.deps.runLauncher.launch({ scope: "feature", target: row.path }),
    );
    button("Validate", `Validate ${row.label}`).addEventListener(
      "click",
      () => void this.validate(row.path, resultEl),
    );
    button("Detect missing steps", `Detect missing steps in ${row.label}`).addEventListener(
      "click",
      () => void this.detectMissingSteps(row.path, resultEl),
    );
    button(
      "Generate step definitions",
      `Generate step definitions for ${row.label}`,
    ).addEventListener("click", () => void this.generateStepDefinitions(row.path, resultEl));
  }

  /**
   * Wave F: fills a Feature row's muted health line from FeatureInsightService.
   * Read+parse-per-render is cheap (features are small, matching how
   * traceability works); an unreadable/unparseable Feature leaves the line
   * empty (the Validate action is the place that explains why).
   */
  private async renderFeatureHealth(featurePath: VaultPath, healthEl: HTMLElement): Promise<void> {
    const health = await this.deps.featureInsight.healthFor(featurePath);
    // An event-driven re-render may have replaced the row while we awaited —
    // writing into the detached node would be invisible (same guard as
    // renderChecklist).
    if (!health.ok || !healthEl.isConnected) return;
    const line = featureHealthLine(health.value);
    healthEl.createSpan({ text: line.text });
    if (line.wipBadge) {
      healthEl.createSpan({
        cls: "e2e-test-hub-wip-badge",
        text: "@wip",
        attr: { title: line.wipTooltip, "aria-label": line.wipTooltip },
      });
    }
  }

  /** UC-007: validate the chosen Feature and render the outcome inline. */
  private async validate(featurePath: VaultPath, resultEl: HTMLElement): Promise<void> {
    this.renderChecklist(resultEl, [{ status: "pending", icon: "…", text: "Validating…" }]);
    this.renderChecklist(
      resultEl,
      await validateFeatureOutcome(this.deps.specificationService, featurePath),
    );
  }

  /** UC-010: detect undefined steps for the chosen Feature, rendered inline. */
  private async detectMissingSteps(featurePath: VaultPath, resultEl: HTMLElement): Promise<void> {
    this.renderChecklist(resultEl, [{ status: "pending", icon: "…", text: "Detecting…" }]);
    this.renderChecklist(
      resultEl,
      await detectMissingStepsOutcome(this.deps.specificationService, featurePath),
    );
  }

  /**
   * UC-010 / RV-4: detect the Feature's undefined steps then generate
   * non-destructive step-definition stubs — exactly the two-call orchestration
   * the command palette uses (the logic lives in the services), rendered inline.
   */
  private async generateStepDefinitions(
    featurePath: VaultPath,
    resultEl: HTMLElement,
  ): Promise<void> {
    this.renderChecklist(resultEl, [
      { status: "pending", icon: "…", text: "Generating step definitions…" },
    ]);
    this.renderChecklist(
      resultEl,
      await generateStepDefinitionsOutcome(
        this.deps.specificationService,
        this.deps.stepDefinitionService,
        featurePath,
      ),
    );
  }

  /** Replaces a feature's result container with the given checklist rows. */
  private renderChecklist(container: HTMLElement, rows: ChecklistRow[]): void {
    // The result container is captured when the feature row is built. An inline
    // op (validate/detect/generate) awaits a service call, and an unrelated
    // event can trigger a full re-render in that window — detaching THIS
    // container and replacing it with a fresh one. Writing into the detached
    // node would render the outcome invisibly, so skip it; the freshly rendered
    // row is ready for a re-click.
    if (!container.isConnected) return;
    container.empty();
    for (const row of rows) {
      const el = container.createDiv({
        cls: "e2e-test-hub-settings-check-row",
        text: `${row.icon} ${row.text}`,
      });
      el.dataset.status = row.status;
    }
  }
}

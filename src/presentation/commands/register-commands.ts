import { Notice, type Plugin } from "obsidian";

import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { DocumentationGenerationService } from "../../application/services/documentation-generation-service";
import type { EnvironmentValidationService } from "../../application/services/environment-validation-service";
import type { MaintenanceService } from "../../application/services/maintenance-service";
import type { PipelineGenerationService } from "../../application/services/pipeline-generation-service";
import type { PostRunCoordinator } from "../../application/services/post-run-coordinator";
import type { SpecificationService } from "../../application/services/specification-service";
import type { StepDefinitionService } from "../../application/services/step-definition-service";
import type { SuiteService } from "../../application/services/suite-service";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { TestHubSettings } from "../../domain/settings/settings";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import type { RunLauncher } from "../run/run-launcher";
import { EVIDENCE_EXPLORER_VIEW_TYPE } from "../views/evidence-explorer-view";
import { GenerateFeatureModal } from "../views/generate-feature-modal";
import { GUIDED_TOUR_VIEW_TYPE } from "../views/guided-tour-view";
import { STORY_MAP_VIEW_TYPE } from "../views/story-map-explorer-view";
import { SUITE_VIEW_TYPE } from "../views/suite-dashboard-view";
import { USE_CASE_VIEW_TYPE } from "../views/use-case-dashboard-view";
import { registerRunCommands } from "./register-run-commands";
import { withNonEmptyList } from "./with-non-empty-list";

/**
 * The narrow slice of the composition root the command palette needs: the
 * application services the command bodies orchestrate, the workspace port for
 * opening views, the live settings snapshot, and the few open-a-modal helpers
 * that are shared with ribbons/view registrations (which stay in `main.ts`).
 */
export interface TestHubCommandDeps {
  /** Live in-memory settings snapshot (read at command-invocation time). */
  getSettings(): TestHubSettings;
  validationService: EnvironmentValidationService;
  maintenanceService: MaintenanceService;
  pipelineService: PipelineGenerationService;
  documentationService: DocumentationGenerationService;
  useCaseService: UseCaseService;
  specificationService: SpecificationService;
  stepDefinitionService: StepDefinitionService;
  suiteService: SuiteService;
  /**
   * Shared run-launch surface: starts a scoped run (opening the live console
   * first) and cancels the active run. The same launcher backs the explorer /
   * Test Console buttons, so the launch logic lives in exactly one place (Wave
   * B altitude requirement) rather than being duplicated here.
   */
  runLauncher: RunLauncher;
  postRunCoordinator: Pick<PostRunCoordinator, "importLastRun">;
  workspace: WorkspacePort;
  // Shared with ribbon icons / view registrations in the composition root:
  /** Opens (or reveals) the single Test Hub leaf — the home front door (WS-B1). */
  openHub(): void | Promise<void>;
  openWizard(): void;
  openCreateUseCase(): void;
  openCreateSuite(): void;
  openPrdBuilder(): void;
  openStoryMapBuilder(): void;
  openDocumentation(
    documentType?: "getting-started" | "manual" | "troubleshooting" | "index",
  ): Promise<void>;
}

/**
 * Command bodies the composition root re-uses for view buttons (the Guided
 * Tour's CI step runs the SAME body as the "Generate CI workflow" command, so
 * the logic stays defined once).
 */
export interface RegisteredCommandHelpers {
  generateCiWorkflow(overwriteExisting?: boolean): Promise<void>;
}

/**
 * Registers the Test Hub command-palette surface (moved out of `main.ts`,
 * review P2-7). Commands are thin: each body loads/calls the injected services
 * and surfaces the typed outcome as a Notice — no business logic lives here.
 * Ribbon icons and view registration stay in the composition root.
 */
export function registerCommands(
  plugin: Plugin,
  deps: TestHubCommandDeps,
): RegisteredCommandHelpers {
  const openGenerateFeature = (): Promise<void> =>
    withNonEmptyList(
      deps.useCaseService.findAll(),
      { loadError: "Could not load Use Cases", empty: "No Use Cases yet. Create one first." },
      (useCases) =>
        new GenerateFeatureModal(
          plugin.app,
          {
            useCaseService: deps.useCaseService,
            specificationService: deps.specificationService,
            workspace: deps.workspace,
          },
          useCases,
        ).open(),
    );

  /** Path of the active note, or a Notice when there is no feature open. */
  const activeFeaturePath = (): VaultPath | null => {
    const file = plugin.app.workspace.getActiveFile();
    if (file?.extension !== "feature") {
      new Notice("Open a .feature file first.");
      return null;
    }
    // Obsidian-managed active-file paths are vault-relative and trusted.
    return unsafeVaultPath(file.path);
  };

  const validateActiveFeature = async (): Promise<void> => {
    const path = activeFeaturePath();
    if (path === null) return;
    const result = await deps.specificationService.validate(path);
    if (!result.ok) {
      new Notice(`Validation failed: ${result.error.message}`, 10000);
      return;
    }
    new Notice(
      result.value.valid
        ? "Feature is valid."
        : `Feature has ${result.value.errors.length} issue(s): ${result.value.errors
            .map((e) => e.message)
            .join("; ")}`,
      result.value.valid ? undefined : 10000,
    );
  };

  const detectMissingSteps = async (): Promise<void> => {
    const path = activeFeaturePath();
    if (path === null) return;
    const result = await deps.specificationService.detectMissingSteps(path);
    if (!result.ok) {
      new Notice(`Detection failed: ${result.error.message}`, 10000);
      return;
    }
    new Notice(
      result.value.missingSteps.length === 0
        ? "All steps are defined."
        : `${result.value.missingSteps.length} missing step(s): ${result.value.missingSteps.join(
            "; ",
          )}`,
      10000,
    );
  };

  /**
   * UC-010 / RV-4: detect the active feature's undefined steps via
   * `SpecificationService`, then generate non-destructive step-definition stubs
   * via `StepDefinitionService`. Generation is an explicit user command (not
   * auto-on-every-edit); the detection event's id is threaded through as the
   * `causationId` of `stepdefinition.generated` (Event Catalog §5), so a future
   * auto-path can reuse the same wiring. Logic lives in the services — this only
   * orchestrates the two calls and surfaces the outcome as a Notice.
   *
   * Deliberately does NOT re-detect after a successful generate (dropped in
   * the root-fix pass, Codex P2s on PR #102): a second, now-zero-missing
   * detect publishes `specification.missingSteps.detected`, which the Guided
   * Tour's implement-steps step treats as done — bddgen counts the generated
   * `throw new Error("Pending")` stubs as defined, so the tour would
   * prematurely complete right after Generate. The coverage cache instead
   * records on the next REAL detect (a manual Detect, or the Pending Steps
   * panel's Verify).
   */
  const generateStepDefinitions = async (): Promise<void> => {
    const path = activeFeaturePath();
    if (path === null) return;
    const detected = await deps.specificationService.detectMissingSteps(path);
    if (!detected.ok) {
      new Notice(`Detection failed: ${detected.error.message}`, 10000);
      return;
    }
    if (detected.value.missingSteps.length === 0) {
      new Notice("No missing steps — nothing to generate.");
      return;
    }
    const generated = await deps.stepDefinitionService.generate(
      path,
      detected.value.missingSteps,
      detected.value.detectionEventId,
    );
    if (!generated.ok) {
      new Notice(`Could not generate step definitions: ${generated.error.message}`, 10000);
      return;
    }
    const count = generated.value.generatedSteps.length;
    new Notice(
      count === 0
        ? "No missing steps — nothing to generate."
        : `Generated ${count} step stub(s) in ${generated.value.stepFile}.`,
    );
  };

  const validateEnvironment = async (): Promise<void> => {
    new Notice("Validating environment…");
    const result = await deps.validationService.validateEnvironment();
    // A valid runner may still carry non-error advisories (e.g. an outdated
    // .testrunner manifest → Repair); surface their count rather than a bare
    // "ready" so the hint to run Repair isn't swallowed.
    const advisories = result.issues.filter((issue) => issue.severity !== "error");
    const readyMessage =
      advisories.length > 0
        ? `Environment ready (${advisories.length} advisory: run Repair installation).`
        : "Environment is ready.";
    new Notice(
      result.valid
        ? readyMessage
        : `Environment has ${result.issues.length} issue(s): ${result.issues
            .map((issue) => issue.message)
            .join("; ")}`,
      result.valid && advisories.length === 0 ? undefined : 10000,
    );
  };

  const repairInstallation = async (): Promise<void> => {
    new Notice("Repairing .testrunner installation…");
    const result = await deps.maintenanceService.repair();
    if (result.ok) {
      new Notice(
        `Repaired the .testrunner: ${result.value.repairedFiles.length} file(s) re-synced.`,
      );
    } else {
      new Notice(`Repair failed: ${result.error.message}`, 10000);
    }
  };

  // EPIC-010 CI/CD (US-040, UC-019): write the GitHub Actions workflow into the
  // user's repo. UI is thin — the generate/overwrite policy lives in the service.
  const generateCiWorkflow = async (overwriteExisting = false): Promise<void> => {
    new Notice(overwriteExisting ? "Overwriting CI workflow…" : "Generating CI workflow…");
    const settings = deps.getSettings();
    const result = await deps.pipelineService.generate({
      provider: settings.ci.provider,
      settings,
      overwriteExisting,
    });
    if (result.ok) {
      new Notice(`CI workflow written to ${result.value.path}.`);
    } else if (!overwriteExisting && result.error.details?.path) {
      // The file exists; make the documented overwrite flow reachable (UC-019).
      new Notice(
        `${result.error.message} Use "Setup — overwrite CI workflow" to replace it.`,
        10000,
      );
    } else {
      new Notice(`Could not generate CI workflow: ${result.error.message}`, 10000);
    }
  };

  // US-041 / UC-020: report whether the repo is ready for CI.
  const checkCiReadiness = async (): Promise<void> => {
    new Notice("Checking CI readiness…");
    const result = await deps.validationService.validateCiReadiness(deps.getSettings());
    // Spell out the warnings (e.g. which repository secrets to create), not just
    // a count — this Notice is the only UI surface for the readiness result.
    const warnings = result.warnings.length > 0 ? `\nWarnings: ${result.warnings.join("; ")}` : "";
    if (result.ready) {
      new Notice(`CI is ready.${warnings}`, warnings ? 10000 : undefined);
    } else {
      new Notice(`CI not ready — missing: ${result.missingItems.join("; ")}${warnings}`, 10000);
    }
  };

  // EPIC-011 FEAT-024 (US-043/044/045, UC-021/022/023): write the document set
  // into the vault's documentation folder and emit `documentation.generated`.
  const generateDocumentation = async (): Promise<void> => {
    new Notice("Generating Test Hub documentation…");
    const result = await deps.documentationService.generate();
    if (result.ok) {
      new Notice(`Documentation generated (${result.value.documents.length} note(s)).`);
    } else {
      new Notice(`Could not generate documentation: ${result.error.message}`, 10000);
    }
  };

  plugin.addCommand({
    id: "initialize-test-hub",
    name: "Setup — initialize Test Hub",
    callback: () => deps.openWizard(),
  });
  // Palette hygiene (WS-B3, 01-§3.4): every command name is grouped
  // `<Area> — <verb>` over the domain areas (Plan / Build / Run / Review / Setup /
  // Help) so commands cluster and read as a family under Obsidian's auto-applied
  // "Specorator Testrunner:" plugin prefix. Command IDS are unchanged so existing
  // hotkeys survive. Verb casing stays Obsidian sentence-case; only glossary proper
  // nouns (Test Hub, Use Case, Test Suite, Test Run, Demo Test, PRD, Story Map, …)
  // and acronyms (CI) keep their capitals.
  plugin.addCommand({
    id: "validate-environment",
    name: "Setup — validate environment",
    callback: () => void validateEnvironment(),
  });
  plugin.addCommand({
    id: "repair-installation",
    name: "Setup — repair installation",
    callback: () => void repairInstallation(),
  });
  plugin.addCommand({
    id: "generate-ci-workflow",
    name: "Setup — generate CI workflow",
    callback: () => void generateCiWorkflow(),
  });
  plugin.addCommand({
    id: "overwrite-ci-workflow",
    name: "Setup — overwrite CI workflow",
    callback: () => void generateCiWorkflow(true),
  });
  plugin.addCommand({
    id: "check-ci-readiness",
    name: "Setup — check CI readiness",
    callback: () => void checkCiReadiness(),
  });
  // "New …" matches the dashboard quick actions and explorer header buttons.
  plugin.addCommand({
    id: "create-use-case",
    name: "Build — new Use Case",
    callback: () => deps.openCreateUseCase(),
  });
  plugin.addCommand({
    id: "open-use-cases",
    name: "Build — open Use Cases",
    callback: () => void deps.workspace.openView(USE_CASE_VIEW_TYPE),
  });
  plugin.addCommand({
    id: "create-test-suite",
    name: "Run — new Test Suite",
    callback: () => deps.openCreateSuite(),
  });
  plugin.addCommand({
    id: "create-prd",
    name: "Plan — new PRD",
    callback: () => deps.openPrdBuilder(),
  });
  plugin.addCommand({
    id: "create-story-map",
    name: "Plan — new Story Map",
    callback: () => deps.openStoryMapBuilder(),
  });
  plugin.addCommand({
    id: "open-story-maps",
    name: "Plan — open Story Maps",
    callback: () => void deps.workspace.openView(STORY_MAP_VIEW_TYPE, "sidebar"),
  });
  plugin.addCommand({
    id: "open-test-suites",
    name: "Run — open Test Suites",
    callback: () => void deps.workspace.openView(SUITE_VIEW_TYPE),
  });
  plugin.addCommand({
    id: "open-evidence-explorer",
    name: "Review — open Evidence Explorer",
    callback: () => void deps.workspace.openView(EVIDENCE_EXPLORER_VIEW_TYPE),
  });
  plugin.addCommand({
    id: "generate-feature",
    name: "Build — generate feature from Use Case",
    callback: () => void openGenerateFeature(),
  });
  plugin.addCommand({
    id: "validate-feature",
    name: "Build — validate feature",
    callback: () => void validateActiveFeature(),
  });
  plugin.addCommand({
    id: "detect-missing-steps",
    name: "Build — detect missing steps",
    callback: () => void detectMissingSteps(),
  });
  // UC-010 / RV-4: explicit user command (NOT auto-on-edit) — detect the
  // active feature's missing steps, then generate non-destructive stubs.
  plugin.addCommand({
    id: "generate-step-definitions",
    name: "Build — generate step definitions",
    callback: () => void generateStepDefinitions(),
  });

  registerRunCommands(plugin, deps);

  // The Test Hub home front door (WS-B1). The id stays `open-dashboard` so any
  // existing user hotkey survives; the hub supersedes the old dashboard (which now
  // redirects to it). Unprefixed because the hub spans every area — it isn't one.
  plugin.addCommand({
    id: "open-dashboard",
    name: "Open Test Hub",
    callback: () => void deps.openHub(),
  });

  // EPIC-011 Documentation (FEAT-024 US-043/044/045, FEAT-025 US-046).
  plugin.addCommand({
    id: "generate-documentation",
    name: "Help — generate documentation",
    callback: () => void generateDocumentation(),
  });
  plugin.addCommand({
    id: "open-documentation",
    name: "Help — open documentation",
    callback: () => void deps.openDocumentation(),
  });
  plugin.addCommand({
    id: "open-user-manual",
    name: "Help — open user manual",
    callback: () => void deps.openDocumentation("manual"),
  });
  plugin.addCommand({
    id: "open-troubleshooting",
    name: "Help — open troubleshooting",
    callback: () => void deps.openDocumentation("troubleshooting"),
  });

  plugin.addCommand({
    id: "open-guided-tour",
    name: "Help — open guided tour",
    callback: () => void deps.workspace.openView(GUIDED_TOUR_VIEW_TYPE, "sidebar"),
  });

  return { generateCiWorkflow };
}

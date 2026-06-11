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
import { DASHBOARD_VIEW_TYPE } from "../views/dashboard-view";
import { EVIDENCE_EXPLORER_VIEW_TYPE } from "../views/evidence-explorer-view";
import { GenerateFeatureModal } from "../views/generate-feature-modal";
import { RunPickerModal } from "../views/run-picker-modal";
import { SUITE_VIEW_TYPE } from "../views/suite-dashboard-view";
import { TEST_CONSOLE_VIEW_TYPE } from "../views/test-console-view";
import { USE_CASE_VIEW_TYPE } from "../views/use-case-dashboard-view";

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
  openWizard(): void;
  openCreateUseCase(): void;
  openCreateSuite(): void;
  openDocumentation(
    documentType?: "getting-started" | "manual" | "troubleshooting" | "index",
  ): Promise<void>;
}

/**
 * Registers the Test Hub command-palette surface (moved out of `main.ts`,
 * review P2-7). Commands are thin: each body loads/calls the injected services
 * and surfaces the typed outcome as a Notice — no business logic lives here.
 * Ribbon icons and view registration stay in the composition root.
 */
export function registerCommands(plugin: Plugin, deps: TestHubCommandDeps): void {
  /**
   * Re-runs report import + evidence for the last finished run on demand
   * (UC-016, US-032). The eligibility rule and serialization live in the
   * coordinator; this surfaces its typed outcome as a Notice.
   */
  const importLastRun = async (): Promise<void> => {
    const result = await deps.postRunCoordinator.importLastRun();
    if (!result.ok) {
      new Notice(`Report import failed: ${result.error.message}`, 10000);
      return;
    }
    switch (result.value.kind) {
      case "imported":
        new Notice(`Evidence written to ${result.value.evidencePath}`);
        break;
      case "recorded":
        new Notice("Last run recorded (evidence Markdown generation is disabled).");
        break;
      case "no-run":
        new Notice("No Test Run to import a report for yet.");
        break;
      case "no-report":
        new Notice("The last run produced no report to import (it did not finish a Test Run).");
        break;
      case "run-in-progress":
        new Notice("A Test Run is in progress; import its report once it finishes.");
        break;
      case "ineligible":
        new Notice(`The last run (${result.value.status}) produced no report to import.`);
        break;
    }
  };

  const runSuite = async (): Promise<void> => {
    const suites = await deps.suiteService.findAll();
    if (!suites.ok) {
      new Notice(`Could not load Test Suites: ${suites.error.message}`, 10000);
      return;
    }
    if (suites.value.length === 0) {
      new Notice("No Test Suites yet. Create one first.");
      return;
    }
    new RunPickerModal(
      plugin.app,
      "Select a Test Suite to run",
      suites.value.map((s) => ({ id: s.id, label: `${s.id} — ${s.name}` })),
      (id) => void deps.runLauncher.launch({ scope: "suite", target: id }),
    ).open();
  };

  const runUseCase = async (): Promise<void> => {
    const useCases = await deps.useCaseService.findAll();
    if (!useCases.ok) {
      new Notice(`Could not load Use Cases: ${useCases.error.message}`, 10000);
      return;
    }
    if (useCases.value.length === 0) {
      new Notice("No Use Cases yet. Create one first.");
      return;
    }
    new RunPickerModal(
      plugin.app,
      "Select a Use Case to run",
      useCases.value.map((u) => ({ id: u.id, label: `${u.id} — ${u.title}` })),
      (id) => void deps.runLauncher.launch({ scope: "use-case", target: id }),
    ).open();
  };

  const runFeature = async (): Promise<void> => {
    // `.feature` discovery (recursive listing, `.feature` filter, folder-relative
    // labels) lives in SpecificationService.listFeatures (P2-7).
    const listed = await deps.specificationService.listFeatures();
    if (!listed.ok) {
      new Notice(`Could not list Feature files: ${listed.error.message}`, 10000);
      return;
    }
    if (listed.value.length === 0) {
      new Notice("No Feature files yet. Generate one first.");
      return;
    }
    new RunPickerModal(
      plugin.app,
      "Select a Feature file to run",
      listed.value.map((feature) => ({ id: feature.path, label: feature.label })),
      (path) => void deps.runLauncher.launch({ scope: "feature", target: path }),
    ).open();
  };

  const openGenerateFeature = async (): Promise<void> => {
    const useCases = await deps.useCaseService.findAll();
    if (!useCases.ok) {
      new Notice(`Could not load Use Cases: ${useCases.error.message}`, 10000);
      return;
    }
    if (useCases.value.length === 0) {
      new Notice("No Use Cases yet. Create one first.");
      return;
    }
    new GenerateFeatureModal(
      plugin.app,
      {
        useCaseService: deps.useCaseService,
        specificationService: deps.specificationService,
        workspace: deps.workspace,
      },
      useCases.value,
    ).open();
  };

  /** Path of the active note, or a Notice when there is no feature open. */
  const activeFeaturePath = (): VaultPath | null => {
    const file = plugin.app.workspace.getActiveFile();
    if (!file || file.extension !== "feature") {
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
    new Notice(
      result.valid
        ? "Environment is ready."
        : `Environment has ${result.issues.length} issue(s): ${result.issues
            .map((issue) => issue.message)
            .join("; ")}`,
      result.valid ? undefined : 10000,
    );
  };

  const repairInstallation = async (): Promise<void> => {
    new Notice("Repairing runner installation…");
    const result = await deps.maintenanceService.repair();
    if (result.ok) {
      new Notice(`Runner repaired: ${result.value.repairedFiles.length} file(s) re-synced.`);
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
      new Notice(`${result.error.message} Use "Overwrite CI Workflow" to replace it.`, 10000);
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
    name: "Initialize Test Hub",
    callback: () => deps.openWizard(),
  });
  plugin.addCommand({
    id: "validate-environment",
    name: "Validate Environment",
    callback: () => void validateEnvironment(),
  });
  plugin.addCommand({
    id: "repair-installation",
    name: "Repair Installation",
    callback: () => void repairInstallation(),
  });
  plugin.addCommand({
    id: "generate-ci-workflow",
    name: "Generate CI Workflow",
    callback: () => void generateCiWorkflow(),
  });
  plugin.addCommand({
    id: "overwrite-ci-workflow",
    name: "Overwrite CI Workflow",
    callback: () => void generateCiWorkflow(true),
  });
  plugin.addCommand({
    id: "check-ci-readiness",
    name: "Check CI Readiness",
    callback: () => void checkCiReadiness(),
  });
  plugin.addCommand({
    id: "create-use-case",
    name: "Create Use Case",
    callback: () => deps.openCreateUseCase(),
  });
  plugin.addCommand({
    id: "open-use-cases",
    name: "Open Use Cases",
    callback: () => void deps.workspace.openView(USE_CASE_VIEW_TYPE),
  });
  plugin.addCommand({
    id: "create-test-suite",
    name: "Create Test Suite",
    callback: () => deps.openCreateSuite(),
  });
  plugin.addCommand({
    id: "open-test-suites",
    name: "Open Test Suites",
    callback: () => void deps.workspace.openView(SUITE_VIEW_TYPE),
  });
  plugin.addCommand({
    id: "open-evidence-explorer",
    name: "Open Evidence Explorer",
    callback: () => void deps.workspace.openView(EVIDENCE_EXPLORER_VIEW_TYPE),
  });
  plugin.addCommand({
    id: "generate-feature",
    name: "Generate Feature from Use Case",
    callback: () => void openGenerateFeature(),
  });
  plugin.addCommand({
    id: "validate-feature",
    name: "Validate Feature",
    callback: () => void validateActiveFeature(),
  });
  plugin.addCommand({
    id: "detect-missing-steps",
    name: "Detect Missing Steps",
    callback: () => void detectMissingSteps(),
  });
  // UC-010 / RV-4: explicit user command (NOT auto-on-edit) — detect the
  // active feature's missing steps, then generate non-destructive stubs.
  plugin.addCommand({
    id: "generate-step-definitions",
    name: "Generate Step Definitions",
    callback: () => void generateStepDefinitions(),
  });

  // EPIC-007 Test Execution (US-026/027/028/029/030).
  plugin.addCommand({
    id: "run-demo-test",
    name: "Run Demo Test",
    callback: () => void deps.runLauncher.launch({ scope: "demo", target: "demo" }),
  });
  plugin.addCommand({
    id: "run-all-tests",
    name: "Run All Tests",
    callback: () => void deps.runLauncher.launch({ scope: "all", target: "all" }),
  });
  plugin.addCommand({
    id: "run-suite",
    name: "Run Suite…",
    callback: () => void runSuite(),
  });
  plugin.addCommand({
    id: "run-use-case",
    name: "Run Use Case…",
    callback: () => void runUseCase(),
  });
  plugin.addCommand({
    id: "run-feature",
    name: "Run Feature…",
    callback: () => void runFeature(),
  });
  plugin.addCommand({
    id: "cancel-test-run",
    name: "Cancel Test Run",
    callback: () => void deps.runLauncher.cancel(),
  });
  plugin.addCommand({
    id: "open-test-console",
    name: "Open Test Console",
    callback: () => void deps.workspace.openView(TEST_CONSOLE_VIEW_TYPE, "sidebar"),
  });

  // EPIC-008 (US-032 / UC-016): re-run report import + evidence for the last run.
  plugin.addCommand({
    id: "import-report-last-run",
    name: "Import Report for Last Run",
    callback: () => void importLastRun(),
  });

  // EPIC-009 Dashboard (UC-018).
  plugin.addCommand({
    id: "open-dashboard",
    name: "Open Dashboard",
    callback: () => void deps.workspace.openView(DASHBOARD_VIEW_TYPE),
  });

  // EPIC-011 Documentation (FEAT-024 US-043/044/045, FEAT-025 US-046).
  plugin.addCommand({
    id: "generate-documentation",
    name: "Generate Documentation",
    callback: () => void generateDocumentation(),
  });
  plugin.addCommand({
    id: "open-documentation",
    name: "Open Documentation",
    callback: () => void deps.openDocumentation(),
  });
  plugin.addCommand({
    id: "open-user-manual",
    name: "Open User Manual",
    callback: () => void deps.openDocumentation("manual"),
  });
  plugin.addCommand({
    id: "open-troubleshooting",
    name: "Open Troubleshooting",
    callback: () => void deps.openDocumentation("troubleshooting"),
  });
}

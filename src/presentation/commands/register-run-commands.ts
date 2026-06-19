import { Notice, type Plugin } from "obsidian";

import { RunPickerModal } from "../views/run-picker-modal";
import { TEST_CONSOLE_VIEW_TYPE } from "../views/test-console-view";
import type { ImportLastRunOutcome } from "../../application/services/post-run-coordinator";
import type { TestHubCommandDeps } from "./register-commands";
import { withNonEmptyList } from "./with-non-empty-list";

/**
 * The Notice text for an import-last-run outcome (UC-016 / US-032): one message
 * per outcome kind. Kept pure + exported so every branch is unit-tested without
 * the command-registration machinery.
 */
export const importReportNotice = (outcome: ImportLastRunOutcome): string => {
  switch (outcome.kind) {
    case "imported":
      return `Evidence written to ${outcome.evidencePath}`;
    case "recorded":
      return "Last run recorded (evidence Markdown generation is disabled).";
    case "no-run":
      return "No Test Run to import a report for yet.";
    case "no-report":
      return "The last run produced no report to import (it did not finish a Test Run).";
    case "run-in-progress":
      return "A Test Run is in progress; import its report once it finishes.";
    case "ineligible":
      return `The last run (${outcome.status}) produced no report to import.`;
  }
};

/**
 * Registers the test-execution command-palette surface — Run … (demo / all /
 * suite / use case / feature), Cancel Test Run, Open Test Console, and Import
 * report for last run (EPIC-007/008). Split out of {@link registerCommands} to
 * keep that file under the size budget. Bodies stay thin: load/call the
 * injected services and surface the typed outcome as a Notice.
 */
export const registerRunCommands = (plugin: Plugin, deps: TestHubCommandDeps): void => {
  /**
   * Re-runs report import + evidence for the last finished run on demand
   * (UC-016, US-032). The eligibility rule and serialization live in the
   * coordinator; this surfaces its typed outcome as a Notice ({@link
   * importReportNotice} maps each outcome kind to its message).
   */
  const importLastRun = async (): Promise<void> => {
    const result = await deps.postRunCoordinator.importLastRun();
    if (!result.ok) {
      new Notice(`Report import failed: ${result.error.message}`, 10000);
      return;
    }
    new Notice(importReportNotice(result.value));
  };

  const runSuite = (): Promise<void> =>
    withNonEmptyList(
      deps.suiteService.findAll(),
      { loadError: "Could not load Test Suites", empty: "No Test Suites yet. Create one first." },
      (suites) =>
        new RunPickerModal(
          plugin.app,
          "Select a Test Suite to run",
          suites.map((s) => ({ id: s.id, label: `${s.id} — ${s.name}` })),
          (id) => void deps.runLauncher.launch({ scope: "suite", target: id }),
        ).open(),
    );

  const runUseCase = (): Promise<void> =>
    withNonEmptyList(
      deps.useCaseService.findAll(),
      { loadError: "Could not load Use Cases", empty: "No Use Cases yet. Create one first." },
      (useCases) =>
        new RunPickerModal(
          plugin.app,
          "Select a Use Case to run",
          useCases.map((u) => ({ id: u.id, label: `${u.id} — ${u.title}` })),
          (id) => void deps.runLauncher.launch({ scope: "use-case", target: id }),
        ).open(),
    );

  const runFeature = (): Promise<void> =>
    // `.feature` discovery (recursive listing, `.feature` filter, folder-relative
    // labels) lives in SpecificationService.listFeatures (P2-7).
    withNonEmptyList(
      deps.specificationService.listFeatures(),
      {
        loadError: "Could not list Feature files",
        empty: "No feature files yet. Generate one first.",
      },
      (features) =>
        new RunPickerModal(
          plugin.app,
          "Select a Feature file to run",
          features.map((feature) => ({ id: feature.path, label: feature.label })),
          (path) => void deps.runLauncher.launch({ scope: "feature", target: path }),
        ).open(),
    );

  // EPIC-007 Test Execution (US-026/027/028/029/030).
  plugin.addCommand({
    id: "run-demo-test",
    name: "Run Demo Test",
    callback: () => void deps.runLauncher.launch({ scope: "demo", target: "demo" }),
  });
  plugin.addCommand({
    id: "run-all-tests",
    name: "Run all tests",
    callback: () => void deps.runLauncher.launch({ scope: "all", target: "all" }),
  });
  plugin.addCommand({
    id: "run-suite",
    name: "Run Test Suite…",
    callback: () => void runSuite(),
  });
  plugin.addCommand({
    id: "run-use-case",
    name: "Run Use Case…",
    callback: () => void runUseCase(),
  });
  plugin.addCommand({
    id: "run-feature",
    name: "Run feature…",
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
    name: "Import report for last run",
    callback: () => void importLastRun(),
  });
};

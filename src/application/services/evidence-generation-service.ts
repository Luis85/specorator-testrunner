import type { ImportedReport, ScenarioResult } from "./report-import-service";
import type { SettingsService } from "./settings-service";
import type { UseCaseService } from "./use-case-service";
import { useCaseIdFromPath } from "../content/gherkin";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { Evidence, EvidenceArtifact } from "../../domain/entities/evidence";
import type { TestRun, TestRunResult, TestRunStatus } from "../../domain/entities/test-run";
import type {
  EvidenceId,
  RunId,
  UseCaseId,
  VaultPath,
} from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { buildNote } from "../../shared/utils/frontmatter";
import { joinVaultPath } from "../../shared/utils/vault-path";

/** Evidence generation contract (TIS §8.12, UC-016). */
export interface EvidenceGenerationService {
  generate(request: GenerateEvidenceRequest): Promise<Result<Evidence>>;
}

export interface GenerateEvidenceRequest {
  run: TestRun;
  report: ImportedReport;
}

/** `RUN-2026-05-31-...` → derived overall status for US-031 surfacing. */
const overallStatus = (result: TestRunResult): "passed" | "failed" | "skipped" => {
  if (result.failed > 0) return "failed";
  if (result.passed > 0) return "passed";
  return "skipped";
};

/**
 * Builds an auditable Markdown evidence note for a finished run (TIS §8.12,
 * ADR-0005 Markdown evidence) and links it into the owning Use Case(s).
 *
 * The note is partitioned `Test Evidence/YYYY/MM/<runId>/summary.md` from the
 * run's `startedAt` (ADR-0016). Artifacts are linked, never copied (US-033/034).
 * Emits `evidence.generated`, then `evidence.linkedToUseCase` per Use Case.
 */
export class DefaultEvidenceGenerationService implements EvidenceGenerationService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly useCaseService: UseCaseService,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate({ run, report }: GenerateEvidenceRequest): Promise<Result<Evidence>> {
    const createdAt = this.now().toISOString();
    const settings = await this.settingsService.load();
    const evidencePath = this.evidencePath(run, settings.paths.evidencePath);
    const linkedUseCases = await this.resolveUseCases(run, report);

    const evidence: Evidence = {
      id: this.evidenceId(run.id),
      runId: run.id,
      path: evidencePath,
      linkedUseCases,
      result: report.result,
      createdAt,
      artifacts: report.artifacts,
    };

    const folder = evidencePath.slice(0, evidencePath.lastIndexOf("/"));
    await this.fs.createFolder(folder);
    // writeFile (overwrite) so re-importing the same run refreshes the note;
    // the evidence path is deterministic per runId and createFile would throw.
    // Resolve each linked UC's note basename so the wikilink resolves in
    // Obsidian (the note is `UC-001 Title.md`, so bare `[[UC-001]]` would not).
    const ucNoteNames = await this.resolveUseCaseNoteNames(linkedUseCases);
    const written = await this.fs.writeFile(
      evidencePath,
      this.renderNote(evidence, report, ucNoteNames),
    );
    if (!written.ok) {
      return err(
        appError("EVIDENCE_WRITE_FAILED", `Could not write evidence note "${evidencePath}".`, {
          details: { runId: run.id, path: evidencePath },
          cause: written.error,
        }),
      );
    }

    await this.eventBus.publish(
      createEvent(
        "evidence.generated",
        { runId: run.id, evidencePath, linkedUseCases },
        { correlationId: run.id },
      ),
    );
    this.logger.info("Evidence generated", { runId: run.id, path: evidencePath });

    // Honor the opt-out: only write the evidence link into Use Case frontmatter
    // when the user hasn't disabled it (TIS §settings.automation).
    if (settings.automation.updateUseCaseFrontmatterAfterRun) {
      await this.link(evidence, this.summaryStatus(run, report.result));
    }
    return ok(evidence);
  }

  /**
   * `TestRunSummary.status` for the owning Use Case: prefer the run's terminal
   * status, falling back to a result-derived passed/failed when the run object
   * carries a non-terminal status (e.g. an on-demand re-import).
   */
  private summaryStatus(run: TestRun, result: TestRunResult): TestRunStatus {
    if (run.status === "passed" || run.status === "failed") return run.status;
    if (run.status === "cancelled" || run.status === "errored") return run.status;
    return result.failed > 0 ? "failed" : "passed";
  }

  /** Appends the evidence path + last-run summary to each owning Use Case. */
  private async link(evidence: Evidence, summaryStatus: TestRunStatus): Promise<void> {
    for (const useCaseId of evidence.linkedUseCases) {
      const found = await this.useCaseService.findById(useCaseId);
      if (!found.ok || found.value === null) {
        this.logger.warn("Use Case for evidence linking not found", { useCaseId });
        continue;
      }
      const useCase = found.value;
      // De-dupe so re-running the same scenario does not append the same path.
      const alreadyLinked = useCase.evidence.includes(evidence.path);
      const updated = {
        ...useCase,
        evidence: alreadyLinked ? useCase.evidence : [...useCase.evidence, evidence.path],
        lastTestRun: {
          runId: evidence.runId,
          status: summaryStatus,
          date: evidence.createdAt,
          evidencePath: evidence.path,
        },
      };
      const result = await this.useCaseService.update(updated);
      if (!result.ok) {
        this.logger.warn("Could not link evidence into Use Case", {
          useCaseId,
          reason: result.error.message,
        });
        continue;
      }
      await this.eventBus.publish(
        createEvent(
          "evidence.linkedToUseCase",
          { useCaseId, evidencePath: evidence.path },
          { correlationId: evidence.runId },
        ),
      );
    }
  }

  /**
   * Resolves the owning Use Case(s) for a run (pragmatic per scope):
   * - `use-case`: the target id directly;
   * - `feature`: the `UC-NNN` prefix of the feature filename (ADR-0012);
   * - `suite` / `all` / `demo`: any `UC-NNN` prefixes found on the report's
   *   scenario feature paths (may be many, or none — evidence still stands
   *   alone via its note).
   */
  private async resolveUseCases(run: TestRun, report: ImportedReport): Promise<UseCaseId[]> {
    const ids = new Set<UseCaseId>();
    if (run.scope === "use-case") {
      ids.add(run.target);
    } else if (run.scope === "feature") {
      const id = useCaseIdFromPath(run.target);
      if (id) ids.add(id);
    } else {
      for (const scenario of report.scenarioResults) {
        // Use the feature file path (uri); the human-readable name has no
        // UC-NNN prefix to derive the owning Use Case from.
        const id = useCaseIdFromPath(scenario.featureUri ?? scenario.feature);
        if (id) ids.add(id);
      }
    }
    // Keep only Use Cases that exist (best-effort; an unknown id is dropped).
    const resolved: UseCaseId[] = [];
    for (const id of ids) {
      const found = await this.useCaseService.findById(id);
      if (found.ok && found.value !== null) resolved.push(id);
    }
    return resolved;
  }

  /** `Test Evidence/YYYY/MM/<runId>/summary.md` from the run start (ADR-0016). */
  private evidencePath(run: TestRun, root: VaultPath): VaultPath {
    const started = new Date(run.startedAt);
    const valid = Number.isNaN(started.getTime()) ? this.now() : started;
    const year = String(valid.getUTCFullYear());
    const month = String(valid.getUTCMonth() + 1).padStart(2, "0");
    return joinVaultPath(root, year, month, run.id, "summary.md");
  }

  /** `EV-<runId without RUN- prefix>` (TIS §10.3 id form). */
  private evidenceId(runId: RunId): EvidenceId {
    return `EV-${runId.replace(/^RUN-/, "")}`;
  }

  /** Resolves each UC id to its note basename (without `.md`) for wikilinks. */
  private async resolveUseCaseNoteNames(ids: UseCaseId[]): Promise<Map<UseCaseId, string>> {
    const names = new Map<UseCaseId, string>();
    for (const id of ids) {
      const found = await this.useCaseService.findById(id);
      if (found.ok && found.value) {
        names.set(id, (found.value.path.split("/").pop() ?? id).replace(/\.md$/, ""));
      }
    }
    return names;
  }

  /** Renders the evidence note (frontmatter TIS §10.3, body ADR-0005). */
  private renderNote(
    evidence: Evidence,
    report: ImportedReport,
    ucNoteNames: Map<UseCaseId, string>,
  ): string {
    const { result } = evidence;
    const screenshots = evidence.artifacts.filter((a) => a.type === "screenshot");
    const traces = evidence.artifacts.filter((a) => a.type === "trace");

    return buildNote(
      {
        type: "test-evidence",
        id: evidence.id,
        run_id: evidence.runId,
        status: overallStatus(result),
        created_at: evidence.createdAt,
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        total: result.total,
        linked_use_cases: evidence.linkedUseCases.length > 0 ? evidence.linkedUseCases : undefined,
        screenshots: screenshots.length > 0 ? screenshots.map((a) => a.path) : undefined,
        traces: traces.length > 0 ? traces.map((a) => a.path) : undefined,
      },
      this.renderBody(evidence, report, ucNoteNames),
    );
  }

  private renderBody(
    evidence: Evidence,
    report: ImportedReport,
    ucNoteNames: Map<UseCaseId, string>,
  ): string {
    const { result } = evidence;
    const sections = [
      `# Test Evidence — ${evidence.runId}`,
      "",
      `> Status: **${overallStatus(result).toUpperCase()}** · ${evidence.createdAt}`,
      "",
      "## Results",
      "",
      "| Passed | Failed | Skipped | Total |",
      "| --- | --- | --- | --- |",
      `| ${result.passed} | ${result.failed} | ${result.skipped} | ${result.total} |`,
      "",
      "## Scenarios",
      "",
      ...this.renderScenarios(report.scenarioResults),
      "",
      "## Artifacts",
      "",
      ...this.renderArtifacts(evidence.artifacts),
    ];
    if (evidence.linkedUseCases.length > 0) {
      sections.push("", "## Linked Use Cases", "");
      for (const id of evidence.linkedUseCases) {
        const noteName = ucNoteNames.get(id);
        // [[Note Name|UC-001]] resolves to the real note while showing the id.
        sections.push(noteName ? `- [[${noteName}|${id}]]` : `- [[${id}]]`);
      }
    }
    return `${sections.join("\n")}\n`;
  }

  private renderScenarios(scenarios: ScenarioResult[]): string[] {
    if (scenarios.length === 0) return ["_No scenarios reported._"];
    return scenarios.map((scenario) => {
      const duration = scenario.durationMs !== undefined ? ` (${scenario.durationMs} ms)` : "";
      const name = scenario.scenario || "(unnamed scenario)";
      const where = scenario.feature ? ` — ${scenario.feature}` : "";
      return `- \`${scenario.status}\` ${name}${where}${duration}`;
    });
  }

  private renderArtifacts(artifacts: EvidenceArtifact[]): string[] {
    if (artifacts.length === 0) return ["_No artifacts captured._"];
    // Links into .testrunner/reports — references only, never copies (ADR-0016).
    return artifacts.map((artifact) => {
      const label = artifact.label ?? artifact.type;
      return `- ${artifact.type}: [[${artifact.path}|${label}]]`;
    });
  }
}

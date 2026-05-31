import type { EvidenceId, RunId, UseCaseId, VaultPath } from "../value-objects/identifiers";
import type { TestRunResult } from "./test-run";

/** Evidence domain types (TIS §6.14–§6.15, ADR-0005/0016). */

/**
 * A reference to an artifact the runner produced under `.testrunner/reports`
 * (TIS §6.15). Evidence links to these — it never copies the bytes into the
 * vault (US-033/034, ADR-0016).
 */
export interface EvidenceArtifact {
  type: "report" | "screenshot" | "trace" | "log";
  path: VaultPath; // VaultPath into .testrunner/reports — link, do not duplicate
  label?: string;
}

/** An auditable Markdown evidence record for a single test run (TIS §6.14). */
export interface Evidence {
  id: EvidenceId;
  runId: RunId;
  path: VaultPath; // the Markdown evidence note
  linkedUseCases: UseCaseId[];
  result: TestRunResult;
  createdAt: string;
  artifacts: EvidenceArtifact[]; // references, not copies
}

import type { TestRun } from "../../domain/entities/test-run";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { joinVaultPath } from "../../shared/utils/vault-path";

/**
 * `<evidenceRoot>/YYYY/MM/<runId>` — the per-run Evidence partition folder
 * (ADR-0016). The Evidence note (`summary.md`) and the scenario-history NDJSON
 * log both live under it, so the date-bucket computation is defined once here
 * rather than copied into each writer. The run's `startedAt` drives the YYYY/MM
 * bucket; a malformed timestamp falls back to `now()` so a corrupt run still
 * lands inside the date tree rather than directly at the evidence root.
 */
export const evidenceRunFolder = (root: VaultPath, run: TestRun, now: () => Date): VaultPath => {
  const started = new Date(run.startedAt);
  const valid = Number.isNaN(started.getTime()) ? now() : started;
  const year = String(valid.getUTCFullYear());
  const month = String(valid.getUTCMonth() + 1).padStart(2, "0");
  return joinVaultPath(root, year, month, run.id);
};

import type { ScenarioResult } from "../ports/report-parser";

const RANK: Record<ScenarioResult["status"], number> = { passed: 0, skipped: 1, failed: 2 };

/**
 * Collapses the N per-browser results of each scenario row to a single
 * worst-status verdict (US-055). Distinct Scenario Outline rows stay separate:
 * the group key is the report's stable per-row id (`scenarioId`), falling back
 * to `line`, then the scenario name. Insertion order is preserved.
 */
export const collapseByScenario = (results: ScenarioResult[]): ScenarioResult[] => {
  const byKey = new Map<string, ScenarioResult>();
  for (const result of results) {
    const disc =
      result.scenarioId ?? (result.line !== undefined ? `L${result.line}` : result.scenario);
    const key = `${result.featureUri ?? ""} ${disc}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...result });
      continue;
    }
    existing.durationMs = Math.max(existing.durationMs ?? 0, result.durationMs ?? 0);
    if (RANK[result.status] > RANK[existing.status]) {
      existing.status = result.status;
      existing.errorMessage = result.errorMessage; // adopt the worse result's error
    } else {
      existing.errorMessage ??= result.errorMessage;
    }
  }
  // Map preserves insertion order, so first-seen scenario rows keep their order.
  return [...byKey.values()];
};

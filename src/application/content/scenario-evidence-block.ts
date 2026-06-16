/**
 * The machine-readable per-scenario block embedded in an Evidence note (US-057,
 * a minimal slice of US-060). It carries each scenario's Scenario Reference
 * (US-056) + normalized status so the NDJSON history projection stays
 * *rebuildable from the authoritative Markdown* (ADR-0022) — the human-readable
 * `## Scenarios` list alone is not keyed by reference.
 *
 * A fenced code block (not YAML frontmatter) is used deliberately: the
 * frontmatter serialiser only supports flat scalars/arrays, and JSON inside a
 * fence is robust to the report-controlled values it carries (no Markdown
 * escaping concerns, US-056 injection review). US-060 later layers the full
 * audit stamp set on top.
 */

export const SCENARIO_BLOCK_FENCE = "testrunner-scenarios";

export type ScenarioEvidenceStatus = "passed" | "failed" | "skipped";

export interface ScenarioEvidenceEntry {
  ref: string;
  status: ScenarioEvidenceStatus;
  durationMs?: number;
}

const VALID_STATUS = new Set<ScenarioEvidenceStatus>(["passed", "failed", "skipped"]);

/**
 * Renders the fenced ` ```testrunner-scenarios ` JSON block for an Evidence
 * note body. Returns an empty string when there is nothing to record, so the
 * note simply omits the block.
 */
export const renderScenarioEvidenceBlock = (entries: ScenarioEvidenceEntry[]): string => {
  if (entries.length === 0) return "";
  const payload = entries.map((entry) => ({
    ref: entry.ref,
    status: entry.status,
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
  }));
  return ["```" + SCENARIO_BLOCK_FENCE, JSON.stringify(payload, null, 2), "```"].join("\n");
};

/**
 * Extracts the per-scenario entries from an Evidence note's content. Best-effort
 * and never throws: a missing or malformed block yields `[]`, and individual
 * entries lacking a `ref` or a valid `status` are dropped — a corrupt/edited
 * note degrades, never errors (ADR-0022 / the Markdown stays authoritative).
 */
export const parseScenarioEvidenceBlock = (noteContent: string): ScenarioEvidenceEntry[] => {
  const fence = new RegExp("```" + SCENARIO_BLOCK_FENCE + "\\n([\\s\\S]*?)\\n```");
  const match = fence.exec(noteContent.replace(/\r\n/g, "\n"));
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: ScenarioEvidenceEntry[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const ref = (raw as { ref?: unknown }).ref;
    const status = (raw as { status?: unknown }).status;
    const durationMs = (raw as { durationMs?: unknown }).durationMs;
    if (typeof ref !== "string" || ref === "") continue;
    if (typeof status !== "string" || !VALID_STATUS.has(status as ScenarioEvidenceStatus)) continue;
    entries.push({
      ref,
      status: status as ScenarioEvidenceStatus,
      ...(typeof durationMs === "number" ? { durationMs } : {}),
    });
  }
  return entries;
};

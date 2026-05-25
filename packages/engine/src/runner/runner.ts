// Executes parsed scenarios against a Driver and produces a RunResult.
// See DESIGN.md sections 4-5.

import type { Driver } from "../driver/driver";
import { parseGherkin, type ParsedScenario, type ParsedStep } from "../gherkin/parse";
import { matchStep } from "../vocabulary";
import type {
  RunResult,
  RunStatus,
  RunTotals,
  ScenarioResult,
  StepResult,
  TestCase,
} from "../types";

export interface RunOptions {
  env: string;
  retries?: number;
  /** Tag expression filter, e.g. "@smoke and not @wip" (Phase 2). */
  tags?: string;
  /** Variables available for {{...}} interpolation. */
  vars?: Record<string, string>;
}

/** Resolve {{key}} placeholders from the provided variable map; unknown keys are left intact. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) =>
    key in vars ? vars[key] : `{{${key}}}`,
  );
}

function makeRunId(at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

function tally(scenarios: ScenarioResult[]): RunTotals {
  const totals: RunTotals = {
    total: scenarios.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
  };
  for (const sc of scenarios) {
    if (sc.status === "passed") totals.passed += 1;
    else if (sc.status === "failed") totals.failed += 1;
    else if (sc.status === "skipped") totals.skipped += 1;
    if (sc.status === "flaky") totals.flaky += 1;
  }
  return totals;
}

export class Runner {
  constructor(private readonly driver: Driver) {}

  async runCase(testCase: TestCase, opts: RunOptions): Promise<RunResult> {
    const startedAt = new Date();
    const feature = parseGherkin(testCase.gherkin);

    const scenarios: ScenarioResult[] = [];
    for (const scenario of feature.scenarios) {
      scenarios.push(
        await this.runScenario(testCase.id, scenario, feature.background, opts),
      );
    }

    const finishedAt = new Date();
    const totals = tally(scenarios);
    return {
      runId: makeRunId(startedAt),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      env: opts.env,
      scenarios,
      totals,
      success: totals.failed === 0,
    };
  }

  private async runScenario(
    caseId: string,
    scenario: ParsedScenario,
    background: ParsedStep[],
    opts: RunOptions,
  ): Promise<ScenarioResult> {
    const start = Date.now();
    const steps: StepResult[] = [];
    const vars = opts.vars ?? {};
    let failed = false;

    for (const step of [...background, ...scenario.steps]) {
      if (failed) {
        steps.push({
          keyword: step.keyword,
          text: step.text,
          line: step.line,
          status: "skipped",
          durationMs: 0,
        });
        continue;
      }

      const stepStart = Date.now();
      const text = interpolate(step.text, vars);
      const match = matchStep(text);

      if (!match) {
        failed = true;
        steps.push({
          keyword: step.keyword,
          text: step.text,
          line: step.line,
          status: "undefined",
          durationMs: Date.now() - stepStart,
          message: `No matching step for: ${step.text}`,
        });
        continue;
      }

      try {
        await match.def.handler(this.driver, match.args);
        steps.push({
          keyword: step.keyword,
          text: step.text,
          line: step.line,
          status: "passed",
          durationMs: Date.now() - stepStart,
        });
      } catch (err) {
        failed = true;
        steps.push({
          keyword: step.keyword,
          text: step.text,
          line: step.line,
          status: "failed",
          durationMs: Date.now() - stepStart,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const status: RunStatus = failed ? "failed" : "passed";
    return {
      caseId,
      title: scenario.name,
      status,
      attempts: 1,
      durationMs: Date.now() - start,
      steps,
    };
  }
}

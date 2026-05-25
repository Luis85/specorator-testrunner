// Executes parsed scenarios against a Driver and produces a RunResult.
// See DESIGN.md sections 4-5.
//
// TODO(phase-1): match steps against the vocabulary, run via the driver,
// collect @cucumber/messages, derive the RunResult.

import type { Driver } from "../driver/driver";
import type { RunResult, TestCase } from "../types";

export interface RunOptions {
  env: string;
  retries?: number;
  /** Tag expression filter, e.g. "@smoke and not @wip". */
  tags?: string;
}

export class Runner {
  constructor(private readonly driver: Driver) {}

  async runCase(_testCase: TestCase, _opts: RunOptions): Promise<RunResult> {
    void this.driver;
    throw new Error("Runner.runCase: not implemented yet (Phase 1)");
  }
}

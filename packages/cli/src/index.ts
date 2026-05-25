#!/usr/bin/env node
// `specorator run` — headless CI runner. Runs the same engine as the plugin,
// without Obsidian. See DESIGN.md section 2.

import { Command } from "commander";
import type { RunResult } from "@specorator/engine";

const program = new Command();

program
  .name("specorator")
  .description("Run Specorator BDD suites headless (CI)")
  .version("0.0.1");

program
  .command("run")
  .description("Run a suite or test case headless")
  .option("-s, --suite <id>", "suite id to run")
  .option("-c, --case <id>", "test case id to run")
  .option("-t, --tags <expr>", "tag expression filter, e.g. '@smoke and not @wip'")
  .option("-e, --env <name>", "environment from Environments.md")
  .option("--vault <path>", "path to the Obsidian vault", ".")
  .option("--rerun-failed", "rerun only the previously failed cases")
  .option("--reporter <list>", "comma-separated reporters", "ndjson,html")
  .action(async (_opts) => {
    // TODO(phase-1): load the vault, parse suites, run via @specorator/engine,
    // write reports, and exit non-zero on failure.
    const _result: RunResult | null = null;
    console.error("specorator run: not implemented yet (Phase 1)");
    process.exitCode = 1;
  });

program.parseAsync(process.argv);

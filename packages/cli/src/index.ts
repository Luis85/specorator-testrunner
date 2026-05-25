#!/usr/bin/env node
// `specorator run` — headless CI runner. Runs the same engine as the plugin,
// without Obsidian. See DESIGN.md section 2.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Command } from "commander";
import {
  PlaywrightDriver,
  Runner,
  extractGherkinFence,
  renderReportNote,
  type TestCase,
} from "@specorator/engine";

const program = new Command();

program
  .name("specorator")
  .description("Run Specorator BDD suites headless (CI)")
  .version("0.0.1");

program
  .command("run")
  .description("Run a test case file headless (Phase 1: single --case file)")
  .option("-c, --case <file>", "path to a test-case markdown file")
  .option("-s, --suite <id>", "suite id to run (Phase 2)")
  .option("-t, --tags <expr>", "tag expression filter (Phase 2)")
  .option("-e, --env <name>", "environment name", "default")
  .option("--base-url <url>", "base URL for relative navigation")
  .option("--headed", "run with a visible browser window", false)
  .option("--channel <name>", "browser channel", "chrome")
  .action(async (opts) => {
    if (!opts.case) {
      console.error("Phase 1 requires --case <file.md>. Suite/tag runs land in Phase 2.");
      process.exitCode = 1;
      return;
    }

    const markdown = readFileSync(opts.case, "utf8");
    const gherkin = extractGherkinFence(markdown);
    if (!gherkin) {
      console.error(`No \`\`\`gherkin fence found in ${opts.case}`);
      process.exitCode = 1;
      return;
    }

    const testCase: TestCase = {
      id: basename(opts.case).replace(/\.md$/, ""),
      title: basename(opts.case),
      suite: opts.suite ?? "",
      tags: [],
      status: "ready",
      gherkin,
      path: opts.case,
    };

    const driver = new PlaywrightDriver({
      channel: opts.channel,
      headless: !opts.headed,
      baseURL: opts.baseUrl,
    });

    await driver.init();
    try {
      const result = await new Runner(driver).runCase(testCase, { env: opts.env });
      console.log(renderReportNote(result));
      process.exitCode = result.success ? 0 : 1;
    } finally {
      await driver.close();
    }
  });

program.parseAsync(process.argv);

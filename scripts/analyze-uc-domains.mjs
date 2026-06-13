#!/usr/bin/env node
/**
 * PRD Creator — Phase 1 analysis (Task 17).
 *
 * Scans a Use Cases directory, reads each note's `domain` frontmatter field,
 * groups the Use Cases by domain, and writes a Markdown report that seeds the
 * sub-PRD partitioning decision (`migration-plan.json`).
 *
 * Usage:
 *   node scripts/analyze-uc-domains.mjs [--use-cases-path <dir>]
 *
 * Default Use Cases path: "Use Cases". Report is written to
 * docs/migration-report-domains.md.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { domainFromFrontmatter, groupByDomain } from "./lib/uc-domains.mjs";
import { collectMarkdownFiles } from "./lib/migrate-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const options = { useCasesPath: "Use Cases" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--use-cases-path") {
      const value = argv[++i];
      if (!value) throw new Error("--use-cases-path requires a directory argument");
      options.useCasesPath = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Reads `*.md` notes from a directory (recursively) into `{ id, domain }` records. */
function readUseCaseNotes(dir) {
  return collectMarkdownFiles(dir).map((path) => {
    const content = readFileSync(path, "utf8");
    const idMatch = /^id:\s*(.*)$/m.exec(content);
    const id = idMatch ? idMatch[1].trim() : basename(path).replace(/\.md$/, "");
    return { id, domain: domainFromFrontmatter(content) || "(none)" };
  });
}

function buildReport(groups, useCasesPath) {
  const total = groups.reduce((sum, group) => sum + group.ids.length, 0);
  const lines = [
    "# Use Case domain analysis",
    "",
    `Source: \`${useCasesPath}\` — ${String(total)} Use Cases across ${String(groups.length)} domains.`,
    "",
    "| Domain | Count | Use Cases |",
    "| --- | --- | --- |",
    ...groups.map(
      (group) => `| ${group.domain} | ${String(group.ids.length)} | ${group.ids.join(", ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const useCasesDir = resolve(ROOT, options.useCasesPath);

const notes = readUseCaseNotes(useCasesDir);
const groups = groupByDomain(notes);
const report = buildReport(groups, options.useCasesPath);

const reportPath = join(ROOT, "docs", "migration-report-domains.md");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report, "utf8");

console.log(
  `Analyzed ${String(notes.length)} Use Cases into ${String(groups.length)} domains. Report: ${reportPath}`,
);

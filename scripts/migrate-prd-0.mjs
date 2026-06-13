#!/usr/bin/env node
/**
 * PRD Creator — Phase 3: create the root PRD (PRD-000) from the existing
 * product vision note (Task 18).
 *
 * Steps run in THIS EXACT ORDER — the order is the safety guarantee:
 *   1. Back up `docs/Specorator Testrunner.md` (abort if a backup exists unless
 *      --force).
 *   2. Create `<prdsPath>/PRD-000-product-vision/PRD-000-product-vision.md` from
 *      the original note (deriving scope_in/scope_out from Goals/Non-Goals,
 *      best-effort), appending the original body.
 *   3. Rewrite the original note as a redirect note whose `aliases` preserve the
 *      original `[[Specorator Testrunner]]` backlinks.
 *
 * Usage:
 *   node scripts/migrate-prd-0.mjs [--prds-path <dir>] [--force]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPrdNote, prdFolderName } from "./lib/prd-note.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ORIGINAL_REL = join("docs", "Specorator Testrunner.md");
const ORIGINAL_NAME = "Specorator Testrunner";

function parseArgs(argv) {
  const options = { prdsPath: "PRDs", force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prds-path") {
      const value = argv[++i];
      if (!value) throw new Error("--prds-path requires a directory argument");
      options.prdsPath = value;
    } else if (arg === "--force") {
      options.force = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * Splits a note into its leading frontmatter block (if any) and the body that
 * follows. The frontmatter is returned without its `---` fences.
 */
function splitNote(content) {
  const normalised = content.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalised);
  if (!match) return { frontmatter: "", body: normalised };
  return { frontmatter: match[1], body: normalised.slice(match[0].length) };
}

/**
 * Best-effort extraction of the second column of the first Markdown table that
 * appears under a heading whose text matches `headingPattern`. Returns the cell
 * values (e.g. the Goal / Non Goal text), skipping the header and divider rows.
 */
function extractTableColumn(body, headingPattern) {
  const lines = body.split("\n");
  let inSection = false;
  let sawTable = false;
  const items = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (inSection && sawTable) break;
      inSection = headingPattern.test(line);
      sawTable = false;
      continue;
    }
    if (!inSection) continue;

    const row = line.trim();
    if (!row.startsWith("|")) {
      if (sawTable) break;
      continue;
    }
    // Skip the header divider (e.g. `| --- | --- |`).
    if (/^\|[\s|:-]+\|$/.test(row)) {
      sawTable = true;
      continue;
    }
    const cells = row
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!sawTable) {
      // This is the header row; remember we're in a table and skip it.
      sawTable = true;
      continue;
    }
    // The descriptive column is the last cell (Goals: `| G1 | Goal text |`;
    // Non Goals: `| NG1 | Non Goal text |`).
    const value = cells[cells.length - 1];
    if (value) items.push(value);
  }

  return items;
}

const options = parseArgs(process.argv.slice(2));

// --- Step 1: back up the original note -------------------------------------
const originalPath = join(ROOT, ORIGINAL_REL);
if (!existsSync(originalPath)) {
  throw new Error(`Original vision note not found: ${originalPath}`);
}
const backupPath = `${originalPath}.backup`;
if (existsSync(backupPath) && !options.force) {
  throw new Error(`Backup already exists: ${backupPath} (pass --force to overwrite)`);
}
copyFileSync(originalPath, backupPath);

const originalContent = readFileSync(originalPath, "utf8");
const { body: originalBody } = splitNote(originalContent);

// --- Step 2: create PRD-000 ------------------------------------------------
// Derive scope_in from the "Goals" table and scope_out from the "Non Goals"
// table (best-effort). The negative lookbehind keeps "## 3. Goals" from also
// matching "## 4. Non Goals".
const goals = extractTableColumn(originalBody, /^#{1,6}\s.*(?<!Non )Goals?\b/i);
const nonGoals = extractTableColumn(originalBody, /^#{1,6}\s.*\bNon[ -]?Goals?\b/i);

const vision =
  "Enable users to transform requirements into executable specifications and continuously verify software quality without leaving Obsidian.";

const prdId = "PRD-000";
const prdTitle = "Product Vision";
const folder = prdFolderName(prdId, prdTitle); // PRD-000-product-vision

const prdNote =
  buildPrdNote({
    id: prdId,
    title: prdTitle,
    status: "active",
    parentPrdId: undefined,
    domains: [],
    vision,
    scopeIn: goals,
    scopeOut: nonGoals,
    displayOrder: 0,
  }) +
  "\n\n---\n\n## Source: Specorator Testrunner (V1 PRD)\n\n" +
  originalBody.trimEnd() +
  "\n";

const prdDir = join(ROOT, options.prdsPath, folder);
mkdirSync(prdDir, { recursive: true });
const prdNotePath = join(prdDir, `${folder}.md`);
writeFileSync(prdNotePath, prdNote, "utf8");

// --- Step 3: rewrite the original note as a redirect -----------------------
const redirect = `---
aliases:
  - ${folder}
---

# ${ORIGINAL_NAME}

> This note has moved. The product vision now lives in the PRD hierarchy as the root PRD.

See [[${folder}]].

The \`${folder}\` alias above preserves existing \`[[${ORIGINAL_NAME}]]\` backlinks.
`;
writeFileSync(originalPath, redirect, "utf8");

console.log(`Created ${prdNotePath}`);
console.log(`Backed up original to ${backupPath}`);
console.log(`Rewrote ${originalPath} as a redirect to [[${folder}]]`);

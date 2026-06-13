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
import { extractTableColumn, parseFlags } from "./lib/migrate-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ORIGINAL_REL = join("docs", "Specorator Testrunner.md");
const ORIGINAL_NAME = "Specorator Testrunner";

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

const options = parseFlags(process.argv.slice(2), {
  "--prds-path": { key: "prdsPath", default: "PRDs" },
  "--force": { key: "force", default: false, boolean: true },
});

// --- Step 1: back up the original note -------------------------------------
const originalPath = join(ROOT, ORIGINAL_REL);
if (!existsSync(originalPath)) {
  throw new Error(`Original vision note not found: ${originalPath}`);
}
const backupPath = `${originalPath}.backup`;
const hasBackup = existsSync(backupPath);
if (hasBackup && !options.force) {
  throw new Error(`Backup already exists: ${backupPath} (pass --force to re-run)`);
}
// Only back up when no backup exists yet. On a --force re-run the original note
// is already the Phase-3 redirect, so re-copying would overwrite the sole copy
// of the original vision document and break the documented rollback — preserve
// the first backup instead.
if (!hasBackup) {
  copyFileSync(originalPath, backupPath);
}

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
console.log(
  hasBackup ? `Preserved existing backup at ${backupPath}` : `Backed up original to ${backupPath}`,
);
console.log(`Rewrote ${originalPath} as a redirect to [[${folder}]]`);

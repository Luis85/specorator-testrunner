#!/usr/bin/env node
/**
 * PRD Creator — Phases 4-5: create the sub-PRDs and link their Use Cases
 * (Task 19).
 *
 * Reads a `migration-plan.json` of the shape:
 *   {
 *     "PRD-001": {
 *       "title": "...",
 *       "domains": ["..."],
 *       "useCaseIds": ["UC-001", ...]
 *     },
 *     ...
 *   }
 *
 * For each entry it:
 *   - creates `<prdsPath>/<folder>/<folder>.md` (parent PRD-000, status draft,
 *     the given domains, display_order by insertion order); and
 *   - for every `useCaseId`, locates the note under the Use Cases path and
 *     inserts `prd-id: <id>` into its existing `---` frontmatter block,
 *     preserving every other field and the body.
 *
 * Usage:
 *   node scripts/create-sub-prds.mjs [--plan <path>] [--prds-path <dir>] \
 *     [--use-cases-path <dir>]
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPrdNote, prdFolderName } from "./lib/prd-note.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    plan: "migration-plan.json",
    prdsPath: "PRDs",
    useCasesPath: "Use Cases",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plan") {
      options.plan = required(argv[++i], "--plan");
    } else if (arg === "--prds-path") {
      options.prdsPath = required(argv[++i], "--prds-path");
    } else if (arg === "--use-cases-path") {
      options.useCasesPath = required(argv[++i], "--use-cases-path");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function required(value, flag) {
  if (!value) throw new Error(`${flag} requires an argument`);
  return value;
}

/** Builds an index from Use Case id → absolute note path under `dir`. */
function indexUseCases(dir) {
  const index = new Map();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const path = join(dir, name);
    const content = readFileSync(path, "utf8");
    const idMatch = /^id:\s*(.*)$/m.exec(content);
    const id = idMatch ? idMatch[1].trim() : name.replace(/\.md$/, "");
    index.set(id, path);
  }
  return index;
}

/**
 * Inserts a `prd-id: <value>` line into a note's leading `---` frontmatter
 * block, preserving all existing fields and the body. If `prd-id` is already
 * present, its value is replaced in place. Throws if the note has no
 * frontmatter block (we never invent one — the Use Case notes always have one).
 */
function addPrdId(content, prdId) {
  const normalised = content.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---/.exec(normalised);
  if (!match) {
    throw new Error("Use Case note has no frontmatter block");
  }
  const block = match[1];
  const lines = block.split("\n");

  const existingIndex = lines.findIndex((line) => /^prd-id:\s*/.test(line));
  if (existingIndex !== -1) {
    lines[existingIndex] = `prd-id: ${prdId}`;
  } else {
    // Insert after the `id:` line for readability; fall back to appending.
    const idIndex = lines.findIndex((line) => /^id:\s*/.test(line));
    const at = idIndex === -1 ? lines.length : idIndex + 1;
    lines.splice(at, 0, `prd-id: ${prdId}`);
  }

  const rebuilt = `---\n${lines.join("\n")}\n---`;
  return rebuilt + normalised.slice(match[0].length);
}

const options = parseArgs(process.argv.slice(2));

const planPath = resolve(ROOT, options.plan);
const plan = JSON.parse(readFileSync(planPath, "utf8"));

const useCasesDir = resolve(ROOT, options.useCasesPath);
const useCaseIndex = indexUseCases(useCasesDir);

let order = 1; // PRD-000 is display_order 0; sub-PRDs follow by insertion order.
const created = [];
const linked = [];
const missing = [];

for (const [prdId, entry] of Object.entries(plan)) {
  const title = entry.title ?? prdId;
  const domains = entry.domains ?? [];
  const useCaseIds = entry.useCaseIds ?? [];

  const folder = prdFolderName(prdId, title);
  const note = buildPrdNote({
    id: prdId,
    title,
    status: "draft",
    parentPrdId: "PRD-000",
    domains,
    vision: entry.vision ?? title,
    scopeIn: entry.scopeIn ?? [],
    scopeOut: entry.scopeOut ?? [],
    displayOrder: order,
  });
  order++;

  const prdDir = join(ROOT, options.prdsPath, folder);
  mkdirSync(prdDir, { recursive: true });
  const notePath = join(prdDir, `${folder}.md`);
  writeFileSync(notePath, note, "utf8");
  created.push(notePath);

  for (const useCaseId of useCaseIds) {
    const ucPath = useCaseIndex.get(useCaseId);
    if (!ucPath) {
      missing.push(useCaseId);
      continue;
    }
    const updated = addPrdId(readFileSync(ucPath, "utf8"), prdId);
    writeFileSync(ucPath, updated, "utf8");
    linked.push(`${useCaseId} → ${prdId}`);
  }
}

console.log(`Created ${String(created.length)} sub-PRDs.`);
console.log(`Linked ${String(linked.length)} Use Cases.`);
if (missing.length > 0) {
  console.warn(`WARNING: ${String(missing.length)} Use Case ids not found: ${missing.join(", ")}`);
}

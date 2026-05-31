#!/usr/bin/env node
/**
 * Build the plugin and install the built assets into a vault's
 * .obsidian/plugins/<manifest id>/ folder for manual testing.
 *
 * Usage:
 *   node scripts/test-build.mjs [--vault <path>] [--plugin-id <id>] [--skip-build]
 *
 * Without --vault, walks up from the project root looking for a parent
 * directory that contains .obsidian/plugins/.
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function readManifest() {
  const manifestPath = join(ROOT, "manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function parseArgs(argv) {
  const options = {
    vault: null,
    pluginId: null,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--vault") {
      options.vault = argv[++index] ?? null;
    } else if (arg === "--plugin-id") {
      options.pluginId = argv[++index] ?? null;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function findVaultRoot(startPath) {
  let current = resolve(startPath);

  while (true) {
    const obsidianPluginsPath = join(current, ".obsidian", "plugins");
    if (existsSync(obsidianPluginsPath) && statSync(obsidianPluginsPath).isDirectory()) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveVaultRoot(explicitVault) {
  if (explicitVault) {
    const vaultRoot = resolve(explicitVault);
    const pluginsPath = join(vaultRoot, ".obsidian", "plugins");
    if (!existsSync(pluginsPath) || !statSync(pluginsPath).isDirectory()) {
      throw new Error(`No .obsidian/plugins folder found under ${vaultRoot}`);
    }
    return vaultRoot;
  }

  const detected = findVaultRoot(ROOT);
  if (!detected) {
    throw new Error("Could not find a parent vault with .obsidian/plugins. Pass --vault <path>.");
  }
  return detected;
}

function assertPluginTarget(vaultRoot, pluginDir) {
  const pluginsRoot = resolve(vaultRoot, ".obsidian", "plugins");
  const target = resolve(pluginDir);
  if (
    target !== pluginsRoot &&
    !target.startsWith(`${pluginsRoot}\\`) &&
    !target.startsWith(`${pluginsRoot}/`)
  ) {
    throw new Error(`Refusing to copy outside .obsidian/plugins: ${target}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const manifest = readManifest();
const pluginId = options.pluginId ?? manifest.id;
if (!pluginId || pluginId.includes("/") || pluginId.includes("\\")) {
  throw new Error(`Invalid plugin id: ${pluginId}`);
}
const vaultRoot = resolveVaultRoot(options.vault);
const pluginDir = join(vaultRoot, ".obsidian", "plugins", pluginId);

assertPluginTarget(vaultRoot, pluginDir);

if (!options.skipBuild) {
  execSync("npm run build", {
    cwd: ROOT,
    stdio: "inherit",
  });
}

mkdirSync(pluginDir, { recursive: true });

const filesToCopy = ["manifest.json", "main.js", "styles.css"];
for (const fileName of filesToCopy) {
  const sourcePath = join(ROOT, fileName);
  if (!existsSync(sourcePath)) {
    throw new Error(`Build output missing: ${fileName}`);
  }
  copyFileSync(sourcePath, join(pluginDir, fileName));
}

console.log(`Installed ${pluginId} test build to ${pluginDir}`);

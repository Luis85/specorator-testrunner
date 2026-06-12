#!/usr/bin/env node
/**
 * E2E smoke test (run by .github/workflows/e2e-smoke.yml — on demand or on
 * runner-template changes — or locally):
 * proves a `.testrunner` generated from the ACTUAL templates installs and the
 * demo test passes on a real OS — the class of failure unit tests can't catch
 * (npm.cmd quoting, cucumber config wiring, playwright install).
 *
 * Flow: bundle src/ exports → scaffold a temp fake vault (templates +
 * demo feature) → npm install → playwright install → npm run test:ci →
 * assert on the cucumber JSON report, not just the exit code (a silently
 * empty run must fail).
 */

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Throw (not process.exit) so the temp-vault cleanup in `finally` still runs
// on assertion failures; the catch below sets the exit code.
const fail = (message) => {
  throw new Error(message);
};

const run = (command, cwd) => {
  console.log(`\n$ ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
};

const vaultRoot = mkdtempSync(join(tmpdir(), "e2e-smoke-vault-"));
console.log(`Fake vault: ${vaultRoot}`);

try {
  // 1. Bundle the real template builder + demo content out of src/.
  const entryBundle = join(vaultRoot, "smoke-entry.mjs");
  await build({
    entryPoints: [join(ROOT, "scripts", "e2e-smoke-entry.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: entryBundle,
    logLevel: "silent",
    // The plugin API must never be reachable from the template/domain modules;
    // if it ever is, the dynamic import below fails loudly.
    external: ["obsidian"],
  });
  const { buildRunnerTemplates, DEFAULT_SETTINGS, DEMO_FEATURE_CONTENT, DEMO_FEATURE_FILE_NAME } =
    await import(pathToFileURL(entryBundle).href);

  // 2. Scaffold the fake vault: runner templates + the demo feature in the
  //    folder the runner's cucumber.mjs feature glob points at.
  const runnerRoot = join(vaultRoot, DEFAULT_SETTINGS.paths.testRunnerPath);
  for (const file of buildRunnerTemplates(DEFAULT_SETTINGS)) {
    const target = join(runnerRoot, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
  const featureDir = join(vaultRoot, DEFAULT_SETTINGS.paths.featureFilesPath);
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, DEMO_FEATURE_FILE_NAME), DEMO_FEATURE_CONTENT, "utf8");

  // 3. Install + run, using only the templates' own package scripts so the
  //    smoke run cannot drift from what the plugin generates.
  run("npm install", runnerRoot);
  run("npm run install:browsers:ci", runnerRoot);
  run("npm run test:ci", runnerRoot);

  // 4. Assert on the report, not just the exit code.
  const reportPath = join(runnerRoot, "reports", "cucumber-report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const scenarios = report.flatMap((feature) =>
    (feature.elements ?? []).filter((element) => element.type === "scenario"),
  );
  if (scenarios.length === 0) fail("the run produced an empty report (no scenarios executed)");
  if (!report.some((feature) => (feature.uri ?? "").includes("UC-001-open-example-page"))) {
    fail("the demo feature is missing from the report");
  }
  const failingSteps = scenarios
    .flatMap((scenario) => scenario.steps ?? [])
    .filter((step) => step.result?.status !== "passed");
  if (failingSteps.length > 0) {
    fail(
      `${failingSteps.length} step(s) did not pass: ` +
        failingSteps.map((step) => `${step.name ?? "(hook)"} → ${step.result?.status}`).join(", "),
    );
  }
  console.log(`\nE2E smoke PASSED: ${scenarios.length} scenario(s), all steps passed.`);
} catch (error) {
  console.error(`\nE2E smoke FAILED: ${error instanceof Error ? error.message : String(error)}`);
  // exitCode (not process.exit) lets the finally cleanup complete first.
  process.exitCode = 1;
} finally {
  // Best-effort: the temp vault is large (node_modules); don't leave it behind.
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* the CI runner is ephemeral anyway */
  }
}

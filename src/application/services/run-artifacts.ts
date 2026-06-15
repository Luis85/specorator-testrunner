import type { TestRun } from "../../domain/entities/test-run";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { Logger } from "../../shared/logging/logger";
import { joinVaultPath } from "../../shared/utils/vault-path";

/**
 * Best-effort snapshotting of a Test Run's artifacts before its active slot
 * frees: the Cucumber report (so a later run's pre-run cleanup can't delete it
 * mid-import) and the feature files as they were at run start (so post-run
 * identity resolution can't be mis-keyed by a mid-run edit, US-056). Extracted
 * from the execution service so the run lifecycle stays the orchestration.
 */

/**
 * Snapshots the fixed Cucumber report to a run-specific path
 * (reports/<runId>.json) BEFORE the active slot frees, so a later run's
 * pre-run cleanup of reports/cucumber-report.json can't delete it while the
 * (passed/failed/cancelled) run's evidence import reads it. Best-effort: a
 * run with no report (e.g. spawn fault) simply leaves reportPaths.json unset.
 */
export const snapshotReport = async (
  run: TestRun,
  cwd: string,
  absoluteFs: Pick<AbsoluteFileSystem, "readAbsolute" | "writeAbsolute">,
): Promise<void> => {
  const liveReport = await absoluteFs.readAbsolute(`${cwd}/reports/cucumber-report.json`);
  if (!liveReport.ok) return;
  const snapshot = await absoluteFs.writeAbsolute(
    `${cwd}/reports/${run.id}.json`,
    liveReport.value,
  );
  if (snapshot.ok) {
    run.reportPaths.json = joinVaultPath(run.workingDirectory, "reports", `${run.id}.json`);
  }
};

/**
 * Captures every `.feature` file under the configured features folder as it is
 * at run start, into `reports/<runId>.features.json` keyed by vault-relative
 * path. Post-run identity resolution (US-056) prefers this snapshot over the
 * live vault file, so editing a feature mid-run cannot mis-key that run's
 * Scenario References. Best-effort and fully isolated: any fault is logged and
 * leaves `reportPaths.features` unset (the resolver then reads live files).
 */
export const snapshotFeatures = async (
  run: TestRun,
  cwd: string,
  featuresDir: string,
  deps: { absoluteFs: AbsoluteFileSystem; logger: Logger },
): Promise<void> => {
  const { absoluteFs, logger } = deps;
  try {
    const base = await absoluteFs.getVaultBasePath();
    if (!base.ok) return;
    // Normalize the vault-relative key base EXACTLY as the resolver normalizes
    // report URIs (`resolveVaultPath`): drop empty and `.` segments and collapse
    // any `/`/`\` runs. So a `featureFilesPath` saved with a trailing/duplicate
    // separator or a `.` segment (e.g. `Specifications/./features`) still yields
    // keys the resolver can find (codex P2). `..` can't occur — PathSafetyPolicy
    // rejects it as a whole segment.
    const featuresRel = featuresDir
      .split(/[/\\]+/)
      .filter((segment) => segment !== "" && segment !== ".")
      .join("/");
    const cleanBase = base.value.replace(/[/\\]$/, "");
    // featuresRel is empty when the features folder IS the vault root
    // (`featureFilesPath = "."`); key those features by bare name so they match
    // the resolver, which resolves `../UC-001.feature` to `UC-001.feature` with
    // no leading slash (codex P2).
    const root = featuresRel ? `${cleanBase}/${featuresRel}` : cleanBase;
    const snapshot: Record<string, string> = {};
    await collectFeatures(root, featuresRel, snapshot, absoluteFs);
    if (Object.keys(snapshot).length === 0) return;
    const written = await absoluteFs.writeAbsolute(
      `${cwd}/reports/${run.id}.features.json`,
      JSON.stringify(snapshot),
    );
    if (written.ok) {
      run.reportPaths.features = joinVaultPath(
        run.workingDirectory,
        "reports",
        `${run.id}.features.json`,
      );
    }
  } catch (error) {
    logger.warn("Feature snapshot failed; identity resolution will read live files", {
      runId: run.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Recursively reads `.feature` files under `absDir` into `out`, keyed by their
 * vault-relative path. Non-`.feature` entries are treated as subfolders.
 */
const collectFeatures = async (
  absDir: string,
  vaultRel: string,
  out: Record<string, string>,
  absoluteFs: Pick<AbsoluteFileSystem, "listAbsolute" | "readAbsolute">,
): Promise<void> => {
  for (const name of await absoluteFs.listAbsolute(absDir)) {
    const childAbs = `${absDir}/${name}`;
    // No separator when the base is empty (root-level features folder), so a
    // root feature keys as `UC-001.feature`, not `/UC-001.feature` (codex P2).
    const childRel = vaultRel ? `${vaultRel}/${name}` : name;
    if (name.endsWith(".feature")) {
      const read = await absoluteFs.readAbsolute(childAbs);
      if (read.ok) out[childRel] = read.value;
    } else {
      await collectFeatures(childAbs, childRel, out, absoluteFs);
    }
  }
};

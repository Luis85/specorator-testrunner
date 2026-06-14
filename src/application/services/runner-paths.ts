import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
import type { CommandSafetyPolicy } from "../../domain/policies/command-safety-policy";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { err, ok, type Result } from "../../shared/result/result";

/** Absolute working directory for the runner (vault base + runner path). */
export const resolveRunnerCwd = async (
  absoluteFs: AbsoluteFileSystem,
  runnerPath: VaultPath,
): Promise<Result<string>> => {
  const base = await absoluteFs.getVaultBasePath();
  if (!base.ok) return err(base.error);
  return ok(`${base.value.replace(/[/\\]$/, "")}/${runnerPath}`);
};

/**
 * Guards an argv (defense in depth: allowed program, no control chars) and then
 * resolves the runner cwd — the shared spawn preamble every runner invocation
 * shares before it diverges. The safety error takes precedence over the cwd one.
 */
export const assertSafeAndResolveCwd = async (
  commandSafety: CommandSafetyPolicy,
  absoluteFs: AbsoluteFileSystem,
  argv: string[],
  runnerPath: VaultPath,
): Promise<Result<string>> => {
  const safe = commandSafety.assertSafe(argv);
  if (!safe.ok) return err(safe.error);
  return resolveRunnerCwd(absoluteFs, runnerPath);
};

/**
 * Candidate Playwright browser cache directories for the current platform
 * (Runtime View RV-2). Pure so it is unit-testable across platforms.
 *
 * Honours `PLAYWRIGHT_BROWSERS_PATH`:
 * - an explicit path → that directory;
 * - `"0"` (hermetic mode) → runner-local `node_modules/playwright-core/.local-browsers`;
 * - unset → the per-user OS cache.
 */
export const playwrightBrowsersCandidates = (
  platform: string,
  env: Record<string, string | undefined>,
  runnerAbsPath?: string,
): string[] => {
  const explicit = env.PLAYWRIGHT_BROWSERS_PATH;
  if (explicit === "0") {
    return runnerAbsPath ? [`${runnerAbsPath}/node_modules/playwright-core/.local-browsers`] : [];
  }
  if (explicit) return [explicit];
  const home = env.HOME ?? env.USERPROFILE ?? "";
  if (!home) return [];
  if (platform === "darwin") return [`${home}/Library/Caches/ms-playwright`];
  if (platform === "win32") return [`${home}\\AppData\\Local\\ms-playwright`];
  return [`${home}/.cache/ms-playwright`];
};

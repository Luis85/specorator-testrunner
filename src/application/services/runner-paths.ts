import type { AbsoluteFileSystem } from "../ports/absolute-file-system";
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
 * Candidate Playwright browser cache directories for the current platform
 * (Runtime View RV-2). Pure so it is unit-testable across platforms.
 */
export const playwrightBrowsersCandidates = (
  platform: string,
  env: Record<string, string | undefined>,
): string[] => {
  const explicit = env.PLAYWRIGHT_BROWSERS_PATH;
  if (explicit && explicit !== "0") return [explicit];
  const home = env.HOME ?? env.USERPROFILE ?? "";
  if (!home) return [];
  if (platform === "darwin") return [`${home}/Library/Caches/ms-playwright`];
  if (platform === "win32") return [`${home}\\AppData\\Local\\ms-playwright`];
  return [`${home}/.cache/ms-playwright`];
};

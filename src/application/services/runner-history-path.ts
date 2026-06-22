import type { SettingsService } from "./settings-service";
import type { AbsoluteFileSystem } from "../ports/absolute-file-system";

/**
 * Absolute path to a file under the runner's `history` folder
 * (`<vaultBase>/<testRunnerPath>/history/<fileName>`), or `undefined` when the
 * vault base path is unavailable (non-desktop).
 *
 * `.testrunner/history` holds the regenerable read models — the scenario index
 * and the execution log — that MUST be written through the absolute filesystem:
 * `.testrunner` is a dot-folder Obsidian does not index, so the vault adapter
 * cannot overwrite an existing file there. Both consumers build their path the
 * same way, so it lives here once.
 */
export const runnerHistoryFilePath = async (
  absoluteFs: AbsoluteFileSystem,
  settingsService: SettingsService,
  fileName: string,
): Promise<string | undefined> => {
  const base = await absoluteFs.getVaultBasePath();
  if (!base.ok) return undefined;
  const settings = await settingsService.load();
  const runner = settings.paths.testRunnerPath;
  return `${base.value.replace(/[/\\]$/, "")}/${runner}/history/${fileName}`;
};

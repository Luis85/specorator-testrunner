import { parseStepDefinitions, type StepDefinitionPattern } from "../content/step-definitions";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * Reads every `*.ts` under the steps folder (recursively, matching the runner's
 * `src/steps/**` glob) and scrapes its patterns, so detection
 * (SpecificationService) and generation (StepDefinitionService) share ONE view
 * of what is already defined — they previously kept byte-identical private
 * copies of this scan. A genuine listing failure (e.g. a missing folder) yields
 * no definitions, so every step is reported missing; individual unreadable
 * files are skipped best-effort.
 */
export const loadStepDefinitions = async (
  fs: Pick<VaultFileSystem, "listFilesRecursive" | "readFile">,
  stepsDir: VaultPath,
): Promise<StepDefinitionPattern[]> => {
  const listed = await fs.listFilesRecursive(stepsDir);
  if (!listed.ok) return []; // genuine listing failure → treat as no definitions

  const patterns: StepDefinitionPattern[] = [];
  for (const path of listed.value) {
    if (!path.endsWith(".ts")) continue;
    const read = await fs.readFile(path);
    if (!read.ok) continue; // best-effort: skip unreadable files
    patterns.push(...parseStepDefinitions(read.value));
  }
  return patterns;
};

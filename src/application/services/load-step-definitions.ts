import { parseStepDefinitions, type StepDefinitionPattern } from "../content/step-definitions";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * A steps-file's identity for content-addressing (#77, spec D6): its vault
 * path and raw, unscraped source bytes.
 */
export interface StepSourceFile {
  path: VaultPath;
  content: string;
}

/**
 * Reads every `*.ts` under the steps folder (recursively, matching the runner's
 * `src/steps/**` glob), returning each file's path + raw content. A genuine
 * listing failure (e.g. a missing folder) yields no sources; individual
 * unreadable files are skipped best-effort. Kept separate from
 * {@link parseStepSources} so the #77 coverage cache can content-address on
 * these RAW bytes (spec D6) instead of the scraped pattern set: scraping
 * cannot see custom parameter types, regex helpers, or variable-built
 * definitions, so a cache keyed on patterns alone could miss an edit to that
 * code and serve a stale verdict (Codex P2 on PR #102).
 */
export const loadStepSources = async (
  fs: Pick<VaultFileSystem, "listFilesRecursive" | "readFile">,
  stepsDir: VaultPath,
): Promise<StepSourceFile[]> => {
  const listed = await fs.listFilesRecursive(stepsDir);
  if (!listed.ok) return []; // genuine listing failure → treat as no sources

  const sources: StepSourceFile[] = [];
  for (const path of listed.value) {
    if (!path.endsWith(".ts")) continue;
    const read = await fs.readFile(path);
    if (!read.ok) continue; // best-effort: skip unreadable files
    sources.push({ path, content: read.value });
  }
  return sources;
};

/** Scrapes step-definition patterns out of an already-read set of source files. */
export const parseStepSources = (sources: readonly StepSourceFile[]): StepDefinitionPattern[] =>
  sources.flatMap((source) => parseStepDefinitions(source.content));

/**
 * Reads every `*.ts` under the steps folder and scrapes its patterns, so
 * detection (SpecificationService) and generation (StepDefinitionService)
 * share ONE view of what is already defined — they previously kept
 * byte-identical private copies of this scan. A thin delegate over
 * {@link loadStepSources} + {@link parseStepSources}: callers that only need
 * the scraped patterns (not the raw sources the #77 cache digests) use this
 * one and stay unaware the split exists.
 */
export const loadStepDefinitions = async (
  fs: Pick<VaultFileSystem, "listFilesRecursive" | "readFile">,
  stepsDir: VaultPath,
): Promise<StepDefinitionPattern[]> => parseStepSources(await loadStepSources(fs, stepsDir));

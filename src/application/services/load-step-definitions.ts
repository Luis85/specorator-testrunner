import { parseStepDefinitions, type StepDefinitionPattern } from "../content/step-definitions";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { joinVaultPath } from "../../shared/utils/vault-path";

/**
 * A steps-file's identity for content-addressing (#77, spec D6): its vault
 * path and raw, unscraped source bytes.
 */
export interface StepSourceFile {
  path: VaultPath;
  content: string;
}

/**
 * Every `*.ts` under `dir` (recursively), path + raw content. A genuine
 * listing failure (e.g. a missing folder) yields no sources; individual
 * unreadable files are skipped best-effort. Shared body for
 * {@link loadStepSources} and {@link loadRunnerSources}, which differ only in
 * which directory they scope to.
 */
const loadTsSources = async (
  fs: Pick<VaultFileSystem, "listFilesRecursive" | "readFile">,
  dir: VaultPath,
): Promise<StepSourceFile[]> => {
  const listed = await fs.listFilesRecursive(dir);
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

/**
 * Reads every `*.ts` under the steps folder (recursively, matching the runner's
 * `src/steps/**` glob), returning each file's path + raw content. Kept
 * separate from {@link parseStepSources} so callers that content-address on
 * these RAW bytes (spec D6) don't also need the scraped pattern set: scraping
 * cannot see custom parameter types, regex helpers, or variable-built
 * definitions, so a cache keyed on patterns alone could miss an edit to that
 * code and serve a stale verdict (Codex P2 on PR #102). Scoped to `src/steps`
 * ONLY — the static-pattern path (`listStepPatterns`, the Feature Editor's
 * autocomplete) reads no wider than that.
 */
export const loadStepSources = (
  fs: Pick<VaultFileSystem, "listFilesRecursive" | "readFile">,
  stepsDir: VaultPath,
): Promise<StepSourceFile[]> => loadTsSources(fs, stepsDir);

/**
 * Reads every `*.ts` under the runner's ENTIRE `src` tree (recursively:
 * steps, pages, support, fixtures, …) — the {@link loadRunnerCoverageSources}
 * building block covering the runner src tree. Wider than
 * {@link loadStepSources} (`src/steps` only) because bddgen compiles the
 * whole runner graph: the default generated runner's example step imports
 * `../pages/ExamplePage`, so a `src/steps`-only digest would miss a
 * page-object/support edit bddgen recompiles against (Codex P2 on PR #102).
 * Same best-effort semantics as {@link loadStepSources}. NOT exported: every
 * external caller wants the FULL #77 coverage-cache input (this PLUS the
 * runner-root `playwright.config.ts` and `tsconfig.json`) — use
 * {@link loadRunnerCoverageSources}.
 */
const loadRunnerSources = (
  fs: Pick<VaultFileSystem, "listFilesRecursive" | "readFile">,
  runnerSrcDir: VaultPath,
): Promise<StepSourceFile[]> => loadTsSources(fs, runnerSrcDir);

/**
 * {@link loadRunnerSources} PLUS the runner-root `playwright.config.ts` and
 * `tsconfig.json` (path + bytes each), when they exist — the #77 coverage
 * cache's FULL sources digest input (spec D6, closing the outermost ring,
 * Codex P2 on PR #102). `playwright.config.ts` owns bddgen's
 * `defineBddConfig` call (`features`/`featuresRoot`/`steps`/`tags` globs);
 * `tsconfig.json` owns `paths` aliases and other module-resolution settings
 * bddgen also consults, so it can resolve the SAME step source differently
 * after an edit. Both live OUTSIDE `src/` entirely — editing either changes
 * what/how bddgen evaluates, invisibly to a src-only digest, which would then
 * serve a stale `covered=true`. Best-effort like {@link loadRunnerSources}:
 * an uninitialized runner (a file not yet written) or an unreadable file is
 * skipped — same treatment as any other unreadable source file, never an
 * error.
 */
export const loadRunnerCoverageSources = async (
  fs: Pick<VaultFileSystem, "listFilesRecursive" | "readFile">,
  testRunnerPath: VaultPath,
): Promise<StepSourceFile[]> => {
  const sources = await loadRunnerSources(fs, joinVaultPath(testRunnerPath, "src"));

  const configPath = joinVaultPath(testRunnerPath, "playwright.config.ts");
  const configRead = await fs.readFile(configPath);
  const withConfig = configRead.ok
    ? [...sources, { path: configPath, content: configRead.value }]
    : sources;

  const tsconfigPath = joinVaultPath(testRunnerPath, "tsconfig.json");
  const tsconfigRead = await fs.readFile(tsconfigPath);
  return tsconfigRead.ok
    ? [...withConfig, { path: tsconfigPath, content: tsconfigRead.value }]
    : withConfig;
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

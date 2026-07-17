import type { StepSourceFile } from "./load-step-definitions";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { fnv1a } from "../../shared/hash/fnv1a";

/** Order-sensitive digest of a string list (JSON-encoded so values can't alias). */
const listDigest = (parts: readonly string[]): string => fnv1a(JSON.stringify(parts)).toString(36);

/**
 * Digest of a source-file set (path + bytes), order-INSENSITIVE (sorted by
 * path first): `listFilesRecursive`'s listing order is adapter-dependent, so
 * an unsorted digest could report a hash MISS for the SAME file set merely
 * re-listed in a different order. Each file's [path, content] pair is
 * JSON-encoded so no separator can alias across them (a differently-split
 * path/content pair, e.g. path "a"+content "b c" vs path "a b"+content "c",
 * must never digest equal). Exported so `SpecificationService` can compare a
 * pre- vs post-spawn source snapshot for the same equality the cache itself
 * uses (Codex P2 on PR #102, source-side spawn-window gate) without
 * duplicating this sort+encode logic.
 */
export const sourcesDigest = (sources: readonly StepSourceFile[]): string =>
  listDigest(
    [...sources]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((source) => JSON.stringify([source.path, source.content])),
  );

interface CoverageEntry {
  featureHash: number;
  sourcesHash: string;
  covered: boolean;
}

/**
 * In-memory, per-session record of bddgen coverage verdicts (issue #77): for a
 * Feature whose RAW file bytes AND whose runner-source files still hash-match
 * a recorded bddgen run, `allStepsDefined` can serve the authoritative
 * verdict instead of the conservative static heuristic.
 *
 * CONTENT-ADDRESSED ON BOTH INPUTS (spec D6 — deliberate deviation from #77's
 * sketched `defsRevision` event counter):
 *
 * - `featureHash` digests the Feature file's RAW BYTES, not its parsed step
 *   TEMPLATES — a Scenario Outline Examples-row edit changes the PICKLES
 *   bddgen evaluates while leaving the step templates `collectStepTexts` sees
 *   unchanged, so a template-only digest would miss it (Codex P2 on PR #102).
 *   Background/comment/tag edits invalidate too, which is over-cautious but
 *   safe — extra misses are the safe direction.
 * - `sourcesHash` digests the RAW source files (path + bytes) of the WHOLE
 *   RUNNER `src` TREE (steps, pages, support, fixtures — not just
 *   `src/steps`), NOT the scraped pattern set — scraping can't see custom
 *   parameter types, regex helpers, or variable-built definitions, and
 *   bddgen compiles the WHOLE runner graph: the default generated runner's
 *   example step imports `../pages/ExamplePage`, so a `src/steps`-only digest
 *   would miss a page-object/support edit bddgen recompiles against (Codex P2
 *   on PR #102). This supersedes an earlier "self-containment gate" that
 *   refused to record whenever a step source imported outside `src/steps` —
 *   removed because it was both too blunt (that DEFAULT `../pages` import
 *   disabled the cache for every normal vault) and too porous (its `../`
 *   regex missed alias/package/dynamic escapes anyway).
 *
 * Both catch an edit made OUTSIDE the plugin (a stale "covered" is the
 * dangerous direction; the `defsRevision` counter would have missed it). A
 * miss is always safe: callers fall back to the static heuristic. Nothing is
 * persisted (spec D7).
 *
 * ACCEPTED RESIDUAL: imports that escape `.testrunner/src` entirely (a
 * tsconfig path alias, a bare package carrying step logic, the playwright
 * config at the runner root) are not hashed — exotic for a plugin-generated
 * runner (whose steps import only `playwright-bdd`), session-scoped (spec
 * D7), and re-recorded on the next detect.
 *
 * 32-bit digests: a colliding edit could in principle serve a stale verdict
 * (~2^-32 per changed-input read) — accepted; the verdict only gates
 * rail/panel affordances and self-heals on the next detect.
 */
export class StepCoverageCache {
  private readonly entries = new Map<string, CoverageEntry>();

  /** Record a bddgen verdict for the Feature as its inputs looked when bddgen ran. */
  record(
    featurePath: VaultPath,
    featureContent: string,
    sources: readonly StepSourceFile[],
    covered: boolean,
  ): void {
    this.entries.set(featurePath, {
      featureHash: fnv1a(featureContent),
      sourcesHash: sourcesDigest(sources),
      covered,
    });
  }

  /**
   * The recorded verdict, or null when there is none or either input has since
   * changed (the caller then uses the static heuristic).
   */
  authoritativeCovered(
    featurePath: VaultPath,
    featureContent: string,
    sources: readonly StepSourceFile[],
  ): boolean | null {
    const entry = this.entries.get(featurePath);
    if (entry === undefined) return null;
    if (entry.featureHash !== fnv1a(featureContent)) return null;
    if (entry.sourcesHash !== sourcesDigest(sources)) return null;
    return entry.covered;
  }
}

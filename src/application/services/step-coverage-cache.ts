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
}

/**
 * In-memory, per-session record of CONFIRMED-covered bddgen verdicts (issue
 * #77): for a Feature whose RAW file bytes AND whose runner-source files still
 * hash-match a recorded bddgen run, `allStepsDefined` can serve the
 * authoritative "covered" instead of the conservative static heuristic.
 *
 * POSITIVE-ONLY (spec D6): the cache records ONLY a confirmed-covered verdict —
 * never a not-covered one — so a consult can only UPGRADE the static heuristic
 * (surface a covered the static matcher can't model: optional/alternative
 * cucumber-expression syntax), never BLOCK it. `allStepsDefined` is therefore
 * `cache-confirms-covered OR static-says-all-defined`. This terminates the
 * "should a `Missing step definitions:` header record not-covered?" question
 * that oscillated across PR #102: bddgen's misses conflate a genuinely-absent
 * definition with a runtime data mismatch (a Scenario Outline Examples value
 * that won't match an existing typed param) — the static tier draws that line
 * and the "Steps" stage only cares about definition existence, so a header
 * simply falls through to static instead of pinning the rail not-covered.
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
 * ACCEPTED RESIDUAL: imports that escape `.testrunner/src` AND the runner-root
 * config files entirely — a tsconfig path alias's RESOLVED TARGET living
 * outside the tracked runner roots, a bare package carrying step logic — are
 * not hashed — exotic for a plugin-generated runner (whose steps import only
 * `playwright-bdd`), session-scoped (spec D7), and re-recorded on the next
 * detect. `playwright.config.ts` AND `tsconfig.json` themselves — bddgen's
 * `defineBddConfig` entry point and its module-resolution/`paths` settings,
 * previously this residual's own examples — ARE now hashed (Codex P2/P2s,
 * closing the outermost ring): the sources set the caller passes in
 * (`SpecificationService.runnerSources`, via `loadRunnerCoverageSources`)
 * includes both alongside the whole `src` tree.
 *
 * TWO further ACCEPTED RESIDUALS, both exotic and self-healing, both now made
 * SAFER by positive-only (a stale hit can only ever be a wrongly-served
 * "covered", which the next real detect corrects):
 * - The resolved `BDD_FEATURES` scope is NOT in the key (Codex P2, PR #102):
 *   changing `featureFilesPath` after a detect — without touching the Feature
 *   bytes or the runner sources — could serve a verdict bddgen recorded for a
 *   different runner-relative path. Requires re-pointing the feature folder
 *   mid-session at a folder that no longer contains the Feature; re-recorded on
 *   the next detect.
 * - A customized `playwright.config.ts` whose hard-coded `tags` filter excludes
 *   every scenario makes bddgen generate zero pickles and exit WITHOUT a header
 *   (Codex P2, PR #102) — recording a covered the feature doesn't actually earn.
 *   Out-of-band for a plugin-GENERATED runner (the plugin writes the config); a
 *   robust guard needs bddgen output-dir introspection.
 *
 * 32-bit digests: a colliding edit could in principle serve a stale verdict
 * (~2^-32 per changed-input read) — accepted; the verdict only gates
 * rail/panel affordances and self-heals on the next detect.
 */
export class StepCoverageCache {
  private readonly entries = new Map<string, CoverageEntry>();

  /**
   * Record a CONFIRMED-covered verdict for the Feature as its inputs looked when
   * bddgen ran. POSITIVE-ONLY: the cache only ever stores "bddgen saw every step
   * defined here", never a not-covered verdict, so a later consult can only
   * UPGRADE the static heuristic (surface a covered the static matcher couldn't
   * model — optional/alternative cucumber-expression syntax), never BLOCK it.
   * The caller records only on a header-ABSENT bddgen run (see
   * DefaultSpecificationService.detectMissingSteps): a `Missing step
   * definitions:` header records NOTHING, because bddgen's misses conflate
   * definition-absence with runtime data mismatch (a Scenario Outline value that
   * won't match an existing typed param) — a distinction the static tier draws
   * and the "Steps" stage cares about, so that case falls through to static
   * rather than being pinned not-covered.
   */
  recordCovered(
    featurePath: VaultPath,
    featureContent: string,
    sources: readonly StepSourceFile[],
  ): void {
    this.entries.set(featurePath, {
      featureHash: fnv1a(featureContent),
      sourcesHash: sourcesDigest(sources),
    });
  }

  /**
   * `true` when a confirmed-covered verdict was recorded for this Feature and
   * BOTH inputs still hash-match it; `null` otherwise (no record, or either
   * input changed since — the caller then uses the static heuristic). NEVER
   * `false`: the cache is positive-only, so a consult reads as "bddgen confirms
   * covered" vs. "ask static" — it can upgrade a static miss but never block a
   * static hit.
   */
  authoritativeCovered(
    featurePath: VaultPath,
    featureContent: string,
    sources: readonly StepSourceFile[],
  ): true | null {
    const entry = this.entries.get(featurePath);
    if (entry === undefined) return null;
    if (entry.featureHash !== fnv1a(featureContent)) return null;
    if (entry.sourcesHash !== sourcesDigest(sources)) return null;
    return true;
  }
}

import type { StepSourceFile } from "./load-step-definitions";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { fnv1a } from "../../shared/hash/fnv1a";

/** Order-sensitive digest of a string list (JSON-encoded so values can't alias). */
const listDigest = (parts: readonly string[]): string => fnv1a(JSON.stringify(parts)).toString(36);

// Sort by path first: `listFilesRecursive`'s listing order is adapter-dependent,
// so an unsorted digest could report a hash MISS for the SAME file set merely
// re-listed in a different order — sorting makes the digest depend only on
// membership + content. Each file's [path, content] pair is JSON-encoded so no
// separator can alias across them (a differently-split path/content pair, e.g.
// path "a"+content "b c" vs path "a b"+content "c", must never digest equal).
const sourcesDigest = (sources: readonly StepSourceFile[]): string =>
  listDigest(
    [...sources]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((source) => JSON.stringify([source.path, source.content])),
  );

interface CoverageEntry {
  stepTextsHash: string;
  sourcesHash: string;
  covered: boolean;
}

/**
 * In-memory, per-session record of bddgen coverage verdicts (issue #77): for a
 * Feature whose step texts AND whose steps-folder source files still
 * hash-match a recorded bddgen run, `allStepsDefined` can serve the
 * authoritative verdict instead of the conservative static heuristic.
 *
 * CONTENT-ADDRESSED ON BOTH INPUTS (spec D6 — deliberate deviation from #77's
 * sketched `defsRevision` event counter): step texts, and the steps-folder
 * source set, are both re-hashed on every read. The source side is addressed
 * on the RAW step-file sources (path + bytes), NOT the scraped pattern set —
 * scraping can't see custom parameter types, regex helpers, or variable-built
 * definitions, so a pattern-only digest could serve a stale verdict after such
 * code is edited (Codex P2 on PR #102). Raw-byte addressing also catches a
 * step definition edited or deleted OUTSIDE the plugin, same as the pattern
 * digest did (a stale "covered" is the dangerous direction; the `defsRevision`
 * counter would have missed both cases) — extra misses are the safe direction.
 * A miss is always safe: callers fall back to the static heuristic. Nothing is
 * persisted (spec D7).
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
    stepTexts: readonly string[],
    sources: readonly StepSourceFile[],
    covered: boolean,
  ): void {
    this.entries.set(featurePath, {
      stepTextsHash: listDigest(stepTexts),
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
    stepTexts: readonly string[],
    sources: readonly StepSourceFile[],
  ): boolean | null {
    const entry = this.entries.get(featurePath);
    if (entry === undefined) return null;
    if (entry.stepTextsHash !== listDigest(stepTexts)) return null;
    if (entry.sourcesHash !== sourcesDigest(sources)) return null;
    return entry.covered;
  }
}

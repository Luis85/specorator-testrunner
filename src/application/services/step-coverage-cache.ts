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

// bddgen executes the whole runner graph, so a step file importing OUTSIDE
// src/steps (e.g. `from "../support/patterns"`) makes `sourcesDigest` blind to
// edits in that out-of-tree helper — `record` below refuses to store a
// verdict for such a set (Codex P2 follow-up on PR #102). `./` imports stay
// inside the recursively-digested steps dir and are fine; only a PARENT
// traversal (`../`) escapes it. A simple content regex, not a real module
// resolver — good enough to catch the common ESM/CJS import/require forms.
const RELATIVE_PARENT_IMPORT = /(?:from\s*|require\(\s*|import\(\s*)["']\.\.\//;

/** True when no step source imports outside the digested steps folder. */
export const stepSourcesSelfContained = (sources: readonly StepSourceFile[]): boolean =>
  sources.every((source) => !RELATIVE_PARENT_IMPORT.test(source.content));

interface CoverageEntry {
  featureHash: string;
  sourcesHash: string;
  covered: boolean;
}

/**
 * In-memory, per-session record of bddgen coverage verdicts (issue #77): for a
 * Feature whose RAW file bytes AND whose steps-folder source files still
 * hash-match a recorded bddgen run, `allStepsDefined` can serve the
 * authoritative verdict instead of the conservative static heuristic.
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
 * - `sourcesHash` digests the RAW step-file sources (path + bytes), NOT the
 *   scraped pattern set — scraping can't see custom parameter types, regex
 *   helpers, or variable-built definitions, so a pattern-only digest could
 *   serve a stale verdict after such code is edited (Codex P2 on PR #102).
 *
 * Both catch an edit made OUTSIDE the plugin (a stale "covered" is the
 * dangerous direction; the `defsRevision` counter would have missed it). A
 * miss is always safe: callers fall back to the static heuristic. Nothing is
 * persisted (spec D7).
 *
 * SELF-CONTAINMENT PRECONDITION: `record` refuses to store a verdict when any
 * step source escapes `src/steps` via a relative parent import (`../`) — see
 * {@link stepSourcesSelfContained} — because bddgen executes the whole runner
 * graph, so an out-of-tree helper edit would be invisible to `sourcesHash`
 * (Codex P2 follow-up on PR #102). Such setups simply keep the pre-#77 static
 * behavior.
 *
 * 32-bit digests: a colliding edit could in principle serve a stale verdict
 * (~2^-32 per changed-input read) — accepted; the verdict only gates
 * rail/panel affordances and self-heals on the next detect.
 */
export class StepCoverageCache {
  private readonly entries = new Map<string, CoverageEntry>();

  /**
   * Record a bddgen verdict for the Feature as its inputs looked when bddgen
   * ran. No-ops (and drops any prior entry) when `sources` is not
   * self-contained — see the class doc.
   */
  record(
    featurePath: VaultPath,
    featureContent: string,
    sources: readonly StepSourceFile[],
    covered: boolean,
  ): void {
    if (!stepSourcesSelfContained(sources)) {
      // Hygiene only, not a correctness requirement: an edit that makes (or
      // keeps) a set non-self-contained already changes `sourcesHash`, so a
      // stale prior entry would miss on its own — this just avoids leaving an
      // unusable entry allocated.
      this.entries.delete(featurePath);
      return;
    }
    this.entries.set(featurePath, {
      featureHash: listDigest([featureContent]),
      sourcesHash: sourcesDigest(sources),
      covered,
    });
  }

  /**
   * The recorded verdict, or null when there is none or either input has since
   * changed (the caller then uses the static heuristic). No self-containment
   * check needed here: a non-self-contained set never got an entry stored.
   */
  authoritativeCovered(
    featurePath: VaultPath,
    featureContent: string,
    sources: readonly StepSourceFile[],
  ): boolean | null {
    const entry = this.entries.get(featurePath);
    if (entry === undefined) return null;
    if (entry.featureHash !== listDigest([featureContent])) return null;
    if (entry.sourcesHash !== sourcesDigest(sources)) return null;
    return entry.covered;
  }
}
